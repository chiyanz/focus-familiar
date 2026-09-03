import {
  createIdleSession,
  reduceSession,
  type FocusSessionConfig,
  type FocusSessionState,
  type SessionEvent,
  type SessionReduction,
  type StopReason,
} from "../core";
import type {
  ActivityProvider,
  ApplicationActivityEvent,
  Clock,
  Disposable,
  PlatformError,
} from "../platform/application";

export interface SessionActivityBridgeOptions {
  readonly onStateChanged?: (state: FocusSessionState) => void;
  readonly onObservationError?: (error: PlatformError) => void;
}

/**
 * Connects normalized platform facts to the pure reducer. It deliberately
 * contains no UI policy: renderers consume state, while the core remains the
 * sole authority for timing and transitions.
 */
export class SessionActivityBridge {
  private state: FocusSessionState = createIdleSession();
  private observation: Disposable | undefined;
  private latestApplication:
    | (ApplicationActivityEvent & { readonly type: "application-activated" })
    | undefined;
  private applicationRevision = 0;
  private disposed = false;

  constructor(
    private readonly activityProvider: ActivityProvider,
    private readonly clock: Clock,
    private readonly options: SessionActivityBridgeOptions = {},
  ) {}

  snapshot(): FocusSessionState {
    return this.state;
  }

  startMonitoring(): void {
    if (this.disposed || this.observation) return;
    this.observation = this.activityProvider.observe((event) =>
      this.handleActivity(event),
    );
  }

  async startSession(
    sessionId: string,
    config: FocusSessionConfig,
  ): Promise<SessionReduction> {
    if (this.disposed) return this.disposedFailure();
    const startsAfterEndedSession =
      this.state.phase === "completed" || this.state.phase === "stopped";
    const revisionBeforeRequest = this.applicationRevision;
    const current = await this.activityProvider.currentApplication();
    if (this.disposed) return this.disposedFailure();
    if (!current.ok) return this.platformFailure(current.error);
    const currentApplication =
      this.applicationRevision > revisionBeforeRequest && this.latestApplication
        ? this.latestApplication.application
        : current.value;
    // Ended reducer snapshots remain immutable. A new user request starts a
    // distinct session from fresh idle state after platform prerequisites
    // have succeeded, rather than mutating the ended session.
    if (startsAfterEndedSession) this.state = createIdleSession();
    return this.dispatch({
      type: "session-started",
      atMs: this.clock.nowMs(),
      sessionId,
      config,
      currentApplication,
    });
  }

  pause(): SessionReduction {
    if (this.disposed) return this.disposedFailure();
    return this.pauseAt(this.clock.nowMs());
  }

  /** Pauses at an injected fail-safe boundary without consulting wall time. */
  pauseAt(atMs: number): SessionReduction {
    if (this.disposed) return this.disposedFailure();
    return this.dispatch({ type: "session-paused", atMs });
  }

  async resume(): Promise<SessionReduction> {
    if (this.disposed) return this.disposedFailure();
    const revisionBeforeRequest = this.applicationRevision;
    const current = await this.activityProvider.currentApplication();
    if (this.disposed) return this.disposedFailure();
    if (!current.ok) return this.platformFailure(current.error);
    const currentApplication =
      this.applicationRevision > revisionBeforeRequest && this.latestApplication
        ? this.latestApplication.application
        : current.value;
    return this.dispatch({
      type: "session-resumed",
      atMs: this.clock.nowMs(),
      currentApplication,
    });
  }

  stop(reason: StopReason): SessionReduction {
    if (this.disposed) return this.disposedFailure();
    return this.dispatch({
      type: "session-stopped",
      atMs: this.clock.nowMs(),
      reason,
    });
  }

  advance(): SessionReduction {
    if (this.disposed) return this.disposedFailure();
    return this.advanceAt(this.clock.nowMs());
  }

  /** Advances to an injected scheduler boundary without consulting wall time. */
  advanceAt(atMs: number): SessionReduction {
    if (this.disposed) return this.disposedFailure();
    return this.dispatch({ type: "time-advanced", atMs });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observation?.dispose();
    this.observation = undefined;
  }

  private handleActivity(event: ApplicationActivityEvent): void {
    if (this.disposed) return;
    if (event.type === "observation-error") {
      this.options.onObservationError?.(event.error);
      this.pauseSafely(event.atMs);
      return;
    }

    if (event.type === "system-sleep") {
      this.pauseSafely(event.atMs);
      return;
    }

    if (event.type === "application-activated" && isStarted(this.state)) {
      this.latestApplication = event;
      this.applicationRevision += 1;
      this.dispatchPlatformEvent({
        type: "application-changed",
        atMs: event.atMs,
        application: event.application,
      });
    } else if (event.type === "application-activated") {
      this.latestApplication = event;
      this.applicationRevision += 1;
    }
  }

  private dispatchPlatformEvent(event: SessionEvent): void {
    const result = this.dispatch(event);
    if (result.ok) return;

    this.options.onObservationError?.({
      code: "session-event-rejected",
      message: `A platform event was rejected: ${result.error.message}`,
    });
    if (isActivelyRunning(this.state)) {
      this.pauseSafely(this.clock.nowMs());
    }
  }

  private pauseSafely(atMs: number): void {
    if (!isActivelyRunning(this.state)) return;
    const safeAtMs = Math.max(atMs, this.state.lastEventAtMs ?? 0);
    const result = this.dispatch({ type: "session-paused", atMs: safeAtMs });
    if (!result.ok) {
      this.options.onObservationError?.({
        code: "session-pause-rejected",
        message: `Focus monitoring could not pause safely: ${result.error.message}`,
      });
    }
  }

  private dispatch(event: SessionEvent): SessionReduction {
    const result = reduceSession(this.state, event);
    if (result.ok) {
      this.state = result.state;
      this.options.onStateChanged?.(this.state);
    }
    return result;
  }

  private platformFailure(error: PlatformError): SessionReduction {
    this.options.onObservationError?.(error);
    return {
      ok: false,
      state: this.state,
      error: { code: "invalid-transition", message: error.message },
    };
  }

  private disposedFailure(): SessionReduction {
    return {
      ok: false,
      state: this.state,
      error: {
        code: "invalid-transition",
        message: "The session activity bridge has been disposed.",
      },
    };
  }
}

function isStarted(state: FocusSessionState): boolean {
  return (
    state.phase !== "idle" &&
    state.phase !== "completed" &&
    state.phase !== "stopped"
  );
}

function isActivelyRunning(state: FocusSessionState): boolean {
  return isStarted(state) && state.phase !== "paused";
}
