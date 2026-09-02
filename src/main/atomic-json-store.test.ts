import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ATOMIC_JSON_MAX_BYTES,
  AtomicJsonStore,
  type AtomicJsonParserResult,
  type AtomicJsonStoreOptions,
} from "./atomic-json-store";

interface ExampleDocument {
  readonly revision: number;
  readonly label: string;
}

const defaultDocument: ExampleDocument = { revision: 0, label: "default" };

const parser = (input: unknown): AtomicJsonParserResult<ExampleDocument> => {
  if (!isRecord(input)) {
    return {
      value: defaultDocument,
      issues: [
        { code: "invalid-document", message: "Document is not an object." },
      ],
    };
  }

  const revision = input.revision;
  const label = input.label;
  if (typeof revision !== "number" || typeof label !== "string") {
    return {
      value: defaultDocument,
      issues: [
        { code: "invalid-fields", message: "Document fields are invalid." },
      ],
    };
  }

  const issues = input.legacy
    ? [{ code: "legacy-field", message: "The legacy field was ignored." }]
    : [];
  return { value: { revision, label }, issues };
};

const options: AtomicJsonStoreOptions<ExampleDocument> = {
  parse: parser,
  defaults: () => ({ ...defaultDocument }),
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeStore(
  fileName = "settings.json",
  storeOptions: AtomicJsonStoreOptions<ExampleDocument> = options,
): Promise<{
  readonly directory: string;
  readonly filePath: string;
  readonly store: AtomicJsonStore<ExampleDocument>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "focus-familiar-store-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, fileName);
  return {
    directory,
    filePath,
    store: new AtomicJsonStore(filePath, storeOptions),
  };
}

describe("AtomicJsonStore", () => {
  it("loads defaults when the exact file path is missing", async () => {
    const { store } = await makeStore();

    await expect(store.load()).resolves.toEqual({
      ok: true,
      value: defaultDocument,
      source: "defaults",
      issues: [],
    });
  });

  it("reports an unavailable default without rejecting the load", async () => {
    const { store } = await makeStore("settings.json", {
      parse: parser,
      defaults: () => {
        throw new Error("broken default factory");
      },
    });

    await expect(store.load()).resolves.toEqual({
      ok: false,
      source: "unavailable",
      issues: [
        {
          code: "defaults-failed",
          message: "The default local JSON value could not be created.",
        },
      ],
      error: {
        code: "defaults-failed",
        message: "The default local JSON value could not be created.",
      },
    });
  });

  it("saves newline-terminated JSON and loads the parsed value", async () => {
    const { filePath, store } = await makeStore();
    const value = { revision: 1, label: "first" };

    await expect(store.save(value)).resolves.toEqual({ ok: true });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"revision":1,"label":"first"}\n',
    );
    await expect(store.load()).resolves.toEqual({
      ok: true,
      value,
      source: "file",
      issues: [],
    });
  });

  it("atomically replaces an existing document and leaves no temp sibling", async () => {
    const { directory, filePath, store } = await makeStore();

    await store.save({ revision: 1, label: "old" });
    await store.save({ revision: 2, label: "new" });

    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"revision":2,"label":"new"}\n',
    );
    await expect(readdir(directory)).resolves.toEqual(["settings.json"]);
  });

  it("serializes concurrent saves so the later invocation wins", async () => {
    const { store } = await makeStore();
    const first = store.save({ revision: 1, label: "first" });
    const second = store.save({ revision: 2, label: "second" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    await expect(store.load()).resolves.toMatchObject({
      ok: true,
      value: { revision: 2, label: "second" },
      source: "file",
    });
  });

  it("returns parser issues without discarding an otherwise usable value", async () => {
    const { filePath, store } = await makeStore();
    await writeFile(
      filePath,
      '{"revision":3,"label":"migrated","legacy":true}\n',
      "utf8",
    );

    await expect(store.load()).resolves.toEqual({
      ok: true,
      value: { revision: 3, label: "migrated" },
      source: "file",
      issues: [
        { code: "legacy-field", message: "The legacy field was ignored." },
      ],
    });
  });

  it("falls back to defaults with a stable error for malformed JSON", async () => {
    const { filePath, store } = await makeStore();
    await writeFile(filePath, "{not-json", "utf8");

    const result = await store.load();
    expect(result).toEqual({
      ok: false,
      value: defaultDocument,
      source: "defaults",
      issues: [
        {
          code: "invalid-json",
          message: "The local JSON document is malformed.",
        },
      ],
      error: {
        code: "invalid-json",
        message: "The local JSON document is malformed.",
      },
    });
  });

  it("rejects an oversized document before parsing it", async () => {
    const { filePath } = await makeStore();
    const parse = vi.fn(parser);
    const parserSpyStore = new AtomicJsonStore(filePath, {
      parse,
      defaults: options.defaults,
    });
    await writeFile(filePath, Buffer.alloc(ATOMIC_JSON_MAX_BYTES + 1, 0x20));

    const result = await parserSpyStore.load();
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      value: defaultDocument,
      source: "defaults",
      error: {
        code: "file-too-large",
        message: "The local JSON document exceeds the 1 MiB limit.",
      },
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it("returns a read error for a path that resolves to a directory", async () => {
    const { directory, store } = await makeStore("document");
    await mkdir(join(directory, "document"));

    const result = await store.load();
    expect(result).toMatchObject({
      ok: false,
      value: defaultDocument,
      source: "defaults",
      error: {
        code: "read-failed",
        message: "The local JSON document could not be read.",
      },
    });
  });

  it("resets to defaults and makes delete idempotent", async () => {
    const { store } = await makeStore();

    await store.save({ revision: 4, label: "saved" });
    await expect(store.reset()).resolves.toEqual({ ok: true });
    await expect(store.load()).resolves.toEqual({
      ok: true,
      value: defaultDocument,
      source: "file",
      issues: [],
    });

    await expect(store.delete()).resolves.toEqual({ ok: true });
    await expect(store.delete()).resolves.toEqual({ ok: true });
    await expect(store.load()).resolves.toEqual({
      ok: true,
      value: defaultDocument,
      source: "defaults",
      issues: [],
    });
  });

  it("uses restrictive permissions for new directories and files where supported", async () => {
    if (process.platform === "win32") return;

    const { directory, filePath, store } = await makeStore(
      join("nested", "settings.json"),
    );
    await expect(
      store.save({ revision: 5, label: "private" }),
    ).resolves.toEqual({
      ok: true,
    });

    const directoryStats = await stat(join(directory, "nested"));
    const fileStats = await stat(filePath);
    expect(directoryStats.mode & 0o777).toBe(0o700);
    expect(fileStats.mode & 0o777).toBe(0o600);
  });

  it("returns typed errors and cleans the temp file when mkdir or rename fails", async () => {
    const { directory } = await makeStore();
    const blockingPath = join(directory, "blocking");
    await writeFile(blockingPath, "not-a-directory", "utf8");
    const blockedStore = new AtomicJsonStore(
      join(blockingPath, "settings.json"),
      options,
    );

    await expect(blockedStore.save(defaultDocument)).resolves.toEqual({
      ok: false,
      error: {
        code: "mkdir-failed",
        message: "The local JSON directory could not be created.",
      },
    });

    const targetDirectory = join(directory, "target");
    await mkdir(targetDirectory);
    const renameFailureStore = new AtomicJsonStore(targetDirectory, options);
    await expect(renameFailureStore.save(defaultDocument)).resolves.toEqual({
      ok: false,
      error: {
        code: "rename-failed",
        message: "The local JSON file could not be replaced atomically.",
      },
    });

    await expect(readdir(directory)).resolves.toEqual(["blocking", "target"]);
  });

  it("returns a typed serialization error without touching disk", async () => {
    const { filePath } = await makeStore();
    const store = new AtomicJsonStore<unknown>(filePath, {
      parse: (input) => ({ value: input, issues: [] }),
      defaults: () => null,
    });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    await expect(store.save(cyclic)).resolves.toEqual({
      ok: false,
      error: {
        code: "serialize-failed",
        message: "The value could not be serialized as JSON.",
      },
    });
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
