export const SESSION_SCHEMA_VERSION = 1 as const;

export const SESSION_PHASES = [
  "idle",
  "focused",
  "grace",
  "nudge",
  "intervention",
  "paused",
  "completed",
  "stopped",
] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];
export type ActiveSessionPhase = Exclude<
  SessionPhase,
  "idle" | "paused" | "completed" | "stopped"
>;
export type SessionIntensity = "gentle" | "balanced" | "strict";
export type StopReason = "user" | "emergency";

export interface ObservedApplication {
  readonly bundleId: string;
  readonly name: string;
}

export interface FocusSessionConfig {
  readonly task: string;
  readonly targetApplication: ObservedApplication;
  readonly durationMs: number;
  readonly gracePeriodMs: number;
  readonly interventionAfterMs: number;
  readonly intensity: SessionIntensity;
}

export interface FocusSessionState {
  readonly schemaVersion: typeof SESSION_SCHEMA_VERSION;
  readonly sessionId: string | null;
  readonly phase: SessionPhase;
  readonly config: FocusSessionConfig | null;
  readonly currentApplication: ObservedApplication | null;
  readonly focusedMs: number;
  readonly awayMs: number;
  readonly currentAwayMs: number;
  readonly lastEventAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly stopReason: StopReason | null;
}

export type SessionEvent =
  | {
      readonly type: "session-started";
      readonly atMs: number;
      readonly sessionId: string;
      readonly config: FocusSessionConfig;
      readonly currentApplication: ObservedApplication;
    }
  | { readonly type: "time-advanced"; readonly atMs: number }
  | {
      readonly type: "application-changed";
      readonly atMs: number;
      readonly application: ObservedApplication;
    }
  | { readonly type: "session-paused"; readonly atMs: number }
  | {
      readonly type: "session-resumed";
      readonly atMs: number;
      readonly currentApplication: ObservedApplication;
    }
  | {
      readonly type: "session-stopped";
      readonly atMs: number;
      readonly reason: StopReason;
    };

export interface SessionTransition {
  readonly kind: "phase-changed";
  readonly from: SessionPhase;
  readonly to: SessionPhase;
  readonly atMs: number;
}

export type SessionErrorCode =
  | "invalid-config"
  | "invalid-event"
  | "out-of-order"
  | "invalid-transition"
  | "terminal-state";

export interface SessionError {
  readonly code: SessionErrorCode;
  readonly message: string;
}

export type SessionReduction =
  | {
      readonly ok: true;
      readonly state: FocusSessionState;
      readonly transitions: readonly SessionTransition[];
    }
  | {
      readonly ok: false;
      readonly state: FocusSessionState;
      readonly error: SessionError;
    };

export type ConfigValidation =
  | { readonly ok: true; readonly config: FocusSessionConfig }
  | { readonly ok: false; readonly error: SessionError };

export function createIdleSession(): FocusSessionState {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
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
  };
}

/**
 * Validates and normalizes configuration at the untrusted UI/persistence edge.
 * The reducer stores the normalized copy so later comparisons stay predictable.
 */
export function validateSessionConfig(input: unknown): ConfigValidation {
  if (!isRecord(input))
    return invalidConfig("Configuration must be an object.");

  const task = normalizeNonEmptyString(input.task);
  const targetApplication = normalizeApplication(input.targetApplication);
  const intensity = input.intensity;

  if (!task) return invalidConfig("Task must be a non-empty string.");
  if (!targetApplication) {
    return invalidConfig(
      "Target application must include a name and bundle ID.",
    );
  }
  if (!isPositiveInteger(input.durationMs)) {
    return invalidConfig(
      "Duration must be a positive integer number of milliseconds.",
    );
  }
  if (!isNonNegativeInteger(input.gracePeriodMs)) {
    return invalidConfig("Grace period must be a non-negative integer.");
  }
  if (!isNonNegativeInteger(input.interventionAfterMs)) {
    return invalidConfig(
      "Intervention threshold must be a non-negative integer.",
    );
  }
  if (input.interventionAfterMs <= input.gracePeriodMs) {
    return invalidConfig(
      "Intervention threshold must be greater than the grace period.",
    );
  }
  if (
    intensity !== "gentle" &&
    intensity !== "balanced" &&
    intensity !== "strict"
  ) {
    return invalidConfig("Intensity must be gentle, balanced, or strict.");
  }

  return {
    ok: true,
    config: {
      task,
      targetApplication,
      durationMs: input.durationMs,
      gracePeriodMs: input.gracePeriodMs,
      interventionAfterMs: input.interventionAfterMs,
      intensity,
    },
  };
}

/**
 * Applies one timestamped fact to a session snapshot. This function deliberately
 * owns no clock or side effects: callers can replay the same events and receive
 * byte-for-byte equivalent JSON state.
 */
export function reduceSession(
  state: FocusSessionState,
  event: SessionEvent,
): SessionReduction {
  const eventError = validateEvent(event);
  if (eventError) return rejected(state, eventError);

  if (event.type === "session-started") {
    return startSession(state, event);
  }

  if (state.phase === "idle") {
    return rejected(state, {
      code: "invalid-transition",
      message: `Cannot handle ${event.type} before a session starts.`,
    });
  }
  if (state.phase === "completed" || state.phase === "stopped") {
    return rejected(state, {
      code: "terminal-state",
      message: `Cannot handle ${event.type} after a session has ended.`,
    });
  }
  if (state.lastEventAtMs === null || state.config === null) {
    return rejected(state, {
      code: "invalid-transition",
      message: "Running session state is incomplete.",
    });
  }
  if (event.atMs < state.lastEventAtMs) {
    return rejected(state, {
      code: "out-of-order",
      message: "Event timestamp is earlier than the previous event.",
    });
  }

  const previousPhase = state.phase;
  const accrued = accrueUntil(state, event.atMs);
  if (accrued.phase === "completed") {
    return accepted(accrued, previousPhase, accrued.endedAtMs ?? event.atMs);
  }

  let next = accrued;
  switch (event.type) {
    case "time-advanced":
      break;
    case "application-changed":
      next = applyApplicationChange(accrued, event.application);
      break;
    case "session-paused":
      if (accrued.phase === "paused") {
        return rejected(state, {
          code: "invalid-transition",
          message: "Session is already paused.",
        });
      }
      next = {
        ...accrued,
        phase: "paused",
        currentAwayMs: 0,
      };
      break;
    case "session-resumed":
      if (accrued.phase !== "paused") {
        return rejected(state, {
          code: "invalid-transition",
          message: "Only a paused session can resume.",
        });
      }
      next = resumeSession(accrued, event.currentApplication);
      break;
    case "session-stopped":
      next = {
        ...accrued,
        phase: "stopped",
        currentAwayMs: 0,
        endedAtMs: event.atMs,
        stopReason: event.reason,
      };
      break;
  }

  return accepted(next, previousPhase, event.atMs);
}

function startSession(
  state: FocusSessionState,
  event: Extract<SessionEvent, { type: "session-started" }>,
): SessionReduction {
  if (state.phase !== "idle") {
    return rejected(state, {
      code:
        state.phase === "completed" || state.phase === "stopped"
          ? "terminal-state"
          : "invalid-transition",
      message: "A session can start only from idle.",
    });
  }

  const configResult = validateSessionConfig(event.config);
  if (!configResult.ok) return rejected(state, configResult.error);

  const sessionId = normalizeNonEmptyString(event.sessionId);
  const currentApplication = normalizeApplication(event.currentApplication);
  if (!sessionId || !currentApplication) {
    return rejected(state, {
      code: "invalid-event",
      message: "Session ID and current application must be non-empty.",
    });
  }

  const phase = isTargetApplication(currentApplication, configResult.config)
    ? "focused"
    : phaseForAwayMs(0, configResult.config);
  const next: FocusSessionState = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    phase,
    config: configResult.config,
    currentApplication,
    focusedMs: 0,
    awayMs: 0,
    currentAwayMs: 0,
    lastEventAtMs: event.atMs,
    endedAtMs: null,
    stopReason: null,
  };

  return accepted(next, "idle", event.atMs);
}

function accrueUntil(
  state: FocusSessionState,
  atMs: number,
): FocusSessionState {
  const lastEventAtMs = state.lastEventAtMs;
  const config = state.config;
  if (lastEventAtMs === null || config === null) return state;

  const elapsedMs = atMs - lastEventAtMs;
  if (state.phase === "paused") {
    return { ...state, lastEventAtMs: atMs };
  }

  if (state.phase === "focused") {
    const remainingMs = config.durationMs - state.focusedMs;
    if (elapsedMs >= remainingMs) {
      return {
        ...state,
        phase: "completed",
        focusedMs: config.durationMs,
        currentAwayMs: 0,
        lastEventAtMs: atMs,
        endedAtMs: lastEventAtMs + remainingMs,
      };
    }

    return {
      ...state,
      focusedMs: state.focusedMs + elapsedMs,
      lastEventAtMs: atMs,
    };
  }

  const currentAwayMs = state.currentAwayMs + elapsedMs;
  return {
    ...state,
    phase: phaseForAwayMs(currentAwayMs, config),
    awayMs: state.awayMs + elapsedMs,
    currentAwayMs,
    lastEventAtMs: atMs,
  };
}

function applyApplicationChange(
  state: FocusSessionState,
  applicationInput: ObservedApplication,
): FocusSessionState {
  const application = normalizeApplication(applicationInput);
  const config = state.config;
  if (!application || !config) return state;

  if (state.phase === "paused") {
    return { ...state, currentApplication: application };
  }

  const wasTarget =
    state.currentApplication !== null &&
    isTargetApplication(state.currentApplication, config);
  const isTarget = isTargetApplication(application, config);

  if (isTarget) {
    return {
      ...state,
      phase: "focused",
      currentApplication: application,
      currentAwayMs: 0,
    };
  }

  const currentAwayMs = wasTarget ? 0 : state.currentAwayMs;
  return {
    ...state,
    phase: phaseForAwayMs(currentAwayMs, config),
    currentApplication: application,
    currentAwayMs,
  };
}

function resumeSession(
  state: FocusSessionState,
  applicationInput: ObservedApplication,
): FocusSessionState {
  const application = normalizeApplication(applicationInput);
  const config = state.config;
  if (!application || !config) return state;

  return {
    ...state,
    phase: isTargetApplication(application, config)
      ? "focused"
      : phaseForAwayMs(0, config),
    currentApplication: application,
    currentAwayMs: 0,
  };
}

function accepted(
  state: FocusSessionState,
  previousPhase: SessionPhase,
  transitionAtMs: number,
): SessionReduction {
  const transitions: SessionTransition[] =
    previousPhase === state.phase
      ? []
      : [
          {
            kind: "phase-changed",
            from: previousPhase,
            to: state.phase,
            atMs: transitionAtMs,
          },
        ];
  return { ok: true, state, transitions };
}

function rejected(
  state: FocusSessionState,
  error: SessionError,
): SessionReduction {
  return { ok: false, state, error };
}

function phaseForAwayMs(
  awayMs: number,
  config: FocusSessionConfig,
): ActiveSessionPhase {
  if (awayMs < config.gracePeriodMs) return "grace";
  if (awayMs < config.interventionAfterMs) return "nudge";
  return "intervention";
}

function isTargetApplication(
  application: ObservedApplication,
  config: FocusSessionConfig,
): boolean {
  return application.bundleId === config.targetApplication.bundleId;
}

function validateEvent(event: unknown): SessionError | null {
  if (!isRecord(event) || typeof event.type !== "string") {
    return { code: "invalid-event", message: "Event must have a known type." };
  }
  if (!isNonNegativeInteger(event.atMs)) {
    return {
      code: "invalid-event",
      message: "Event timestamp must be a non-negative safe integer.",
    };
  }

  switch (event.type) {
    case "session-started":
      if (
        typeof event.sessionId !== "string" ||
        !isRecord(event.config) ||
        !normalizeApplication(event.currentApplication)
      ) {
        return {
          code: "invalid-event",
          message: "Session start event is malformed.",
        };
      }
      return null;
    case "time-advanced":
    case "session-paused":
      return null;
    case "application-changed":
      return normalizeApplication(event.application)
        ? null
        : {
            code: "invalid-event",
            message: "Application change event is malformed.",
          };
    case "session-resumed":
      return normalizeApplication(event.currentApplication)
        ? null
        : {
            code: "invalid-event",
            message: "Session resume event is malformed.",
          };
    case "session-stopped":
      return event.reason === "user" || event.reason === "emergency"
        ? null
        : {
            code: "invalid-event",
            message: "Session stop event is malformed.",
          };
    default:
      return {
        code: "invalid-event",
        message: `Unknown event type: ${event.type}.`,
      };
  }
}

function normalizeApplication(input: unknown): ObservedApplication | null {
  if (!isRecord(input)) return null;
  const bundleId = normalizeNonEmptyString(input.bundleId);
  const name = normalizeNonEmptyString(input.name);
  return bundleId && name ? { bundleId, name } : null;
}

function normalizeNonEmptyString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length > 0 ? value : null;
}

function isNonNegativeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && typeof input === "number" && input >= 0;
}

function isPositiveInteger(input: unknown): input is number {
  return isNonNegativeInteger(input) && input > 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function invalidConfig(message: string): ConfigValidation {
  return { ok: false, error: { code: "invalid-config", message } };
}
