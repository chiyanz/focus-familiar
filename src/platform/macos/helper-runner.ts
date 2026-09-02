import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import type { Disposable, PlatformError } from "../application";

const MAX_OUTPUT_BYTES = 65_536;
const MAX_REQUEST_OUTPUT_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 5_000;

export interface HelperRunResult {
  readonly exitCode: number | null;
  readonly lines: readonly string[];
  readonly stderr: string;
}

export interface NativeHelperRunner {
  request(arguments_: readonly string[]): Promise<HelperRunResult>;
  observe(
    arguments_: readonly string[],
    onLine: (line: string) => void,
    onFailure: (error: PlatformError) => void,
  ): Disposable;
}

export class NativeHelperRunnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeHelperRunnerError";
  }
}

export class ChildProcessNativeHelperRunner implements NativeHelperRunner {
  constructor(private readonly executablePath: string) {}

  async request(arguments_: readonly string[]): Promise<HelperRunResult> {
    const child = this.spawnHelper(arguments_);
    const lines: string[] = [];
    const decoder = new JsonLineDecoder((line) => lines.push(line));
    let stderr = "";
    let stdoutBytes = 0;
    let outputError: NativeHelperRunnerError | null = null;
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > MAX_REQUEST_OUTPUT_BYTES) {
          throw new NativeHelperRunnerError(
            "helper-output-too-large",
            "The native helper response exceeded the one-megabyte safety limit.",
          );
        }
        decoder.push(chunk);
      } catch (error) {
        outputError =
          error instanceof NativeHelperRunnerError
            ? error
            : new NativeHelperRunnerError(
                "helper-output-too-large",
                error instanceof Error
                  ? error.message
                  : "Native helper output is invalid.",
              );
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.byteLength(stderr) < MAX_OUTPUT_BYTES)
        stderr += chunk.toString("utf8");
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, REQUEST_TIMEOUT_MS);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }).finally(() => clearTimeout(timeout));
    if (outputError) throw outputError;
    if (timedOut) {
      throw new NativeHelperRunnerError(
        "helper-timeout",
        "The native helper did not answer within five seconds.",
      );
    }
    decoder.finish();

    return { exitCode, lines, stderr: stderr.trim() };
  }

  observe(
    arguments_: readonly string[],
    onLine: (line: string) => void,
    onFailure: (error: PlatformError) => void,
  ): Disposable {
    const child = this.spawnHelper(arguments_);
    const decoder = new JsonLineDecoder(onLine);
    let disposed = false;
    let failed = false;
    const reportFailure = (error: PlatformError): void => {
      if (disposed || failed) return;
      failed = true;
      onFailure(error);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        decoder.push(chunk);
      } catch (error) {
        reportFailure({
          code: "helper-output-too-large",
          message:
            error instanceof Error
              ? error.message
              : "Native helper output is too large.",
        });
        child.kill("SIGTERM");
      }
    });
    child.once("error", () => {
      reportFailure({
        code: "helper-spawn-failed",
        message: "The native helper could not start.",
      });
    });
    child.once("exit", (code) => {
      reportFailure({
        code: "helper-exited",
        message: `The native helper exited unexpectedly (${String(code)}).`,
      });
    });

    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        child.kill("SIGTERM");
      },
    };
  }

  private spawnHelper(
    arguments_: readonly string[],
  ): ChildProcessByStdio<null, Readable, Readable> {
    return spawn(this.executablePath, [...arguments_], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  }
}

export class JsonLineDecoder {
  private buffered = Buffer.alloc(0);

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer): void {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    if (this.buffered.byteLength > MAX_OUTPUT_BYTES) {
      throw new Error("Native helper output exceeded the 64 KiB safety limit.");
    }

    let newlineIndex = this.buffered.indexOf(0x0a);
    while (newlineIndex >= 0) {
      const line = this.buffered
        .subarray(0, newlineIndex)
        .toString("utf8")
        .trim();
      this.buffered = this.buffered.subarray(newlineIndex + 1);
      if (line) this.onLine(line);
      newlineIndex = this.buffered.indexOf(0x0a);
    }
  }

  finish(): void {
    const line = this.buffered.toString("utf8").trim();
    this.buffered = Buffer.alloc(0);
    if (line) this.onLine(line);
  }
}
