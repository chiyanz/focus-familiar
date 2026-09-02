import { describe, expect, it, vi } from "vitest";

import type { FocusSessionConfig } from "../core";
import type {
  ActivityProvider,
  ApplicationActivityEvent,
  ApplicationIdentity,
  Clock,
  Disposable,
  PlatformResult,
} from "../platform/application";
import { SessionActivityBridge } from "./session-activity-bridge";

const editor = { bundleId: "com.example.Editor", name: "Editor" };
const browser = { bundleId: "com.example.Browser", name: "Browser" };
const config: FocusSessionConfig = {
  task: "Write tests",
  targetApplication: editor,
  durationMs: 10_000,
  gracePeriodMs: 1_000,
  interventionAfterMs: 3_000,
  intensity: "balanced",
};

class FakeClock implements Clock {
  value = 0;
  nowMs(): number {
    return this.value;
  }
}

class FakeActivityProvider implements ActivityProvider {
  current: PlatformResult<ApplicationIdentity> = { ok: true, value: editor };
  currentApplicationImplementation:
    | (() => Promise<PlatformResult<ApplicationIdentity>>)
    | undefined;
  listener: ((event: ApplicationActivityEvent) => void) | undefined;
  readonly dispose = vi.fn();

  async currentApplication(): Promise<PlatformResult<ApplicationIdentity>> {
    return this.currentApplicationImplementation?.() ?? this.current;
  }

  async listApplications(): Promise<
    PlatformResult<readonly ApplicationIdentity[]>
  > {
    return { ok: true, value: [editor, browser] };
  }

  observe(listener: (event: ApplicationActivityEvent) => void): Disposable {
    this.listener = listener;
    return { dispose: this.dispose };
  }

  emit(event: ApplicationActivityEvent): void {
    this.listener?.(event);
  }
}

describe("session activity bridge", () => {
  it("feeds foreground changes into the pure focus reducer", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    const changed = vi.fn();
    const bridge = new SessionActivityBridge(provider, clock, {
      onStateChanged: changed,
    });
    bridge.startMonitoring();
    bridge.startMonitoring();
    await bridge.startSession("session-1", config);

    provider.emit({
      type: "application-activated",
      atMs: 500,
      application: browser,
    });
    provider.emit({
      type: "application-activated",
      atMs: 1_500,
      application: browser,
    });
    expect(bridge.snapshot()).toMatchObject({
      phase: "nudge",
      focusedMs: 500,
      currentAwayMs: 1_000,
    });
    expect(changed).toHaveBeenCalledTimes(3);

    bridge.dispose();
    expect(provider.dispose).toHaveBeenCalledOnce();
  });

  it("can advance at an exact scheduler-provided boundary", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    const bridge = new SessionActivityBridge(provider, clock);
    await bridge.startSession("session-1", config);

    bridge.advanceAt(1_000);

    expect(bridge.snapshot()).toMatchObject({
      phase: "focused",
      focusedMs: 1_000,
      lastEventAtMs: 1_000,
    });
    expect(clock.value).toBe(0);
  });

  it("can pause at the last safe scheduler boundary", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    const bridge = new SessionActivityBridge(provider, clock);
    await bridge.startSession("session-1", config);
    bridge.advanceAt(500);

    bridge.pauseAt(500);

    expect(bridge.snapshot()).toMatchObject({
      phase: "paused",
      focusedMs: 500,
      lastEventAtMs: 500,
    });
    expect(clock.value).toBe(0);
  });

  it("pauses safely on sleep and does not count sleep or wake as distraction", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    const bridge = new SessionActivityBridge(provider, clock);
    bridge.startMonitoring();
    await bridge.startSession("session-1", config);

    provider.emit({ type: "system-sleep", atMs: 1_000 });
    provider.emit({ type: "system-wake", atMs: 100_000 });
    provider.emit({
      type: "application-activated",
      atMs: 100_001,
      application: browser,
    });
    expect(bridge.snapshot()).toMatchObject({
      phase: "paused",
      focusedMs: 1_000,
      awayMs: 0,
      currentApplication: browser,
    });
  });

  it("pauses and reports a visible observation failure", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    const onError = vi.fn();
    const bridge = new SessionActivityBridge(provider, clock, {
      onObservationError: onError,
    });
    bridge.startMonitoring();
    await bridge.startSession("session-1", config);

    provider.emit({
      type: "observation-error",
      atMs: 250,
      error: { code: "helper-exited", message: "Monitoring stopped." },
    });
    expect(bridge.snapshot()).toMatchObject({
      phase: "paused",
      focusedMs: 250,
    });
    expect(onError).toHaveBeenCalledWith({
      code: "helper-exited",
      message: "Monitoring stopped.",
    });
  });

  it("does not invent a session from background observations", () => {
    const provider = new FakeActivityProvider();
    const bridge = new SessionActivityBridge(provider, new FakeClock());
    bridge.startMonitoring();
    provider.emit({
      type: "application-activated",
      atMs: 10,
      application: browser,
    });
    expect(bridge.snapshot().phase).toBe("idle");
  });

  it("prefers a newer observation when the initial current-app request races", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    let resolveCurrent:
      | ((result: PlatformResult<ApplicationIdentity>) => void)
      | undefined;
    provider.currentApplicationImplementation = () =>
      new Promise((resolve) => {
        resolveCurrent = resolve;
      });
    const bridge = new SessionActivityBridge(provider, clock);
    bridge.startMonitoring();

    const started = bridge.startSession("session-1", config);
    provider.emit({
      type: "application-activated",
      atMs: 0,
      application: browser,
    });
    resolveCurrent?.({ ok: true, value: editor });
    await started;

    expect(bridge.snapshot()).toMatchObject({
      phase: "grace",
      currentApplication: browser,
    });
  });

  it("pauses and reports an out-of-order foreground observation", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    const onError = vi.fn();
    const bridge = new SessionActivityBridge(provider, clock, {
      onObservationError: onError,
    });
    bridge.startMonitoring();
    clock.value = 100;
    await bridge.startSession("session-1", config);

    provider.emit({
      type: "application-activated",
      atMs: 99,
      application: browser,
    });

    expect(bridge.snapshot().phase).toBe("paused");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "session-event-rejected" }),
    );
  });

  it("returns current-app failures without changing state", async () => {
    const provider = new FakeActivityProvider();
    const onError = vi.fn();
    provider.current = {
      ok: false,
      error: { code: "no-frontmost-application", message: "No current app." },
    };
    const bridge = new SessionActivityBridge(provider, new FakeClock(), {
      onObservationError: onError,
    });

    const result = await bridge.startSession("session-1", config);
    expect(result).toMatchObject({ ok: false, state: { phase: "idle" } });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("ignores an in-flight start result and observer callbacks after disposal", async () => {
    const provider = new FakeActivityProvider();
    let resolveCurrent:
      | ((result: PlatformResult<ApplicationIdentity>) => void)
      | undefined;
    provider.currentApplicationImplementation = () =>
      new Promise((resolve) => {
        resolveCurrent = resolve;
      });
    const changed = vi.fn();
    const bridge = new SessionActivityBridge(provider, new FakeClock(), {
      onStateChanged: changed,
    });
    bridge.startMonitoring();

    const pendingStart = bridge.startSession("session-1", config);
    bridge.dispose();
    provider.emit({
      type: "application-activated",
      atMs: 10,
      application: browser,
    });
    resolveCurrent?.({ ok: true, value: editor });

    await expect(pendingStart).resolves.toMatchObject({
      ok: false,
      state: { phase: "idle" },
      error: { message: "The session activity bridge has been disposed." },
    });
    expect(bridge.snapshot().phase).toBe("idle");
    expect(changed).not.toHaveBeenCalled();
    expect(provider.dispose).toHaveBeenCalledOnce();
  });

  it("rejects synchronous commands after disposal without reading the clock", () => {
    const provider = new FakeActivityProvider();
    const clock = { nowMs: vi.fn(() => 0) };
    const bridge = new SessionActivityBridge(provider, clock);
    bridge.dispose();

    expect(bridge.pause()).toMatchObject({ ok: false });
    expect(bridge.advance()).toMatchObject({ ok: false });
    expect(bridge.stop("user")).toMatchObject({ ok: false });
    expect(clock.nowMs).not.toHaveBeenCalled();
  });

  it("ignores an in-flight resume result after disposal", async () => {
    const provider = new FakeActivityProvider();
    const clock = new FakeClock();
    const bridge = new SessionActivityBridge(provider, clock);
    await bridge.startSession("session-1", config);
    bridge.pauseAt(0);

    let resolveCurrent:
      | ((result: PlatformResult<ApplicationIdentity>) => void)
      | undefined;
    provider.currentApplicationImplementation = () =>
      new Promise((resolve) => {
        resolveCurrent = resolve;
      });
    const pendingResume = bridge.resume();
    bridge.dispose();
    resolveCurrent?.({ ok: true, value: editor });

    await expect(pendingResume).resolves.toMatchObject({
      ok: false,
      state: { phase: "paused" },
    });
    expect(bridge.snapshot().phase).toBe("paused");
  });
});
