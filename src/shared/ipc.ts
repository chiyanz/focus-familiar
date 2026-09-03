import { PET_WINDOW_SIZE_MAX, PET_WINDOW_SIZE_MIN } from "../core/settings";

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  windowAction: "window:action",
  getPetWindowPreferences: "settings:get-pet-window-preferences",
  setPetWindowSize: "settings:set-pet-window-size",
  listApplications: "applications:list",
  getSessionSnapshot: "session:get",
  startSession: "session:start",
  sessionAction: "session:action",
  getSessionPreferences: "settings:get-session-preferences",
  saveSessionPreferences: "settings:save-session-preferences",
  acknowledgePreferencesFlush: "settings:acknowledge-flush",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** Main-to-renderer notifications. Keep this allow-list separate from invoke channels. */
export const IPC_EVENTS = {
  sessionChanged: "session:changed",
  preferencesFlushRequested: "settings:flush-requested",
} as const;

export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

export const WINDOW_ACTIONS = [
  "show-settings",
  "hide-settings",
  "show-pet",
  "quit",
] as const;

export type WindowAction = (typeof WINDOW_ACTIONS)[number];

export const SESSION_ACTIONS = ["pause", "resume", "stop"] as const;

export type SessionAction = (typeof SESSION_ACTIONS)[number];

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

export const SESSION_INTENSITIES = ["gentle", "balanced", "strict"] as const;

export type SessionIntensity = (typeof SESSION_INTENSITIES)[number];

export type AppPlatform = "darwin" | "win32" | "linux" | "other";

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly platform: AppPlatform;
}

/**
 * The application identity is intentionally only what the user needs to pick
 * a target. In particular, session snapshots never contain the currently
 * foreground non-target application.
 */
export interface ApplicationSummary {
  readonly bundleId: string;
  readonly name: string;
}

/** User-editable session defaults. Recovery and other local settings stay main-process-only. */
export interface SessionPreferences {
  /** Preserve draft whitespace here; startSession trims the task at its boundary. */
  readonly taskDraft: string;
  readonly targetApplication: ApplicationSummary | null;
  readonly durationMs: number;
  readonly gracePeriodMs: number;
  readonly interventionAfterMs: number;
  readonly intensity: SessionIntensity;
}

/** The renderer-visible portion of pet-window preferences. */
export interface PetWindowPreferences {
  readonly sizePx: number;
}

export interface SessionStartConfig {
  readonly task: string;
  readonly targetApplication: ApplicationSummary;
  readonly durationMs: number;
  readonly gracePeriodMs: number;
  readonly interventionAfterMs: number;
  readonly intensity: SessionIntensity;
}

export interface SessionCapabilities {
  readonly canStart: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canStop: boolean;
}

export const SESSION_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/**
 * A sanitized, JSON-safe view of the main-process session state. Deliberately
 * omit currentApplication, lastEventAtMs, endedAtMs, and raw platform events.
 * The focused/away counters provide progress without exposing event timing.
 */
export interface SessionSnapshot {
  readonly schemaVersion: typeof SESSION_SNAPSHOT_SCHEMA_VERSION;
  readonly sessionId: string | null;
  readonly phase: SessionPhase;
  readonly task: string | null;
  readonly targetApplication: ApplicationSummary | null;
  readonly durationMs: number | null;
  readonly gracePeriodMs: number | null;
  readonly interventionAfterMs: number | null;
  readonly intensity: SessionIntensity | null;
  readonly focusedMs: number;
  readonly awayMs: number;
  readonly currentAwayMs: number;
  readonly capabilities: SessionCapabilities;
}

export interface FocusFamiliarApi {
  readonly getAppInfo: () => Promise<AppInfo>;
  readonly requestWindowAction: (action: WindowAction) => Promise<void>;
  readonly getPetWindowPreferences: () => Promise<PetWindowPreferences>;
  readonly setPetWindowSize: (sizePx: number) => Promise<PetWindowPreferences>;
  readonly listApplications: () => Promise<readonly ApplicationSummary[]>;
  readonly getSessionSnapshot: () => Promise<SessionSnapshot>;
  readonly startSession: (
    config: SessionStartConfig,
  ) => Promise<SessionSnapshot>;
  readonly requestSessionAction: (
    action: SessionAction,
  ) => Promise<SessionSnapshot>;
  readonly onSessionChanged: (
    listener: (snapshot: SessionSnapshot) => void,
  ) => () => void;
  readonly getSessionPreferences: () => Promise<SessionPreferences>;
  readonly saveSessionPreferences: (
    preferences: SessionPreferences,
  ) => Promise<SessionPreferences>;
  readonly onPreferencesFlushRequested: (
    listener: () => void | Promise<void>,
  ) => () => void;
}

export function isWindowAction(value: unknown): value is WindowAction {
  return (
    typeof value === "string" &&
    (WINDOW_ACTIONS as readonly string[]).includes(value)
  );
}

export function isSessionAction(value: unknown): value is SessionAction {
  return (
    typeof value === "string" &&
    (SESSION_ACTIONS as readonly string[]).includes(value)
  );
}

export function parseSessionAction(value: unknown): SessionAction {
  if (!isSessionAction(value)) {
    throw new Error("Unknown session action.");
  }

  return value;
}

export function parseSessionStartConfig(value: unknown): SessionStartConfig {
  if (!isRecord(value)) {
    throw new Error("Configuration must be an object.");
  }

  const task = normalizeNonEmptyString(value.task);
  const targetApplication = parseApplicationSummaryOrNull(
    value.targetApplication,
  );

  if (!task) throw new Error("Task must be a non-empty string.");
  if (!targetApplication) {
    throw new Error("Target application must include a name and bundle ID.");
  }
  if (!isPositiveInteger(value.durationMs)) {
    throw new Error(
      "Duration must be a positive integer number of milliseconds.",
    );
  }
  if (!isNonNegativeInteger(value.gracePeriodMs)) {
    throw new Error("Grace period must be a non-negative integer.");
  }
  if (!isNonNegativeInteger(value.interventionAfterMs)) {
    throw new Error("Intervention threshold must be a non-negative integer.");
  }
  if (value.interventionAfterMs <= value.gracePeriodMs) {
    throw new Error(
      "Intervention threshold must be greater than the grace period.",
    );
  }
  if (!isSessionIntensity(value.intensity)) {
    throw new Error("Intensity must be gentle, balanced, or strict.");
  }

  return {
    task,
    targetApplication,
    durationMs: value.durationMs,
    gracePeriodMs: value.gracePeriodMs,
    interventionAfterMs: value.interventionAfterMs,
    intensity: value.intensity,
  };
}

/**
 * Validate the renderer-editable session defaults. This parser intentionally
 * preserves taskDraft verbatim (including surrounding whitespace); the start
 * parser performs the non-empty trim when a session is actually launched.
 */
export function parseSessionPreferences(value: unknown): SessionPreferences {
  if (!isRecord(value)) {
    throw new Error("Preferences must be an object.");
  }

  if (typeof value.taskDraft !== "string") {
    throw new Error("Task draft must be a string.");
  }

  const targetApplication = parseApplicationSummaryOrNull(
    value.targetApplication,
  );
  if (targetApplication === undefined) {
    throw new Error(
      "Target application must be null or include a name and bundle ID.",
    );
  }
  if (!isPositiveInteger(value.durationMs)) {
    throw new Error(
      "Duration must be a positive integer number of milliseconds.",
    );
  }
  if (!isNonNegativeInteger(value.gracePeriodMs)) {
    throw new Error("Grace period must be a non-negative integer.");
  }
  if (!isNonNegativeInteger(value.interventionAfterMs)) {
    throw new Error("Intervention threshold must be a non-negative integer.");
  }
  if (value.interventionAfterMs <= value.gracePeriodMs) {
    throw new Error(
      "Intervention threshold must be greater than the grace period.",
    );
  }
  if (!isSessionIntensity(value.intensity)) {
    throw new Error("Intensity must be gentle, balanced, or strict.");
  }

  return {
    taskDraft: value.taskDraft,
    targetApplication,
    durationMs: value.durationMs,
    gracePeriodMs: value.gracePeriodMs,
    interventionAfterMs: value.interventionAfterMs,
    intensity: value.intensity,
  };
}

export function parsePetWindowSize(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < PET_WINDOW_SIZE_MIN ||
    (value as number) > PET_WINDOW_SIZE_MAX
  ) {
    throw new Error(
      `Pet size must be a whole number from ${PET_WINDOW_SIZE_MIN} to ${PET_WINDOW_SIZE_MAX} pixels.`,
    );
  }
  return value as number;
}

export function parsePetWindowPreferences(
  value: unknown,
): PetWindowPreferences {
  if (!isRecord(value)) {
    throw new Error("Malformed pet window preferences.");
  }
  try {
    return { sizePx: parsePetWindowSize(value.sizePx) };
  } catch {
    throw new Error("Malformed pet window preferences.");
  }
}

export function parsePreferencesFlushRequestId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error("Malformed preferences flush request.");
  }
  return value;
}

export function parseApplicationList(
  value: unknown,
): readonly ApplicationSummary[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed application list.");
  }

  const applications: ApplicationSummary[] = [];
  for (const item of value) {
    const application = parseApplicationSummaryOrNull(item);
    if (!application) throw new Error("Malformed application list.");
    applications.push(application);
  }

  return applications;
}

export function parseSessionSnapshot(value: unknown): SessionSnapshot {
  if (!isRecord(value)) {
    throw new Error("Malformed session snapshot.");
  }

  const sessionId = parseNullableNonEmptyString(value.sessionId);
  const task = parseNullableNonEmptyString(value.task);
  const targetApplication = parseApplicationSummaryOrNull(
    value.targetApplication,
  );
  const durationMs = parseNullablePositiveInteger(value.durationMs);
  const gracePeriodMs = parseNullableNonNegativeInteger(value.gracePeriodMs);
  const interventionAfterMs = parseNullableNonNegativeInteger(
    value.interventionAfterMs,
  );
  const intensity = parseNullableSessionIntensity(value.intensity);

  if (value.schemaVersion !== SESSION_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("Malformed session snapshot.");
  }
  if (!isSessionPhase(value.phase)) {
    throw new Error("Malformed session snapshot.");
  }
  if (
    sessionId === undefined ||
    task === undefined ||
    targetApplication === undefined
  ) {
    throw new Error("Malformed session snapshot.");
  }
  if (
    durationMs === undefined ||
    gracePeriodMs === undefined ||
    interventionAfterMs === undefined ||
    intensity === undefined
  ) {
    throw new Error("Malformed session snapshot.");
  }
  if (
    !isNonNegativeInteger(value.focusedMs) ||
    !isNonNegativeInteger(value.awayMs) ||
    !isNonNegativeInteger(value.currentAwayMs)
  ) {
    throw new Error("Malformed session snapshot.");
  }
  const capabilities = parseSessionCapabilities(value.capabilities);
  if (!capabilities) throw new Error("Malformed session snapshot.");

  const configValues = [
    task,
    targetApplication,
    durationMs,
    gracePeriodMs,
    interventionAfterMs,
    intensity,
  ];
  const hasConfig = configValues.some((entry) => entry !== null);
  const hasCompleteConfig = configValues.every((entry) => entry !== null);
  if (hasConfig !== hasCompleteConfig) {
    throw new Error("Malformed session snapshot.");
  }
  if (
    (sessionId === null && (value.phase !== "idle" || hasConfig)) ||
    (sessionId !== null && (value.phase === "idle" || !hasCompleteConfig))
  ) {
    throw new Error("Malformed session snapshot.");
  }

  if (
    value.currentAwayMs > value.awayMs ||
    (durationMs !== null && value.focusedMs > durationMs) ||
    (!hasCompleteConfig &&
      (value.focusedMs !== 0 ||
        value.awayMs !== 0 ||
        value.currentAwayMs !== 0))
  ) {
    throw new Error("Malformed session snapshot.");
  }
  if (
    gracePeriodMs !== null &&
    interventionAfterMs !== null &&
    interventionAfterMs <= gracePeriodMs
  ) {
    throw new Error("Malformed session snapshot.");
  }

  return {
    schemaVersion: SESSION_SNAPSHOT_SCHEMA_VERSION,
    sessionId,
    phase: value.phase,
    task,
    targetApplication,
    durationMs,
    gracePeriodMs,
    interventionAfterMs,
    intensity,
    focusedMs: value.focusedMs,
    awayMs: value.awayMs,
    currentAwayMs: value.currentAwayMs,
    capabilities,
  };
}

export function parseWindowAction(value: unknown): WindowAction {
  if (!isWindowAction(value)) {
    throw new Error("Unknown window action.");
  }

  return value;
}

export function parseAppInfo(value: unknown): AppInfo {
  if (!isRecord(value)) {
    throw new Error("Malformed app information.");
  }

  const { name, version, platform } = value;
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    !isAppPlatform(platform)
  ) {
    throw new Error("Malformed app information.");
  }

  return { name, version, platform };
}

export function toAppPlatform(platform: string): AppPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }

  return "other";
}

function isAppPlatform(value: unknown): value is AppPlatform {
  return (
    value === "darwin" ||
    value === "win32" ||
    value === "linux" ||
    value === "other"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionPhase(value: unknown): value is SessionPhase {
  return (
    typeof value === "string" &&
    (SESSION_PHASES as readonly string[]).includes(value)
  );
}

function isSessionIntensity(value: unknown): value is SessionIntensity {
  return (
    typeof value === "string" &&
    (SESSION_INTENSITIES as readonly string[]).includes(value)
  );
}

function parseApplicationSummaryOrNull(
  value: unknown,
): ApplicationSummary | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;

  const bundleId = normalizeNonEmptyString(value.bundleId);
  const name = normalizeNonEmptyString(value.name);
  return bundleId && name ? { bundleId, name } : undefined;
}

function parseNullableNonEmptyString(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;
  return normalizeNonEmptyString(value) ?? undefined;
}

function parseNullablePositiveInteger(
  value: unknown,
): number | null | undefined {
  if (value === null) return null;
  return isPositiveInteger(value) ? value : undefined;
}

function parseNullableNonNegativeInteger(
  value: unknown,
): number | null | undefined {
  if (value === null) return null;
  return isNonNegativeInteger(value) ? value : undefined;
}

function parseNullableSessionIntensity(
  value: unknown,
): SessionIntensity | null | undefined {
  if (value === null) return null;
  return isSessionIntensity(value) ? value : undefined;
}

function parseSessionCapabilities(value: unknown): SessionCapabilities | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.canStart !== "boolean" ||
    typeof value.canPause !== "boolean" ||
    typeof value.canResume !== "boolean" ||
    typeof value.canStop !== "boolean"
  ) {
    return null;
  }

  return {
    canStart: value.canStart,
    canPause: value.canPause,
    canResume: value.canResume,
    canStop: value.canStop,
  };
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}
