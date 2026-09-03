import { describe, expect, it, vi } from "vitest";

import type { FocusSessionConfig, FocusSessionState } from "../core";
import type { Clock } from "../platform/application";
import {
  getNextDeadlineAtMs,
  getNextDeadlineDelayMs,
  INTERVENTION_HEARTBEAT_MS,
  SessionDeadlineScheduler,
  type SessionDeadlineTimerHandle,
} from "./session-deadline-scheduler";

const config: FocusSessionConfig = {
  task: "Ship the feature",
  targetApplication: {
    bundleId: "com.example.Editor",
    name: "Editor",
  },
  durationMs: 10_000,
  gracePeriodMs: 1_000,
  interventionAfterMs: 3_000,
  intensity: "balanced",
};

function state(
  phase: FocusSessionState["phase"],
  overrides: Partial<FocusSessionState> = {},
): FocusSessionState {
  return {
    schemaVersion: 1,
    sessionId: "session-1",
    phase,
    config,
    currentApplication: config.targetApplication,
    focusedMs: 0,
    awayMs: 0,
    currentAwayMs: 0,
    lastEventAtMs: 0,
    endedAtMs: null,
    stopReason: null,
    ...overrides,
  };
}

class FakeClock implements Clock {
  now = 0;

  nowMs(): number {
    return this.now;
  }
}

interface ScheduledTimer {
  readonly id: number;
  readonly callback: () => void;
  readonly delayMs: number;
  canceled: boolean;
}

class FakeTimerDriver {
  readonly timers: ScheduledTimer[] = [];
  readonly schedule = vi.fn(
    (callback: () => void, delayMs: number): SessionDeadlineTimerHandle => {
      const timer: ScheduledTimer = {
        id: this.timers.length + 1,
        callback,
        delayMs,
        canceled: false,
      };
      this.timers.push(timer);
      return timer.id;
    },
  );
  readonly cancel = vi.fn((handle: SessionDeadlineTimerHandle): void => {
    const timer = this.timers.find((candidate) => candidate.id === handle);
    if (timer) timer.canceled = true;
  });

  fire(index: number): void {
    const timer = this.timers[index];
    if (!timer) return;
    // A one-shot host timer is no longer active once its callback starts.
    // Marking it here lets tests distinguish a consumed timer from a pending
    // timer that has not yet been cancelled by the scheduler.
    timer.canceled = true;
    timer.callback();
  }
}

function schedulerFor(
  clock: FakeClock,
  driver: FakeTimerDriver,
  advanceAt: (atMs: number) => void = vi.fn(),
  options: { readonly maxDelayMs?: number } = {},
): SessionDeadlineScheduler {
  return new SessionDeadlineScheduler({
    clock,
    schedule: driver.schedule,
    cancel: driver.cancel,
    advanceAt,
    ...options,
  });
}

describe("getNextDeadlineDelayMs", () => {
  it.each([
    ["focused", 2_500, 7_500],
    ["grace", 250, 750],
    ["nudge", 1_250, 1_750],
  ] as const)(
    "computes the remaining %s deadline",
    (phase, elapsed, expected) => {
      const current =
        phase === "focused"
          ? state(phase, { focusedMs: elapsed })
          : state(phase, { currentAwayMs: elapsed });

      expect(getNextDeadlineDelayMs(current)).toBe(expected);
    },
  );

  it("uses a recurring heartbeat while intervention is active", () => {
    expect(
      getNextDeadlineDelayMs(state("intervention", { currentAwayMs: 30_000 })),
    ).toBe(INTERVENTION_HEARTBEAT_MS);
  });

  it.each([
    ["focused", { focusedMs: 9_999 }, 1],
    ["focused", { focusedMs: 10_000 }, 0],
    ["focused", { focusedMs: 11_000 }, 0],
    ["grace", { currentAwayMs: 999 }, 1],
    ["grace", { currentAwayMs: 1_000 }, 0],
    ["grace", { currentAwayMs: 1_500 }, 0],
    ["nudge", { currentAwayMs: 2_999 }, 1],
    ["nudge", { currentAwayMs: 3_000 }, 0],
    ["nudge", { currentAwayMs: 4_000 }, 0],
  ] as const)(
    "clamps a due %s deadline to zero",
    (phase, overrides, expected) => {
      expect(getNextDeadlineDelayMs(state(phase, overrides))).toBe(expected);
    },
  );

  it.each(["idle", "paused", "completed", "stopped"] as const)(
    "does not define a timer deadline for %s",
    (phase) => {
      expect(getNextDeadlineDelayMs(state(phase))).toBeNull();
      expect(getNextDeadlineAtMs(state(phase))).toBeNull();
    },
  );

  it("derives an absolute deadline from the last event timestamp", () => {
    const current = state("focused", {
      lastEventAtMs: 4_000,
      focusedMs: 2_500,
    });

    expect(getNextDeadlineAtMs(current)).toBe(11_500);
  });

  it("derives the next intervention heartbeat from the last event timestamp", () => {
    expect(
      getNextDeadlineAtMs(
        state("intervention", {
          lastEventAtMs: 30_000,
          currentAwayMs: 30_000,
        }),
      ),
    ).toBe(30_000 + INTERVENTION_HEARTBEAT_MS);
  });

  it("does not define an absolute deadline for an incomplete state", () => {
    expect(
      getNextDeadlineAtMs(state("focused", { lastEventAtMs: null })),
    ).toBeNull();
    expect(getNextDeadlineAtMs(state("focused", { config: null }))).toBeNull();
  });

  it("rejects an absolute deadline outside the safe timestamp range", () => {
    expect(
      getNextDeadlineAtMs(
        state("focused", {
          lastEventAtMs: 1,
          config: { ...config, durationMs: Number.MAX_SAFE_INTEGER },
        }),
      ),
    ).toBeNull();
  });
});

describe("SessionDeadlineScheduler", () => {
  it("schedules from an absolute deadline, not just state remaining time", () => {
    const clock = new FakeClock();
    clock.now = 7_000;
    const driver = new FakeTimerDriver();
    const scheduler = schedulerFor(clock, driver);

    // The planned deadline is 4_000 + (10_000 - 2_500) = 11_500.
    expect(
      scheduler.synchronize(
        state("focused", { lastEventAtMs: 4_000, focusedMs: 2_500 }),
      ),
    ).toBe(4_500);
    expect(driver.timers[0]?.delayMs).toBe(4_500);
  });

  it("keeps one timer and reschedules on every synchronization", () => {
    const clock = new FakeClock();
    clock.now = 500;
    const driver = new FakeTimerDriver();
    const scheduler = schedulerFor(clock, driver);

    expect(scheduler.synchronize(state("focused", { focusedMs: 500 }))).toBe(
      9_000,
    );
    clock.now = 1_000;
    expect(
      scheduler.synchronize(
        state("grace", { lastEventAtMs: 500, currentAwayMs: 250 }),
      ),
    ).toBe(250);

    expect(driver.schedule).toHaveBeenCalledTimes(2);
    expect(driver.cancel).toHaveBeenCalledWith(1);
    expect(driver.timers[0]?.canceled).toBe(true);
    expect(driver.timers[1]?.canceled).toBe(false);
    expect(driver.timers[1]?.delayMs).toBe(250);
  });

  it("cancels a running timer when state no longer needs a deadline", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const scheduler = schedulerFor(clock, driver);

    scheduler.synchronize(state("nudge", { currentAwayMs: 2_000 }));
    expect(scheduler.synchronize(state("paused"))).toBeNull();

    expect(driver.cancel).toHaveBeenCalledOnce();
    expect(driver.timers[0]?.canceled).toBe(true);
  });

  it("passes the planned boundary when a timer fires late", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const advanceAt = vi.fn();
    const scheduler = schedulerFor(clock, driver, advanceAt);

    scheduler.synchronize(state("focused"));
    clock.now = 12_000;
    driver.fire(0);

    expect(advanceAt).toHaveBeenCalledOnce();
    expect(advanceAt).toHaveBeenCalledWith(10_000);
  });

  it("chunks long deadlines and keeps the same absolute boundary", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const advanceAt = vi.fn();
    const scheduler = schedulerFor(clock, driver, advanceAt, {
      maxDelayMs: 1_000,
    });

    scheduler.synchronize(state("focused"));
    expect(driver.timers[0]?.delayMs).toBe(1_000);

    clock.now = 1_000;
    driver.fire(0);
    expect(advanceAt).not.toHaveBeenCalled();
    expect(driver.timers[1]?.delayMs).toBe(1_000);

    // A later chunk may fire late; it still delivers the original 10-second
    // boundary rather than the host clock's current value.
    clock.now = 10_000;
    driver.fire(1);
    expect(advanceAt).toHaveBeenCalledWith(10_000);
  });

  it("ignores a stale callback after rescheduling", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const advanceAt = vi.fn();
    const scheduler = schedulerFor(clock, driver, advanceAt);

    scheduler.synchronize(state("focused"));
    scheduler.synchronize(state("nudge", { currentAwayMs: 2_000 }));
    driver.fire(0);
    expect(advanceAt).not.toHaveBeenCalled();

    clock.now = 3_000;
    driver.fire(1);
    expect(advanceAt).toHaveBeenCalledOnce();
    expect(advanceAt).toHaveBeenCalledWith(1_000);
  });

  it("refreshes intervention every heartbeat without accumulating timers", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const advanceAt = vi.fn();
    const scheduler = schedulerFor(clock, driver, advanceAt);

    clock.now = 3_000;
    expect(
      scheduler.synchronize(
        state("intervention", {
          lastEventAtMs: 3_000,
          currentAwayMs: 3_000,
        }),
      ),
    ).toBe(INTERVENTION_HEARTBEAT_MS);
    expect(driver.timers[0]?.delayMs).toBe(INTERVENTION_HEARTBEAT_MS);

    clock.now = 18_000;
    driver.fire(0);
    expect(advanceAt).toHaveBeenCalledOnce();
    expect(advanceAt).toHaveBeenCalledWith(18_000);

    // The runtime synchronizes after applying the advance. The next timer is
    // exactly one heartbeat later and is the only active timer.
    expect(
      scheduler.synchronize(
        state("intervention", {
          lastEventAtMs: 18_000,
          currentAwayMs: 18_000,
        }),
      ),
    ).toBe(INTERVENTION_HEARTBEAT_MS);
    expect(driver.timers[1]?.delayMs).toBe(INTERVENTION_HEARTBEAT_MS);
    expect(driver.timers.filter((timer) => !timer.canceled)).toHaveLength(1);

    // A host callback cannot produce a duplicate advance after it has been
    // consumed, even if a timer driver invokes it more than once.
    driver.fire(0);
    expect(advanceAt).toHaveBeenCalledOnce();

    clock.now = 33_000;
    driver.fire(1);
    expect(advanceAt).toHaveBeenCalledTimes(2);
    expect(advanceAt).toHaveBeenLastCalledWith(33_000);
  });

  it("does not schedule or invoke work after dispose, which is idempotent", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const advanceAt = vi.fn();
    const scheduler = schedulerFor(clock, driver, advanceAt);

    scheduler.synchronize(state("focused"));
    scheduler.dispose();
    scheduler.dispose();
    driver.fire(0);

    expect(driver.cancel).toHaveBeenCalledOnce();
    expect(advanceAt).not.toHaveBeenCalled();
    expect(scheduler.synchronize(state("focused"))).toBeNull();
    expect(driver.schedule).toHaveBeenCalledOnce();
  });

  it("passes a zero delay through for an already-due deadline", () => {
    const clock = new FakeClock();
    clock.now = 10_000;
    const driver = new FakeTimerDriver();
    const scheduler = schedulerFor(clock, driver);

    expect(scheduler.synchronize(state("focused"))).toBe(0);
    expect(driver.timers[0]?.delayMs).toBe(0);
  });

  it("reports a scheduling failure and invalidates the attempted timer", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const onSchedulingError = vi.fn();
    driver.schedule.mockImplementation(() => {
      throw new Error("timer unavailable");
    });
    const scheduler = new SessionDeadlineScheduler({
      clock,
      schedule: driver.schedule,
      cancel: driver.cancel,
      advanceAt: vi.fn(),
      onSchedulingError,
    });

    expect(scheduler.synchronize(state("focused"))).toBeNull();
    expect(onSchedulingError).toHaveBeenCalledWith({
      code: "schedule-failed",
      message: "timer unavailable",
    });
  });

  it("reports an unsafe absolute deadline instead of silently running", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const onSchedulingError = vi.fn();
    const scheduler = new SessionDeadlineScheduler({
      clock,
      schedule: driver.schedule,
      cancel: driver.cancel,
      advanceAt: vi.fn(),
      onSchedulingError,
    });

    expect(
      scheduler.synchronize(
        state("focused", {
          lastEventAtMs: 1,
          config: { ...config, durationMs: Number.MAX_SAFE_INTEGER },
        }),
      ),
    ).toBeNull();
    expect(driver.schedule).not.toHaveBeenCalled();
    expect(onSchedulingError).toHaveBeenCalledWith({
      code: "deadline-invalid",
      message:
        "The next session deadline is outside the supported timestamp range.",
    });
  });

  it("reports an invalid clock timestamp instead of scheduling", () => {
    const clock = new FakeClock();
    clock.now = 0.5;
    const driver = new FakeTimerDriver();
    const onSchedulingError = vi.fn();
    const scheduler = new SessionDeadlineScheduler({
      clock,
      schedule: driver.schedule,
      cancel: driver.cancel,
      advanceAt: vi.fn(),
      onSchedulingError,
    });

    expect(scheduler.synchronize(state("focused"))).toBeNull();
    expect(driver.schedule).not.toHaveBeenCalled();
    expect(onSchedulingError).toHaveBeenCalledWith({
      code: "clock-failed",
      message: "Clock returned an invalid timestamp.",
    });
  });

  it("reports cancellation failures and does not create a replacement timer", () => {
    const clock = new FakeClock();
    const driver = new FakeTimerDriver();
    const onSchedulingError = vi.fn();
    const scheduler = new SessionDeadlineScheduler({
      clock,
      schedule: driver.schedule,
      cancel: driver.cancel,
      advanceAt: vi.fn(),
      onSchedulingError,
    });

    scheduler.synchronize(state("focused"));
    driver.cancel.mockImplementation(() => {
      throw new Error("cancel unavailable");
    });

    expect(scheduler.synchronize(state("grace"))).toBeNull();
    expect(driver.schedule).toHaveBeenCalledOnce();
    expect(onSchedulingError).toHaveBeenCalledWith({
      code: "cancel-failed",
      message: "cancel unavailable",
    });

    // The old host callback remains physically callable in this fake driver,
    // but generation invalidation makes it inert.
    driver.fire(0);
    expect(onSchedulingError).toHaveBeenCalledOnce();
  });

  it("makes a synchronous due callback safe", () => {
    const clock = new FakeClock();
    clock.now = 10_000;
    const cancel = vi.fn();
    const advanceAt = vi.fn();
    const schedule = vi.fn(
      (callback: () => void): SessionDeadlineTimerHandle => {
        callback();
        return 1;
      },
    );
    const scheduler = new SessionDeadlineScheduler({
      clock,
      schedule,
      cancel,
      advanceAt,
    });

    scheduler.synchronize(state("focused"));

    expect(advanceAt).toHaveBeenCalledOnce();
    expect(advanceAt).toHaveBeenCalledWith(10_000);
    expect(cancel).toHaveBeenCalledWith(1);
  });
});
