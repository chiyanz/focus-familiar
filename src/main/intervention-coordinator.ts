import type { FocusSessionState, ObservedApplication } from "../core";
import type {
  ApplicationActivator,
  ApplicationIdentity,
  PlatformError,
  PlatformResult,
} from "../platform/application";

/**
 * The identity of the session and application captured when an automatic
 * activation is requested. Keeping this alongside the result means a late
 * platform response cannot be mistaken for a response to a newer session.
 */
export interface InterventionActivationContext {
  readonly sessionId: string;
  readonly targetApplication: ObservedApplication;
}

export interface InterventionActivationSucceeded
  extends InterventionActivationContext {
  readonly activatedApplication: ApplicationIdentity;
}

export interface InterventionActivationFailed
  extends InterventionActivationContext {
  readonly error: PlatformError;
}

export const STRICT_INTERVENTION_WARNING_MS = 7_000;

export type InterventionTimerHandle = ReturnType<typeof setTimeout> | number;

export interface InterventionTimerDriver {
  readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => InterventionTimerHandle;
  readonly cancel: (handle: InterventionTimerHandle) => void;
}

export interface InterventionCoordinatorOptions {
  readonly onActivationSucceeded?: (
    result: InterventionActivationSucceeded,
  ) => void;
  readonly onActivationFailed?: (result: InterventionActivationFailed) => void;
  /** Production passes the session timer; zero preserves direct unit use. */
  readonly activationDelayMs?: number;
  readonly timer?: InterventionTimerDriver;
}

/**
 * Applies the side-effect policy for strict intervention states.
 *
 * Session snapshots are authoritative and arrive in order. The first one is
 * deliberately only a recovery baseline: restoring an already-intervening
 * session must not immediately activate an application. A subsequent phase
 * entry consumes one activation opportunity, and a phase exit rearms it.
 *
 * The production runtime gives this class a cancellable timer so the final
 * warning remains visible before activation. It never observes applications
 * or attempts to trap a user. The request result is reported to observers,
 * but never feeds back into synchronization or causes another side effect.
 */
export class InterventionCoordinator {
  private previousState: FocusSessionState | undefined;
  private activationArmed = true;
  private episodeGeneration = 0;
  private disposed = false;
  private pendingActivation: InterventionTimerHandle | undefined;
  private readonly activationDelayMs: number;
  private readonly timer: InterventionTimerDriver;

  constructor(
    private readonly activator: ApplicationActivator,
    private readonly options: InterventionCoordinatorOptions = {},
  ) {
    this.activationDelayMs = options.activationDelayMs ?? 0;
    if (
      !Number.isSafeInteger(this.activationDelayMs) ||
      this.activationDelayMs < 0
    ) {
      throw new RangeError("activationDelayMs must be a non-negative integer.");
    }
    this.timer = options.timer ?? {
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  /**
   * Reconciles one authoritative session snapshot.
   *
   * Synchronization is intentionally synchronous from the caller's
   * perspective. Activation is fire-and-forget so a slow or unavailable
   * platform cannot block state delivery.
   */
  synchronize(state: FocusSessionState): void {
    if (this.disposed) return;

    const previousState = this.previousState;
    if (!previousState) {
      // Safe recovery: an existing intervention is not treated as a new entry.
      this.previousState = state;
      return;
    }

    this.previousState = state;

    if (state.phase !== "intervention") {
      if (previousState.phase === "intervention") {
        this.invalidateEpisode(true);
      }
      return;
    }

    // Staying in the same intervention episode, including duplicate snapshots,
    // must never re-trigger. A different session identity is a new episode even
    // if recovery delivers both snapshots with the intervention phase.
    if (
      previousState.phase === "intervention" &&
      isSameInterventionEpisode(previousState, state)
    ) {
      // A stale phase can briefly coexist with a target foreground snapshot.
      // Treat that as a return for purposes of in-flight result delivery, but
      // do not rearm until the reducer reports a new intervention episode.
      if (!isTargetForeground(previousState) && isTargetForeground(state)) {
        this.invalidateEpisode(false);
      }
      return;
    }

    if (
      previousState.phase === "intervention" &&
      !isSameInterventionEpisode(previousState, state)
    ) {
      this.invalidateEpisode(true);
    }

    if (!this.activationArmed) return;
    this.episodeGeneration += 1;
    const requestGeneration = this.episodeGeneration;
    // Consume the opportunity for this intervention entry even when the mode
    // is gentle/balanced or the snapshot is incomplete. Such snapshots must
    // never accidentally activate later without a new away episode.
    this.activationArmed = false;

    if (state.config?.intensity !== "strict") return;

    // A restored or otherwise inconsistent snapshot may still say
    // "intervention" while the target is already foreground. Asking macOS to
    // activate it would be redundant and surprising, so wait for a genuine
    // away-and-return episode instead.
    if (isTargetForeground(state)) return;

    const context = captureContext(state);
    if (!context) return;

    if (this.activationDelayMs === 0) {
      void this.requestActivation(context, requestGeneration);
      return;
    }

    try {
      this.pendingActivation = this.timer.schedule(() => {
        this.pendingActivation = undefined;
        if (this.disposed || this.episodeGeneration !== requestGeneration) {
          return;
        }
        const currentState = this.previousState;
        if (
          !currentState ||
          currentState.phase !== "intervention" ||
          isTargetForeground(currentState)
        ) {
          return;
        }
        void this.requestActivation(context, requestGeneration);
      }, this.activationDelayMs);
    } catch (error: unknown) {
      this.options.onActivationFailed?.({
        ...context,
        error: {
          code: "activation-delay-failed",
          message: errorMessage(error),
        },
      });
    }
  }

  /**
   * Makes the coordinator inert. An in-flight request cannot always be
   * cancelled at the OS boundary, but its eventual result is ignored.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateEpisode(false);
    this.previousState = undefined;
  }

  private invalidateEpisode(rearm: boolean): void {
    this.episodeGeneration += 1;
    const pendingActivation = this.pendingActivation;
    this.pendingActivation = undefined;
    if (pendingActivation !== undefined) {
      try {
        this.timer.cancel(pendingActivation);
      } catch {
        // The generation guard still makes an uncancelled callback inert.
      }
    }
    this.activationArmed = rearm;
  }

  private async requestActivation(
    context: InterventionActivationContext,
    requestGeneration: number,
  ): Promise<void> {
    let result: PlatformResult<ApplicationIdentity>;
    try {
      result = await this.activator.activate(
        context.targetApplication.bundleId,
      );
    } catch (error: unknown) {
      result = { ok: false, error: errorToPlatformError(error) };
    }

    // Do not call callbacks after disposal, and do not inspect the current
    // session here. Completion is observational only; it cannot cause a new
    // activation or otherwise mutate the coordinator's episode state.
    if (this.disposed || this.episodeGeneration !== requestGeneration) {
      return;
    }

    if (result.ok) {
      this.options.onActivationSucceeded?.({
        ...context,
        activatedApplication: copyApplication(result.value),
      });
    } else {
      this.options.onActivationFailed?.({
        ...context,
        error: copyError(result.error),
      });
    }
  }
}

function captureContext(
  state: FocusSessionState,
): InterventionActivationContext | undefined {
  const sessionId = state.sessionId;
  const targetApplication = state.config?.targetApplication;
  if (
    typeof sessionId !== "string" ||
    sessionId.trim().length === 0 ||
    !targetApplication ||
    typeof targetApplication.bundleId !== "string" ||
    targetApplication.bundleId.trim().length === 0 ||
    typeof targetApplication.name !== "string" ||
    targetApplication.name.trim().length === 0
  ) {
    return undefined;
  }

  return {
    sessionId,
    targetApplication: copyApplication(targetApplication),
  };
}

function isSameInterventionEpisode(
  previousState: FocusSessionState,
  state: FocusSessionState,
): boolean {
  return (
    previousState.phase === "intervention" &&
    state.phase === "intervention" &&
    previousState.sessionId === state.sessionId &&
    previousState.config?.targetApplication.bundleId ===
      state.config?.targetApplication.bundleId
  );
}

function isTargetForeground(state: FocusSessionState): boolean {
  const targetBundleId = state.config?.targetApplication.bundleId;
  return Boolean(
    targetBundleId && state.currentApplication?.bundleId === targetBundleId,
  );
}

function copyApplication(
  application: ApplicationIdentity,
): ApplicationIdentity {
  return { bundleId: application.bundleId, name: application.name };
}

function copyError(error: PlatformError): PlatformError {
  return { code: error.code, message: error.message };
}

function errorToPlatformError(error: unknown): PlatformError {
  if (isPlatformError(error)) return copyError(error);

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Application activation failed.";
  return {
    code: "activation-request-failed",
    message: message || "Application activation failed.",
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "The final-warning timer could not be scheduled.";
}

function isPlatformError(error: unknown): error is PlatformError {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" && typeof candidate.message === "string"
  );
}
