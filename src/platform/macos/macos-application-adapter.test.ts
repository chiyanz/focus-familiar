import { describe, expect, it, vi } from "vitest";

import type {
  ApplicationActivityEvent,
  Clock,
  Disposable,
  PlatformError,
} from "../application";
import {
  NativeHelperRunnerError,
  type HelperRunResult,
  type NativeHelperRunner,
} from "./helper-runner";
import { MacOSApplicationAdapter } from "./macos-application-adapter";

const editor = { bundleId: "com.example.Editor", name: "Editor" };
const browser = { bundleId: "com.example.Browser", name: "Browser" };

function message(value: Record<string, unknown>): string {
  return JSON.stringify({ protocolVersion: 1, ...value });
}

class FakeRunner implements NativeHelperRunner {
  readonly requests: string[][] = [];
  readonly disposals = vi.fn();
  response: HelperRunResult = { exitCode: 0, lines: [], stderr: "" };
  requestError: unknown;
  private onLine: ((line: string) => void) | undefined;
  private onFailure: ((error: PlatformError) => void) | undefined;

  async request(arguments_: readonly string[]): Promise<HelperRunResult> {
    this.requests.push([...arguments_]);
    if (this.requestError) throw this.requestError;
    return this.response;
  }

  observe(
    arguments_: readonly string[],
    onLine: (line: string) => void,
    onFailure: (error: PlatformError) => void,
  ): Disposable {
    this.requests.push([...arguments_]);
    this.onLine = onLine;
    this.onFailure = onFailure;
    return { dispose: this.disposals };
  }

  emit(value: Record<string, unknown>): void {
    this.onLine?.(message(value));
  }

  emitRaw(line: string): void {
    this.onLine?.(line);
  }

  fail(error: PlatformError): void {
    this.onFailure?.(error);
  }
}

class FakeClock implements Clock {
  value = 100;
  nowMs(): number {
    return this.value++;
  }
}

describe("macOS application adapter requests", () => {
  it("reads the current application", async () => {
    const runner = new FakeRunner();
    runner.response = {
      exitCode: 0,
      stderr: "",
      lines: [message({ type: "current", ...editor })],
    };
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());

    await expect(adapter.currentApplication()).resolves.toEqual({
      ok: true,
      value: editor,
    });
    expect(runner.requests).toEqual([["--current"]]);
  });

  it("lists, deduplicates, and sorts user applications", async () => {
    const runner = new FakeRunner();
    runner.response = {
      exitCode: 0,
      stderr: "",
      lines: [
        message({ type: "application", ...editor }),
        message({ type: "application", ...browser }),
        message({ type: "application", ...editor }),
        message({ type: "complete", operation: "list", count: 3 }),
      ],
    };
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());

    await expect(adapter.listApplications()).resolves.toEqual({
      ok: true,
      value: [browser, editor],
    });
  });

  it("rejects a truncated application list", async () => {
    const runner = new FakeRunner();
    runner.response = {
      exitCode: 0,
      stderr: "",
      lines: [message({ type: "application", ...editor })],
    };
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());

    await expect(adapter.listApplications()).resolves.toMatchObject({
      ok: false,
      error: { code: "incomplete-application-list" },
    });
  });

  it("returns explicit activation success and failure", async () => {
    const runner = new FakeRunner();
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());
    runner.response = {
      exitCode: 0,
      stderr: "",
      lines: [message({ type: "activation", ...editor, success: true })],
    };
    await expect(adapter.activate(` ${editor.bundleId} `)).resolves.toEqual({
      ok: true,
      value: editor,
    });

    runner.response = {
      exitCode: 0,
      stderr: "",
      lines: [
        message({
          type: "activation",
          ...editor,
          success: false,
          code: "activation-failed",
          message: "Declined.",
        }),
      ],
    };
    await expect(adapter.activate(editor.bundleId)).resolves.toEqual({
      ok: false,
      error: { code: "activation-failed", message: "Declined." },
    });
  });

  it("surfaces helper errors, malformed output, process failure, and invalid input", async () => {
    const runner = new FakeRunner();
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());

    await expect(adapter.activate(" ")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-bundle-id" },
    });
    runner.response = { exitCode: 1, stderr: "crashed", lines: [] };
    await expect(adapter.currentApplication()).resolves.toMatchObject({
      ok: false,
      error: { code: "helper-request-failed", message: "crashed" },
    });
    runner.response = { exitCode: 0, stderr: "", lines: ["not-json"] };
    await expect(adapter.currentApplication()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-json" },
    });
    runner.response = {
      exitCode: 1,
      stderr: "",
      lines: [
        message({
          type: "error",
          operation: "current",
          code: "no-frontmost-application",
          message: "Unavailable.",
        }),
      ],
    };
    await expect(adapter.currentApplication()).resolves.toEqual({
      ok: false,
      error: { code: "no-frontmost-application", message: "Unavailable." },
    });
    runner.requestError = new NativeHelperRunnerError(
      "helper-timeout",
      "The helper timed out.",
    );
    await expect(adapter.currentApplication()).resolves.toEqual({
      ok: false,
      error: { code: "helper-timeout", message: "The helper timed out." },
    });
  });
});

describe("macOS application observation", () => {
  it("normalizes, timestamps, deduplicates, sleeps, wakes, and terminates", () => {
    const runner = new FakeRunner();
    const clock = new FakeClock();
    const adapter = new MacOSApplicationAdapter(runner, clock);
    const events: ApplicationActivityEvent[] = [];
    const disposable = adapter.observe((event) => events.push(event));

    runner.emit({ type: "ready" });
    runner.emit({ type: "current", ...editor });
    runner.emit({ type: "activation", ...editor, success: true });
    runner.emit({ type: "lifecycle", event: "sleep" });
    runner.emit({ type: "lifecycle", event: "sleep" });
    runner.emit({ type: "activation", ...browser, success: true });
    runner.emit({ type: "lifecycle", event: "wake" });
    runner.emit({ type: "lifecycle", event: "wake" });
    runner.emit({ type: "current", ...editor });
    runner.emit({ type: "termination", ...browser });

    expect(events).toEqual([
      { type: "application-activated", atMs: 100, application: editor },
      { type: "system-sleep", atMs: 101 },
      { type: "system-wake", atMs: 102 },
      { type: "application-activated", atMs: 103, application: editor },
      { type: "application-terminated", atMs: 104, application: browser },
    ]);
    disposable.dispose();
    disposable.dispose();
    expect(runner.disposals).toHaveBeenCalledOnce();
  });

  it("reports helper and activation observation failures without throwing", () => {
    const runner = new FakeRunner();
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());
    const events: ApplicationActivityEvent[] = [];
    adapter.observe((event) => events.push(event));

    runner.emit({ type: "ready" });
    runner.emit({
      type: "error",
      operation: "observe",
      code: "observation-failed",
      message: "Workspace failed.",
    });
    runner.emit({
      type: "activation",
      ...editor,
      success: false,
      code: "activation-failed",
      message: "Declined.",
    });
    runner.fail({ code: "helper-exited", message: "Exited." });

    expect(events).toEqual([
      {
        type: "observation-error",
        atMs: 100,
        error: { code: "observation-failed", message: "Workspace failed." },
      },
      {
        type: "observation-error",
        atMs: 101,
        error: { code: "activation-failed", message: "Declined." },
      },
      {
        type: "observation-error",
        atMs: 102,
        error: { code: "helper-exited", message: "Exited." },
      },
    ]);
  });

  it("fails and stops observation after malformed protocol output", () => {
    const runner = new FakeRunner();
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());
    const events: ApplicationActivityEvent[] = [];
    adapter.observe((event) => events.push(event));
    runner.emit({ type: "ready" });

    runner.emitRaw("not-json");

    expect(events).toEqual([
      {
        type: "observation-error",
        atMs: 100,
        error: {
          code: "invalid-json",
          message: "The native helper emitted invalid JSON.",
        },
      },
    ]);
    expect(runner.disposals).toHaveBeenCalledOnce();
  });

  it("rejects observation data emitted before the ready handshake", () => {
    const runner = new FakeRunner();
    const adapter = new MacOSApplicationAdapter(runner, new FakeClock());
    const events: ApplicationActivityEvent[] = [];
    adapter.observe((event) => events.push(event));

    runner.emit({ type: "current", ...editor });

    expect(events).toEqual([
      {
        type: "observation-error",
        atMs: 100,
        error: {
          code: "helper-not-ready",
          message: "The native helper emitted data before its ready signal.",
        },
      },
    ]);
    expect(runner.disposals).toHaveBeenCalledOnce();
  });

  it("fails and stops an observer that never becomes ready", () => {
    vi.useFakeTimers();
    try {
      const runner = new FakeRunner();
      const adapter = new MacOSApplicationAdapter(runner, new FakeClock());
      const events: ApplicationActivityEvent[] = [];
      adapter.observe((event) => events.push(event));

      vi.advanceTimersByTime(5_000);

      expect(events).toEqual([
        {
          type: "observation-error",
          atMs: 100,
          error: {
            code: "helper-ready-timeout",
            message:
              "The native helper did not become ready within five seconds.",
          },
        },
      ]);
      expect(runner.disposals).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
