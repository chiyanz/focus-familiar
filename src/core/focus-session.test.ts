import { describe, expect, it, vi } from "vitest";

import {
  createIdleSession,
  reduceSession,
  validateSessionConfig,
  type FocusSessionConfig,
  type FocusSessionState,
  type ObservedApplication,
  type SessionEvent,
  type SessionReduction,
} from "./focus-session";

const target: ObservedApplication = {
  bundleId: "com.microsoft.VSCode",
  name: "Visual Studio Code",
};
const browser: ObservedApplication = {
  bundleId: "com.google.Chrome",
  name: "Google Chrome",
};
const terminal: ObservedApplication = {
  bundleId: "com.apple.Terminal",
  name: "Terminal",
};
const config: FocusSessionConfig = {
  task: "Build the focus engine",
  targetApplication: target,
  durationMs: 10_000,
  gracePeriodMs: 1_000,
  interventionAfterMs: 3_000,
  intensity: "balanced",
};

function expectAccepted(result: SessionReduction): FocusSessionState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function start(
  currentApplication: ObservedApplication = target,
  overrides: Partial<FocusSessionConfig> = {},
  atMs = 0,
): FocusSessionState {
  return expectAccepted(
    reduceSession(createIdleSession(), {
      type: "session-started",
      atMs,
      sessionId: "session-1",
      config: { ...config, ...overrides },
      currentApplication,
    }),
  );
}

function apply(
  state: FocusSessionState,
  event: SessionEvent,
): FocusSessionState {
  return expectAccepted(reduceSession(state, event));
}

describe("focus-session configuration", () => {
  it("creates a JSON-safe idle snapshot", () => {
    const state = createIdleSession();
    expect(state).toEqual({
      schemaVersion: 1,
      sessionId: null,
      phase: "idle",
      config: null,
      currentApplication: null,
      focusedMs: 0,
      awayMs: 0,
      currentAwayMs: 0,
      lastEventAtMs: null,
      endedAtMs: null,
      stopReason: null,
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("normalizes user-entered strings", () => {
    const result = validateSessionConfig({
      ...config,
      task: "  Ship it  ",
      targetApplication: {
        bundleId: "  com.example.Editor ",
        name: " Editor ",
      },
    });
    expect(result).toEqual({
      ok: true,
      config: {
        ...config,
        task: "Ship it",
        targetApplication: { bundleId: "com.example.Editor", name: "Editor" },
      },
    });
  });

  it.each([
    ["non-object", null],
    ["blank task", { ...config, task: " " }],
    ["missing target", { ...config, targetApplication: null }],
    ["zero duration", { ...config, durationMs: 0 }],
    ["fractional duration", { ...config, durationMs: 1.5 }],
    ["negative grace", { ...config, gracePeriodMs: -1 }],
    ["equal thresholds", { ...config, interventionAfterMs: 1_000 }],
    ["reversed thresholds", { ...config, interventionAfterMs: 999 }],
    ["unknown intensity", { ...config, intensity: "maximum" }],
  ])("rejects invalid configuration: %s", (_label, input) => {
    const result = validateSessionConfig(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid-config");
  });
});

describe("session start and focus accounting", () => {
  it("starts focused when the target bundle is foreground", () => {
    const result = reduceSession(createIdleSession(), {
      type: "session-started",
      atMs: 100,
      sessionId: " session-1 ",
      config,
      currentApplication: target,
    });
    expect(result).toMatchObject({
      ok: true,
      state: { phase: "focused", sessionId: "session-1", lastEventAtMs: 100 },
      transitions: [{ from: "idle", to: "focused", atMs: 100 }],
    });
  });

  it("starts in grace when another application is foreground", () => {
    expect(start(browser).phase).toBe("grace");
  });

  it("starts directly in nudge when grace is configured to zero", () => {
    expect(start(browser, { gracePeriodMs: 0 }).phase).toBe("nudge");
  });

  it("counts only target-foreground intervals toward completion", () => {
    let state = start();
    state = apply(state, {
      type: "application-changed",
      atMs: 2_000,
      application: browser,
    });
    state = apply(state, { type: "time-advanced", atMs: 7_000 });
    state = apply(state, {
      type: "application-changed",
      atMs: 7_000,
      application: target,
    });
    state = apply(state, { type: "time-advanced", atMs: 14_999 });
    expect(state).toMatchObject({
      phase: "focused",
      focusedMs: 9_999,
      awayMs: 5_000,
    });

    state = apply(state, { type: "time-advanced", atMs: 15_000 });
    expect(state).toMatchObject({
      phase: "completed",
      focusedMs: 10_000,
      endedAtMs: 15_000,
    });
  });

  it("records the exact completion time when an event overshoots", () => {
    const result = reduceSession(start(), {
      type: "time-advanced",
      atMs: 20_000,
    });
    expect(result).toMatchObject({
      ok: true,
      state: {
        phase: "completed",
        focusedMs: 10_000,
        lastEventAtMs: 20_000,
        endedAtMs: 10_000,
      },
      transitions: [{ from: "focused", to: "completed", atMs: 10_000 }],
    });
  });

  it("does not complete while away even after the wall duration", () => {
    const state = apply(start(browser), {
      type: "time-advanced",
      atMs: 50_000,
    });
    expect(state).toMatchObject({
      phase: "intervention",
      focusedMs: 0,
      awayMs: 50_000,
    });
  });
});

describe("away escalation", () => {
  it.each([
    [999, "grace"],
    [1_000, "nudge"],
    [2_999, "nudge"],
    [3_000, "intervention"],
    [9_000, "intervention"],
  ] as const)("maps %dms away to %s", (atMs, phase) => {
    const state = apply(start(browser), { type: "time-advanced", atMs });
    expect(state.phase).toBe(phase);
  });

  it("handles a single large jump without intermediate ticks", () => {
    const result = reduceSession(start(browser), {
      type: "time-advanced",
      atMs: 8_000,
    });
    expect(result).toMatchObject({
      ok: true,
      state: { phase: "intervention", currentAwayMs: 8_000 },
      transitions: [{ from: "grace", to: "intervention" }],
    });
  });

  it("does not emit a threshold twice for duplicate clock signals", () => {
    const atThreshold = apply(start(browser), {
      type: "time-advanced",
      atMs: 1_000,
    });
    const duplicate = reduceSession(atThreshold, {
      type: "time-advanced",
      atMs: 1_000,
    });
    expect(duplicate).toEqual({
      ok: true,
      state: atThreshold,
      transitions: [],
    });
  });

  it("switching between non-target apps preserves the away interval", () => {
    let state = apply(start(browser), {
      type: "application-changed",
      atMs: 900,
      application: terminal,
    });
    state = apply(state, { type: "time-advanced", atMs: 1_100 });
    expect(state).toMatchObject({
      phase: "nudge",
      currentAwayMs: 1_100,
      awayMs: 1_100,
    });
  });

  it("returning resets escalation but preserves accumulated focus and away totals", () => {
    let state = apply(start(), { type: "time-advanced", atMs: 500 });
    state = apply(state, {
      type: "application-changed",
      atMs: 500,
      application: browser,
    });
    state = apply(state, { type: "time-advanced", atMs: 2_000 });
    expect(state.phase).toBe("nudge");

    state = apply(state, {
      type: "application-changed",
      atMs: 2_000,
      application: target,
    });
    expect(state).toMatchObject({
      phase: "focused",
      focusedMs: 500,
      currentAwayMs: 0,
    });

    state = apply(state, {
      type: "application-changed",
      atMs: 2_100,
      application: browser,
    });
    expect(state).toMatchObject({
      phase: "grace",
      focusedMs: 600,
      awayMs: 1_500,
    });
  });

  it("uses bundle identity rather than a display-name change", () => {
    const renamedTarget = { ...target, name: "Code" };
    const state = apply(start(), {
      type: "application-changed",
      atMs: 500,
      application: renamedTarget,
    });
    expect(state).toMatchObject({ phase: "focused", focusedMs: 500 });
  });

  it("returning exactly at a threshold does not surface a stale nudge", () => {
    const result = reduceSession(start(browser), {
      type: "application-changed",
      atMs: 1_000,
      application: target,
    });
    expect(result).toMatchObject({
      ok: true,
      state: { phase: "focused", awayMs: 1_000, currentAwayMs: 0 },
      transitions: [{ from: "grace", to: "focused" }],
    });
  });

  it("honors explicit ordering when two events share a timestamp", () => {
    const nudged = apply(start(browser), {
      type: "time-advanced",
      atMs: 1_000,
    });
    const returned = reduceSession(nudged, {
      type: "application-changed",
      atMs: 1_000,
      application: target,
    });
    expect(returned).toMatchObject({
      ok: true,
      state: { phase: "focused", awayMs: 1_000 },
      transitions: [{ from: "nudge", to: "focused", atMs: 1_000 }],
    });
  });
});

describe("pause, resume, and stop", () => {
  it("paused time counts toward neither focus nor distraction", () => {
    let state = apply(start(), { type: "session-paused", atMs: 2_000 });
    state = apply(state, { type: "time-advanced", atMs: 50_000 });
    expect(state).toMatchObject({
      phase: "paused",
      focusedMs: 2_000,
      awayMs: 0,
    });

    state = apply(state, {
      type: "session-resumed",
      atMs: 50_000,
      currentApplication: target,
    });
    state = apply(state, { type: "time-advanced", atMs: 50_500 });
    expect(state).toMatchObject({ phase: "focused", focusedMs: 2_500 });
  });

  it("pause resets the away episode and resume away starts fresh grace", () => {
    let state = apply(start(browser), { type: "time-advanced", atMs: 2_000 });
    expect(state.phase).toBe("nudge");
    state = apply(state, { type: "session-paused", atMs: 2_000 });
    expect(state).toMatchObject({
      phase: "paused",
      awayMs: 2_000,
      currentAwayMs: 0,
    });

    state = apply(state, {
      type: "session-resumed",
      atMs: 20_000,
      currentApplication: browser,
    });
    expect(state).toMatchObject({
      phase: "grace",
      awayMs: 2_000,
      currentAwayMs: 0,
    });
  });

  it("accepts application observations while paused without accruing time", () => {
    let state = apply(start(), { type: "session-paused", atMs: 100 });
    state = apply(state, {
      type: "application-changed",
      atMs: 10_000,
      application: browser,
    });
    expect(state).toMatchObject({
      phase: "paused",
      focusedMs: 100,
      awayMs: 0,
      currentApplication: browser,
    });
  });

  it.each(["user", "emergency"] as const)(
    "stops a running session with reason %s",
    (reason) => {
      const state = apply(start(), {
        type: "session-stopped",
        atMs: 500,
        reason,
      });
      expect(state).toMatchObject({
        phase: "stopped",
        endedAtMs: 500,
        stopReason: reason,
      });
    },
  );

  it("can stop while paused", () => {
    const paused = apply(start(), { type: "session-paused", atMs: 250 });
    const stopped = apply(paused, {
      type: "session-stopped",
      atMs: 5_000,
      reason: "emergency",
    });
    expect(stopped).toMatchObject({
      phase: "stopped",
      focusedMs: 250,
      endedAtMs: 5_000,
    });
  });

  it("completion wins over a simultaneous stop", () => {
    const state = apply(start(), {
      type: "session-stopped",
      atMs: 10_000,
      reason: "user",
    });
    expect(state).toMatchObject({
      phase: "completed",
      endedAtMs: 10_000,
      stopReason: null,
    });
  });
});

describe("invalid and duplicate events", () => {
  it("rejects events before start without mutating state", () => {
    const idle = createIdleSession();
    const result = reduceSession(idle, { type: "time-advanced", atMs: 0 });
    expect(result).toMatchObject({
      ok: false,
      state: idle,
      error: { code: "invalid-transition" },
    });
    expect(result.state).toBe(idle);
  });

  it("rejects a duplicate start", () => {
    const state = start();
    const result = reduceSession(state, {
      type: "session-started",
      atMs: 1,
      sessionId: "session-2",
      config,
      currentApplication: target,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-transition" },
    });
    expect(result.state).toBe(state);
  });

  it("rejects out-of-order time without mutating state", () => {
    const state = apply(start(), { type: "time-advanced", atMs: 500 });
    const result = reduceSession(state, { type: "time-advanced", atMs: 499 });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "out-of-order" },
    });
    expect(result.state).toBe(state);
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects invalid event timestamp %s",
    (atMs) => {
      const state = start();
      const result = reduceSession(state, { type: "time-advanced", atMs });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid-event" },
      });
      expect(result.state).toBe(state);
    },
  );

  it("rejects duplicate pause and resume while running", () => {
    const paused = apply(start(), { type: "session-paused", atMs: 1 });
    expect(
      reduceSession(paused, { type: "session-paused", atMs: 1 }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-transition" },
    });
    const running = apply(paused, {
      type: "session-resumed",
      atMs: 2,
      currentApplication: target,
    });
    expect(
      reduceSession(running, {
        type: "session-resumed",
        atMs: 2,
        currentApplication: target,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid-transition" } });
  });

  it("treats repeated foreground observations as safe, time-bearing signals", () => {
    const state = start();
    const result = reduceSession(state, {
      type: "application-changed",
      atMs: 500,
      application: target,
    });
    expect(result).toMatchObject({
      ok: true,
      state: { phase: "focused", focusedMs: 500 },
      transitions: [],
    });
  });

  it("rejects malformed runtime input without mutating state", () => {
    const state = start();
    const result = reduceSession(state, {
      type: "application-changed",
      atMs: 10,
      application: null,
    } as never);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-event" },
    });
    expect(result.state).toBe(state);
  });

  it("rejects every event after a terminal state", () => {
    const terminalState = apply(start(), {
      type: "session-stopped",
      atMs: 1,
      reason: "user",
    });
    const result = reduceSession(terminalState, {
      type: "time-advanced",
      atMs: 2,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "terminal-state" },
    });
    expect(result.state).toBe(terminalState);
  });
});

describe("determinism", () => {
  it("produces identical serializable results for identical event sequences", () => {
    const events: SessionEvent[] = [
      {
        type: "session-started",
        atMs: 100,
        sessionId: "repeatable",
        config,
        currentApplication: target,
      },
      { type: "application-changed", atMs: 600, application: browser },
      { type: "time-advanced", atMs: 1_600 },
      { type: "application-changed", atMs: 1_700, application: target },
      { type: "time-advanced", atMs: 2_000 },
    ];

    const run = (): FocusSessionState =>
      events.reduce((state, event) => apply(state, event), createIdleSession());
    const now = vi.spyOn(Date, "now");

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    expect(now).not.toHaveBeenCalled();
    now.mockRestore();
  });
});
