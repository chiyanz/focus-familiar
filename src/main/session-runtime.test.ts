import { describe, expect, it, vi } from "vitest";

import type { FocusSessionConfig } from "../core";
import type {
  ActivityProvider,
  ApplicationActivator,
  ApplicationActivityEvent,
  ApplicationIdentity,
  Clock,
  Disposable,
  PlatformResult,
} from "../platform/application";
import {
  SessionRuntime,
  type SessionRuntimeTimerDriver,
} from "./session-runtime";
import type { SessionDeadlineTimerHandle } from "./session-deadline-scheduler";

const editor = { bundleId: "com.example.Editor", name: "Editor" };
const browser = { bundleId: "com.example.Browser", name: "Browser" };
const strictConfig: FocusSessionConfig = {
  task: "Ship the runtime",
  targetApplication: editor,
  durationMs: 10_000,
  gracePeriodMs: 1_000,
  interventionAfterMs: 3_000,
  intensity: "strict",
};

class FakeClock implements Clock {
  value = 0;
  nowMs(): number {
    return this.value;
  }
}

class FakeActivityProvider implements ActivityProvider {
  current: ApplicationIdentity = editor;
  listener: ((event: ApplicationActivityEvent) => void) | undefined;
  readonly disposeObservation = vi.fn();

  async currentApplication(): Promise<PlatformResult<ApplicationIdentity>> {
    return { ok: true, value: this.current };
  }

  async listApplications(): Promise<
    PlatformResult<readonly ApplicationIdentity[]>
  > {
    return { ok: true, value: [editor, browser] };
  }

  observe(listener: (event: ApplicationActivityEvent) => void): Disposable {
    this.listener = listener;
    return { dispose: this.disposeObservation };
  }

  emit(event: ApplicationActivityEvent): void {
    this.listener?.(event);
  }
}

class FakeActivator implements ApplicationActivator {
  readonly activate = vi.fn(
    async (): Promise<PlatformResult<ApplicationIdentity>> => ({
      ok: true,
      value: editor,
    }),
  );
}

interface FakeTimerEntry {
  readonly handle: number;
  readonly callback: () => void;
  readonly delayMs: number;
  canceled: boolean;
}

class FakeTimer implements SessionRuntimeTimerDriver {
  readonly entries: FakeTimerEntry[] = [];
  throwOnSchedule = false;
  readonly schedule = vi.fn(
    (callback: () => void, delayMs: number): SessionDeadlineTimerHandle => {
      if (this.throwOnSchedule) throw new Error("timer unavailable");
      const entry = {
        handle: this.entries.length + 1,
        callback,
        delayMs,
        canceled: false,
      };
      this.entries.push(entry);
      return entry.handle;
    },
  );
  readonly cancel = vi.fn((handle: SessionDeadlineTimerHandle): void => {
    const entry = this.entries.find((candidate) => candidate.handle === handle);
    if (entry) entry.canceled = true;
  });

  fire(index: number): void {
    this.entries[index]?.callback();
  }
}

describe("session runtime", () => {
  it("advances delayed timers through exact boundaries and activates strict targets once", async () => {
    const provider = new FakeActivityProvider();
    provider.current = browser;
    const activator = new FakeActivator();
    const clock = new FakeClock();
    const timer = new FakeTimer();
    const states: string[] = [];
    const runtime = new SessionRuntime(provider, activator, clock, timer, {
      onStateChanged: (state) => states.push(state.phase),
    });
    runtime.startMonitoring();

    await runtime.startSession("session-1", strictConfig);
    expect(runtime.snapshot().phase).toBe("grace");
    expect(timer.entries[0]?.delayMs).toBe(1_000);

    clock.value = 1_200;
    timer.fire(0);
    expect(runtime.snapshot()).toMatchObject({
      phase: "nudge",
      lastEventAtMs: 1_000,
    });
    expect(timer.entries[1]?.delayMs).toBe(1_800);

    clock.value = 4_000;
    timer.fire(1);
    expect(runtime.snapshot()).toMatchObject({
      phase: "intervention",
      lastEventAtMs: 3_000,
    });
    expect(activator.activate).toHaveBeenCalledOnce();
    expect(activator.activate).toHaveBeenCalledWith(editor.bundleId);

    provider.emit({
      type: "application-activated",
      atMs: 4_001,
      application: editor,
    });
    expect(runtime.snapshot().phase).toBe("focused");
    expect(states).toEqual(["grace", "nudge", "intervention", "focused"]);
  });

  it("pauses at the last safe boundary when timer scheduling fails", async () => {
    const provider = new FakeActivityProvider();
    const activator = new FakeActivator();
    const clock = new FakeClock();
    const timer = new FakeTimer();
    timer.throwOnSchedule = true;
    const deferred: Array<() => void> = [];
    const errors = vi.fn();
    const runtime = new SessionRuntime(provider, activator, clock, timer, {
      defer: (callback) => deferred.push(callback),
      onRuntimeError: errors,
    });

    const result = await runtime.startSession("session-1", strictConfig);
    expect(result).toMatchObject({ ok: true, state: { phase: "focused" } });
    expect(runtime.snapshot().phase).toBe("focused");
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ code: "session-deadline-schedule-failed" }),
    );

    deferred[0]?.();
    expect(runtime.snapshot()).toMatchObject({
      phase: "paused",
      focusedMs: 0,
      lastEventAtMs: 0,
    });
  });

  it("cancels deadlines across sleep and never auto-resumes on wake", async () => {
    const provider = new FakeActivityProvider();
    const timer = new FakeTimer();
    const runtime = new SessionRuntime(
      provider,
      new FakeActivator(),
      new FakeClock(),
      timer,
    );
    runtime.startMonitoring();
    await runtime.startSession("session-1", strictConfig);

    provider.emit({ type: "system-sleep", atMs: 500 });
    provider.emit({ type: "system-wake", atMs: 50_000 });

    expect(runtime.snapshot()).toMatchObject({
      phase: "paused",
      focusedMs: 500,
    });
    expect(timer.entries[0]?.canceled).toBe(true);
    expect(timer.entries).toHaveLength(1);
  });

  it("disposes timers and observation once and rejects future work", async () => {
    const provider = new FakeActivityProvider();
    const timer = new FakeTimer();
    const runtime = new SessionRuntime(
      provider,
      new FakeActivator(),
      new FakeClock(),
      timer,
    );
    runtime.startMonitoring();
    await runtime.startSession("session-1", strictConfig);

    runtime.dispose();
    runtime.dispose();
    timer.fire(0);

    expect(provider.disposeObservation).toHaveBeenCalledOnce();
    expect(timer.entries[0]?.canceled).toBe(true);
    expect(runtime.pause()).toMatchObject({
      ok: false,
      error: { message: "The session runtime has been disposed." },
    });
  });
});
