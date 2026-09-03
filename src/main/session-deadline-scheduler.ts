import type { FocusSessionState } from "../core";
import type { Clock } from "../platform/application";

/**
 * Node clamps a setTimeout delay above this value to a near-immediate timer.
 * Keeping the default at the platform limit makes long focus sessions safe;
 * callers can provide a smaller value for tests or a different timer host.
 */
export const DEFAULT_MAX_DELAY_MS = 2_147_483_647;

/**
 * While intervention is active there is no further phase boundary, but the
 * main process still needs to advance the reducer so away time and renderer
 * snapshots stay current. Keeping this interval explicit makes the refresh
 * cadence deterministic and easy to cover with fake timers.
 */
export const INTERVENTION_HEARTBEAT_MS = 15_000;

/**
 * The time remaining until the next reducer boundary.
 *
 * `null` means that the current phase has no deadline. This helper is pure:
 * the timestamp at which the deadline occurs is derived separately from the
 * state's `lastEventAtMs` value. Intervention uses a recurring heartbeat in
 * place of a one-shot phase deadline so prolonged-away state remains fresh.
 */
export function getNextDeadlineDelayMs(
  state: FocusSessionState,
): number | null {
  const config = state.config;
  if (config === null) return null;

  switch (state.phase) {
    case "focused":
      return remainingMs(config.durationMs, state.focusedMs);
    case "grace":
      return remainingMs(config.gracePeriodMs, state.currentAwayMs);
    case "nudge":
      return remainingMs(config.interventionAfterMs, state.currentAwayMs);
    case "intervention":
      return INTERVENTION_HEARTBEAT_MS;
    case "idle":
    case "paused":
    case "completed":
    case "stopped":
      return null;
  }
}

/**
 * Returns the absolute event timestamp at which the next phase boundary is
 * planned. A state without a prior event cannot safely schedule a deadline.
 */
export function getNextDeadlineAtMs(state: FocusSessionState): number | null {
  const remaining = getNextDeadlineDelayMs(state);
  if (remaining === null || state.lastEventAtMs === null) return null;
  const deadlineAtMs = state.lastEventAtMs + remaining;
  return isTimestamp(deadlineAtMs) ? deadlineAtMs : null;
}

export type SessionDeadlineTimerHandle = ReturnType<typeof setTimeout> | number;

export type SessionDeadlineSchedulingErrorCode =
  | "clock-failed"
  | "deadline-invalid"
  | "schedule-failed"
  | "cancel-failed";

export interface SessionDeadlineSchedulingError {
  readonly code: SessionDeadlineSchedulingErrorCode;
  readonly message: string;
}

export interface SessionDeadlineSchedulerOptions {
  readonly clock: Clock;
  readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => SessionDeadlineTimerHandle;
  readonly cancel: (handle: SessionDeadlineTimerHandle) => void;
  readonly advanceAt: (atMs: number) => void;
  readonly maxDelayMs?: number;
  readonly onSchedulingError?: (error: SessionDeadlineSchedulingError) => void;
}

/**
 * Schedules one exact reducer boundary at a time.
 *
 * The scheduler never reads a wall clock itself. It asks the injected clock
 * only for the current scheduling position, then passes the planned absolute
 * boundary to `advanceAt`. If a timer fires late, the reducer can therefore
 * account for the exact boundary and synchronize again for any later one.
 */
export class SessionDeadlineScheduler {
  private generation = 0;
  private pending: PendingTimer | null = null;
  private disposed = false;
  private readonly maxDelayMs: number;

  constructor(private readonly options: SessionDeadlineSchedulerOptions) {
    const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs <= 0) {
      throw new RangeError("maxDelayMs must be a positive safe integer.");
    }
    this.maxDelayMs = maxDelayMs;
  }

  /**
   * Replaces the current deadline. Calling this for every state transition
   * keeps the timer aligned with reducer state and makes old callbacks stale.
   * Returns the delay for the current chunk, or `null` when no timer is needed
   * or a scheduling operation fails.
   */
  synchronize(state: FocusSessionState): number | null {
    if (this.disposed) return null;

    const generation = ++this.generation;
    if (!this.cancelPending()) {
      // The old timer may still exist underneath a failed cancellation. Do
      // not add another active timer; its callback is stale by generation.
      if (this.isCurrent(generation)) this.generation += 1;
      return null;
    }

    const remainingMs = getNextDeadlineDelayMs(state);
    if (remainingMs === null || state.lastEventAtMs === null) return null;
    const deadlineAtMs = state.lastEventAtMs + remainingMs;
    if (!isTimestamp(deadlineAtMs)) {
      this.failScheduling(
        generation,
        "deadline-invalid",
        "The next session deadline is outside the supported timestamp range.",
      );
      return null;
    }
    return this.scheduleFor(generation, deadlineAtMs);
  }

  /** Cancels the current deadline and makes all previously captured callbacks stale. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.cancelPending();
  }

  private scheduleFor(generation: number, deadlineAtMs: number): number | null {
    if (!this.isCurrent(generation)) return null;

    let delayMs: number;
    try {
      const nowMs = this.options.clock.nowMs();
      if (!isTimestamp(nowMs)) {
        throw new Error("Clock returned an invalid timestamp.");
      }
      delayMs = boundedDelay(deadlineAtMs, nowMs, this.maxDelayMs);
    } catch (error: unknown) {
      this.failScheduling(generation, "clock-failed", error);
      return null;
    }

    let callbackRan = false;
    let callbackConsumed = false;
    let scheduledHandle: SessionDeadlineTimerHandle | undefined;
    const callback = (): void => {
      if (callbackConsumed) return;
      callbackConsumed = true;
      if (!this.isCurrent(generation)) return;
      callbackRan = true;
      if (
        scheduledHandle !== undefined &&
        this.pending?.generation === generation &&
        this.pending.handle === scheduledHandle
      ) {
        this.pending = null;
      }
      this.handleTimer(generation, deadlineAtMs);
    };

    try {
      scheduledHandle = this.options.schedule(callback, delayMs);
    } catch (error: unknown) {
      this.failScheduling(generation, "schedule-failed", error);
      return null;
    }

    // A normal setTimeout callback cannot run until this method returns. The
    // extra branch keeps bookkeeping correct for a synchronous test driver or
    // a re-entrant callback that synchronizes a newer state.
    if (callbackRan || !this.isCurrent(generation)) {
      this.cancelHandle(scheduledHandle);
    } else {
      this.pending = { generation, deadlineAtMs, handle: scheduledHandle };
    }

    return delayMs;
  }

  private handleTimer(generation: number, deadlineAtMs: number): void {
    if (!this.isCurrent(generation)) return;

    let nowMs: number;
    try {
      nowMs = this.options.clock.nowMs();
      if (!isTimestamp(nowMs)) {
        throw new Error("Clock returned an invalid timestamp.");
      }
    } catch (error: unknown) {
      this.failScheduling(generation, "clock-failed", error);
      return;
    }

    if (nowMs < deadlineAtMs) {
      // The timer fired before its planned boundary. Keep the same absolute
      // deadline rather than counting down from a newly invented timestamp.
      this.scheduleFor(generation, deadlineAtMs);
      return;
    }

    // The reducer receives the planned boundary even when the host timer was
    // delayed. It can then transition deterministically and synchronize this
    // scheduler for the next boundary.
    this.options.advanceAt(deadlineAtMs);
  }

  private cancelPending(): boolean {
    const pending = this.pending;
    this.pending = null;
    if (pending === null) return true;

    try {
      this.options.cancel(pending.handle);
      return true;
    } catch (error: unknown) {
      this.reportSchedulingError("cancel-failed", error);
      return false;
    }
  }

  private cancelHandle(handle: SessionDeadlineTimerHandle): void {
    try {
      this.options.cancel(handle);
    } catch (error: unknown) {
      this.reportSchedulingError("cancel-failed", error);
    }
  }

  private failScheduling(
    generation: number,
    code: "clock-failed" | "deadline-invalid" | "schedule-failed",
    error: unknown,
  ): void {
    if (!this.isCurrent(generation)) return;
    this.generation += 1;
    this.pending = null;
    this.reportSchedulingError(code, error);
  }

  private reportSchedulingError(
    code: SessionDeadlineSchedulingErrorCode,
    error: unknown,
  ): void {
    this.options.onSchedulingError?.({
      code,
      message: errorMessage(error),
    });
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
}

interface PendingTimer {
  readonly generation: number;
  readonly deadlineAtMs: number;
  readonly handle: SessionDeadlineTimerHandle;
}

function remainingMs(deadlineMs: number, elapsedMs: number): number {
  return Math.max(0, Math.trunc(deadlineMs - elapsedMs));
}

function boundedDelay(
  deadlineAtMs: number,
  nowMs: number,
  maxDelayMs: number,
): number {
  return Math.min(maxDelayMs, Math.max(0, Math.trunc(deadlineAtMs - nowMs)));
}

function isTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Session deadline timer operation failed.";
}
