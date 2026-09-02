import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

/** Maximum encoded document size accepted by the store. */
export const ATOMIC_JSON_MAX_BYTES = 1024 * 1024;

/**
 * A small, schema-agnostic issue shape shared by parsers and the store.
 *
 * Parser implementations may add fields such as a path or a suggested
 * migration, but the stable code/message pair is all the store relies on.
 */
export interface AtomicJsonIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export type JsonStoreIssue = AtomicJsonIssue;

export interface AtomicJsonParserResult<T> {
  readonly value: T;
  readonly issues: readonly AtomicJsonIssue[];
}

export interface AtomicJsonStoreOptions<T> {
  readonly parse: (input: unknown) => AtomicJsonParserResult<T>;
  readonly defaults: () => T;
}

export type AtomicJsonStoreErrorCode =
  | "invalid-json"
  | "file-too-large"
  | "read-failed"
  | "parse-failed"
  | "serialize-failed"
  | "defaults-failed"
  | "mkdir-failed"
  | "temp-create-failed"
  | "write-failed"
  | "rename-failed"
  | "delete-failed";

export interface AtomicJsonStoreError {
  readonly code: AtomicJsonStoreErrorCode;
  readonly message: string;
}

export type JsonStoreError = AtomicJsonStoreError;

export type AtomicJsonLoadResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly source: "file" | "defaults";
      readonly issues: readonly AtomicJsonIssue[];
    }
  | {
      readonly ok: false;
      readonly value: T;
      readonly source: "defaults";
      readonly issues: readonly AtomicJsonIssue[];
      readonly error: AtomicJsonStoreError;
    }
  | {
      readonly ok: false;
      readonly source: "unavailable";
      readonly issues: readonly AtomicJsonIssue[];
      readonly error: AtomicJsonStoreError & {
        readonly code: "defaults-failed";
      };
    };

export type AtomicJsonMutationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: AtomicJsonStoreError };

export type JsonStoreResult = AtomicJsonMutationResult;

/**
 * Stores one validated JSON document in the Electron main process.
 *
 * The store intentionally knows nothing about the document schema. Callers
 * provide parsing and defaults, while this class owns bounded I/O, restrictive
 * permissions, atomic replacement, and mutation ordering.
 */
export class AtomicJsonStore<T> {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly options: AtomicJsonStoreOptions<T>,
  ) {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new TypeError("An exact JSON file path is required.");
    }
  }

  /**
   * Reads and validates the document. Missing data is a normal first-run
   * result. Expected read, decoding, and parser failures fall back to fresh
   * defaults and are returned as stable typed errors; they never throw.
   */
  async load(): Promise<AtomicJsonLoadResult<T>> {
    // A load observes the state after mutations already invoked by this store.
    // Each mutation settles to a void promise even when it fails, so this
    // await cannot be rejected by an expected filesystem error.
    await this.mutationTail;

    const document = await this.readDocument();
    if (document.kind === "missing") {
      return this.withDefaults();
    }
    if (document.kind === "error") return this.fallback(document.error);

    let decoded: unknown;
    try {
      decoded = JSON.parse(document.content.toString("utf8"));
    } catch {
      return this.fallback(errorFor("invalid-json"));
    }

    let parsed: AtomicJsonParserResult<T>;
    try {
      parsed = this.options.parse(decoded);
    } catch {
      return this.fallback(errorFor("parse-failed"));
    }

    if (!isParserResult(parsed)) {
      return this.fallback(errorFor("parse-failed"));
    }

    return {
      ok: true,
      value: parsed.value,
      source: "file",
      issues: parsed.issues,
    };
  }

  /**
   * Queues a JSON replacement. The queue is FIFO by method invocation, so a
   * later save cannot be overtaken by an earlier slow filesystem operation.
   */
  save(value: T): Promise<AtomicJsonMutationResult> {
    const serialized = serialize(value);
    if (!serialized.ok) return Promise.resolve(serialized);

    return this.enqueueMutation(() => this.writeSerialized(serialized.value));
  }

  /** Replaces the document with the current schema defaults. */
  reset(): Promise<AtomicJsonMutationResult> {
    return this.enqueueMutation(async () => {
      let defaults: T;
      try {
        defaults = this.options.defaults();
      } catch {
        return { ok: false, error: errorFor("defaults-failed") };
      }

      const serialized = serialize(defaults);
      if (!serialized.ok) return serialized;
      return this.writeSerialized(serialized.value);
    });
  }

  /** Removes the document. Removing an already-missing document succeeds. */
  delete(): Promise<AtomicJsonMutationResult> {
    return this.enqueueMutation(async () => {
      try {
        await unlink(this.filePath);
        return { ok: true };
      } catch (error: unknown) {
        if (hasErrorCode(error, "ENOENT")) return { ok: true };
        return { ok: false, error: errorFor("delete-failed") };
      }
    });
  }

  private enqueueMutation(
    operation: () => Promise<AtomicJsonMutationResult>,
  ): Promise<AtomicJsonMutationResult> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readDocument(): Promise<ReadDocumentResult> {
    let handle: FileHandle;
    try {
      handle = await open(this.filePath, "r");
    } catch (error: unknown) {
      if (hasErrorCode(error, "ENOENT")) return { kind: "missing" };
      return { kind: "error", error: errorFor("read-failed") };
    }

    try {
      const initialStats = await handle.stat();
      if (isOversized(initialStats.size)) {
        return { kind: "error", error: errorFor("file-too-large") };
      }

      // Read at most one byte past the limit. The stat check above avoids
      // allocating for an obviously oversized file, while the bounded read
      // handles a file that grows between stat and read.
      const content = Buffer.alloc(ATOMIC_JSON_MAX_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < content.length) {
        const result = await handle.read(
          content,
          bytesRead,
          content.length - bytesRead,
          bytesRead,
        );
        bytesRead += result.bytesRead;
        if (result.bytesRead === 0) break;
      }

      const finalStats = await handle.stat();
      if (isOversized(finalStats.size) || bytesRead > ATOMIC_JSON_MAX_BYTES) {
        return { kind: "error", error: errorFor("file-too-large") };
      }

      return { kind: "content", content: content.subarray(0, bytesRead) };
    } catch {
      return { kind: "error", error: errorFor("read-failed") };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private fallback(error: AtomicJsonStoreError): AtomicJsonLoadResult<T> {
    return this.withDefaults(error);
  }

  private withDefaults(
    fallbackError?: AtomicJsonStoreError,
  ): AtomicJsonLoadResult<T> {
    let value: T;
    try {
      value = this.options.defaults();
    } catch {
      const error = errorFor("defaults-failed") as AtomicJsonStoreError & {
        readonly code: "defaults-failed";
      };
      return {
        ok: false,
        source: "unavailable",
        issues: [issueFor(error)],
        error,
      };
    }

    if (!fallbackError) {
      return { ok: true, value, source: "defaults", issues: [] };
    }

    return {
      ok: false,
      value,
      source: "defaults",
      issues: [issueFor(fallbackError)],
      error: fallbackError,
    };
  }

  private async writeSerialized(
    serialized: string,
  ): Promise<AtomicJsonMutationResult> {
    const parentDirectory = dirname(this.filePath);
    let temporaryPath: string | undefined;
    let handle: FileHandle | undefined;
    let stage: "mkdir" | "temp-create" | "write" | "rename" = "mkdir";

    try {
      await mkdir(parentDirectory, { recursive: true, mode: 0o700 });

      stage = "temp-create";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
          handle = await open(temporaryPath, "wx", 0o600);
          break;
        } catch (error: unknown) {
          if (!hasErrorCode(error, "EEXIST")) throw error;
          temporaryPath = undefined;
        }
      }
      if (!handle || !temporaryPath) {
        throw new Error("Could not create a unique temporary file.");
      }

      stage = "write";
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;

      stage = "rename";
      await rename(temporaryPath, this.filePath);
      temporaryPath = undefined;
      return { ok: true };
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);

      const code: AtomicJsonStoreErrorCode =
        stage === "mkdir"
          ? "mkdir-failed"
          : stage === "temp-create"
            ? "temp-create-failed"
            : stage === "write"
              ? "write-failed"
              : "rename-failed";
      return { ok: false, error: errorFor(code) };
    }
  }
}

type ReadDocumentResult =
  | { readonly kind: "missing" }
  | { readonly kind: "content"; readonly content: Buffer }
  | { readonly kind: "error"; readonly error: AtomicJsonStoreError };

function serialize<T>(
  value: T,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: AtomicJsonStoreError } {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") {
      return { ok: false, error: errorFor("serialize-failed") };
    }

    const serialized = `${json}\n`;
    if (Buffer.byteLength(serialized, "utf8") > ATOMIC_JSON_MAX_BYTES) {
      return { ok: false, error: errorFor("file-too-large") };
    }
    return { ok: true, value: serialized };
  } catch {
    return { ok: false, error: errorFor("serialize-failed") };
  }
}

function isParserResult<T>(
  value: AtomicJsonParserResult<T>,
): value is AtomicJsonParserResult<T> {
  if (typeof value !== "object" || value === null) return false;
  return "value" in value && Array.isArray(value.issues);
}

function isOversized(size: number): boolean {
  return !Number.isFinite(size) || size > ATOMIC_JSON_MAX_BYTES;
}

function hasErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "code" in error && (error as { code?: unknown }).code === code;
}

const ERROR_MESSAGES: Record<AtomicJsonStoreErrorCode, string> = {
  "invalid-json": "The local JSON document is malformed.",
  "file-too-large": "The local JSON document exceeds the 1 MiB limit.",
  "read-failed": "The local JSON document could not be read.",
  "parse-failed": "The local JSON document could not be validated.",
  "serialize-failed": "The value could not be serialized as JSON.",
  "defaults-failed": "The default local JSON value could not be created.",
  "mkdir-failed": "The local JSON directory could not be created.",
  "temp-create-failed": "A temporary local JSON file could not be created.",
  "write-failed": "The temporary local JSON file could not be written.",
  "rename-failed": "The local JSON file could not be replaced atomically.",
  "delete-failed": "The local JSON file could not be deleted.",
};

function errorFor(code: AtomicJsonStoreErrorCode): AtomicJsonStoreError {
  return { code, message: ERROR_MESSAGES[code] };
}

function issueFor(error: AtomicJsonStoreError): AtomicJsonIssue {
  return { code: error.code, message: error.message };
}
