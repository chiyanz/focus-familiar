import type {
  FocusSessionConfig,
  FocusSessionState,
  SessionReduction,
  StopReason,
} from "../core";
import type {
  ActivityProvider,
  ApplicationActivator,
  Clock,
  PlatformError,
} from "../platform/application";
import {
  InterventionCoordinator,
  type InterventionActivationFailed,
  type InterventionActivationSucceeded,
} from "./intervention-coordinator";
import { SessionActivityBridge } from "./session-activity-bridge";
import {
  SessionDeadlineScheduler,
  type SessionDeadlineSchedulingError,
  type SessionDeadlineTimerHandle,
} from "./session-deadline-scheduler";

export interface SessionRuntimeTimerDriver {
  readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => SessionDeadlineTimerHandle;
  readonly cancel: (handle: SessionDeadlineTimerHandle) => void;
}

export interface SessionRuntimeOptions {
  readonly onStateChanged?: (state: FocusSessionState) => void;
  readonly onRuntimeError?: (error: PlatformError) => void;
  readonly onActivationSucceeded?: (
    result: InterventionActivationSucceeded,
  ) => void;
  readonly onActivationFailed?: (result: InterventionActivationFailed) => void;
  /** Injected to make fail-safe scheduling deterministic in tests. */
  readonly defer?: (callback: () => void) => void;
}

/**
 * Owns the nonvisual focus-session runtime in the Electron main process.
 *
 * The pure reducer remains authoritative. This class only connects normalized
 * application facts, exact one-shot deadlines, and the reversible strict-mode
 * activation policy. Renderers can subscribe later without gaining access to
 * timers or platform services.
 */
export class SessionRuntime {
  private readonly bridge: SessionActivityBridge;
  private readonly scheduler: SessionDeadlineScheduler;
  private readonly intervention: InterventionCoordinator;
  private readonly defer: (callback: () => void) => void;
  private pauseQueued = false;
  private disposed = false;

  constructor(
    activityProvider: ActivityProvider,
    activator: ApplicationActivator,
    clock: Clock,
    timer: SessionRuntimeTimerDriver,
    private readonly options: SessionRuntimeOptions = {},
  ) {
    this.defer = options.defer ?? queueMicrotask;
    this.intervention = new InterventionCoordinator(activator, {
      ...(options.onActivationSucceeded
        ? { onActivationSucceeded: options.onActivationSucceeded }
        : {}),
      ...(options.onActivationFailed
        ? { onActivationFailed: options.onActivationFailed }
        : {}),
    });
    this.scheduler = new SessionDeadlineScheduler({
      clock,
      schedule: timer.schedule,
      cancel: timer.cancel,
      advanceAt: (atMs) => this.bridge.advanceAt(atMs),
      onSchedulingError: (error) => this.handleSchedulingError(error),
    });
    this.bridge = new SessionActivityBridge(activityProvider, clock, {
      onStateChanged: (state) => {
        // Cancel or replace stale runtime work before exposing the snapshot.
        this.scheduler.synchronize(state);
        this.intervention.synchronize(state);
        this.options.onStateChanged?.(state);
      },
      onObservationError: (error) => this.options.onRuntimeError?.(error),
    });

    const initial = this.bridge.snapshot();
    this.scheduler.synchronize(initial);
    this.intervention.synchronize(initial);
  }

  snapshot(): FocusSessionState {
    return this.bridge.snapshot();
  }

  startMonitoring(): void {
    if (!this.disposed) this.bridge.startMonitoring();
  }

  startSession(
    sessionId: string,
    config: FocusSessionConfig,
  ): Promise<SessionReduction> {
    return this.disposed
      ? Promise.resolve(this.disposedFailure())
      : this.bridge.startSession(sessionId, config);
  }

  pause(): SessionReduction {
    return this.disposed ? this.disposedFailure() : this.bridge.pause();
  }

  resume(): Promise<SessionReduction> {
    return this.disposed
      ? Promise.resolve(this.disposedFailure())
      : this.bridge.resume();
  }

  stop(reason: StopReason): SessionReduction {
    return this.disposed ? this.disposedFailure() : this.bridge.stop(reason);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler.dispose();
    this.intervention.dispose();
    this.bridge.dispose();
  }

  private handleSchedulingError(error: SessionDeadlineSchedulingError): void {
    this.queueFailSafePause();
    this.options.onRuntimeError?.({
      code: `session-deadline-${error.code}`,
      message: `Focus timing stopped safely: ${error.message}`,
    });
  }

  private queueFailSafePause(): void {
    if (this.pauseQueued || this.disposed) return;
    this.pauseQueued = true;
    this.defer(() => {
      this.pauseQueued = false;
      if (this.disposed) return;
      const state = this.bridge.snapshot();
      if (!isActivelyRunning(state) || state.lastEventAtMs === null) return;
      const result = this.bridge.pauseAt(state.lastEventAtMs);
      if (!result.ok) {
        this.options.onRuntimeError?.({
          code: "session-fail-safe-pause-rejected",
          message: `Focus timing could not pause safely: ${result.error.message}`,
        });
      }
    });
  }

  private disposedFailure(): SessionReduction {
    return {
      ok: false,
      state: this.bridge.snapshot(),
      error: {
        code: "invalid-transition",
        message: "The session runtime has been disposed.",
      },
    };
  }
}

function isActivelyRunning(state: FocusSessionState): boolean {
  return (
    state.phase === "focused" ||
    state.phase === "grace" ||
    state.phase === "nudge" ||
    state.phase === "intervention"
  );
}
