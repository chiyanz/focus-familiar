import {
  SESSION_SCHEMA_VERSION,
  validateSessionConfig,
  type FocusSessionConfig,
  type FocusSessionState,
  type ObservedApplication,
  type SessionIntensity,
} from "./focus-session";

/** The current on-disk settings document version. */
export const SETTINGS_SCHEMA_VERSION = 1 as const;

/** Values supported by the motion preference in the settings UI. */
export const MOTION_PREFERENCES = ["system", "reduced", "full"] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

/** Supported square pet-window sizes in CSS pixels. */
export const PET_WINDOW_SIZE_MIN: number = 160;
export const PET_WINDOW_SIZE_DEFAULT: number = 248;
export const PET_WINDOW_SIZE_MAX: number = 480;

/**
 * The only data needed to position the pet window after a restart.
 * Coordinates can be negative when a display is positioned to the left or
 * above the primary display.
 */
export interface PetWindowPlacement {
  readonly displayId: string;
  readonly x: number;
  readonly y: number;
}

/** User-editable preferences stored by version 1. */
export interface SettingsPreferences {
  readonly taskDraft: string;
  readonly targetApplication: ObservedApplication | null;
  readonly durationMs: number;
  readonly gracePeriodMs: number;
  readonly interventionAfterMs: number;
  readonly intensity: SessionIntensity;
  readonly soundEnabled: boolean;
  readonly motionPreference: MotionPreference;
  readonly launchAtLogin: boolean;
  readonly petWindowSize: number;
  readonly petWindowPlacement: PetWindowPlacement | null;
}

/**
 * The intentionally small recovery payload written when an active session is
 * interrupted. It contains no foreground-event history or current
 * distraction application.
 */
export interface InterruptedSessionRecovery {
  readonly sessionId: string;
  readonly config: FocusSessionConfig;
  readonly focusedMs: number;
  readonly awayMs: number;
  readonly savedAtMs: number;
}

/** A recovered session is always paused until the user explicitly resumes it. */
export interface PausedSessionRecovery extends InterruptedSessionRecovery {
  readonly phase: "paused";
}

/** The version 1 JSON document stored by the local settings layer. */
export interface SettingsDocument {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly preferences: SettingsPreferences;
  readonly recovery: InterruptedSessionRecovery | null;
}

/** Alias that reads naturally at application call sites. */
export type FocusFamiliarSettings = SettingsDocument;

export type SettingsIssueCode =
  | "invalid-document"
  | "unsupported-schema-version"
  | "migrated"
  | "invalid-preferences"
  | "invalid-preference-field"
  | "invalid-recovery";

export interface SettingsIssue {
  readonly code: SettingsIssueCode;
  readonly message: string;
  readonly path?: string;
}

export interface SettingsParseResult {
  /** A sanitized, JSON-safe v1 document with unknown fields removed. */
  readonly settings: SettingsDocument;
  /**
   * A separate domain object for runtime restoration. The phase is explicit
   * here even though the compact persisted recovery payload does not store it.
   */
  readonly restoredRecovery: PausedSessionRecovery | null;
  /** Stable diagnostics suitable for logging or a non-blocking UI notice. */
  readonly issues: readonly SettingsIssue[];
}

/** Documented defaults for a new installation. */
export const DEFAULT_SETTINGS_PREFERENCES: Readonly<SettingsPreferences> = {
  taskDraft: "",
  targetApplication: null,
  durationMs: 25 * 60 * 1000,
  gracePeriodMs: 10 * 1000,
  interventionAfterMs: 60 * 1000,
  intensity: "balanced",
  soundEnabled: true,
  motionPreference: "system",
  launchAtLogin: false,
  petWindowSize: PET_WINDOW_SIZE_DEFAULT,
  petWindowPlacement: null,
};

/** Return whether a value is safe to persist as a pet-window size. */
export function isValidPetWindowSize(input: unknown): input is number {
  return (
    isSafeInteger(input) &&
    input >= PET_WINDOW_SIZE_MIN &&
    input <= PET_WINDOW_SIZE_MAX
  );
}

/**
 * Return a new default document. Every nested value is constructed afresh so
 * callers cannot mutate a shared settings singleton.
 */
export function createDefaultSettings(): SettingsDocument {
  return buildDocument(clonePreferences(DEFAULT_SETTINGS_PREFERENCES), null);
}

/**
 * Convert a persisted recovery payload into the runtime recovery domain.
 * Restored sessions are deliberately paused and the returned object is a
 * defensive copy.
 */
export function restorePausedRecovery(
  recovery: InterruptedSessionRecovery | null,
): PausedSessionRecovery | null {
  if (!recovery) return null;

  return {
    phase: "paused",
    sessionId: recovery.sessionId,
    config: cloneSessionConfig(recovery.config),
    focusedMs: recovery.focusedMs,
    awayMs: recovery.awayMs,
    savedAtMs: recovery.savedAtMs,
  };
}

/**
 * Project live runtime state into the deliberately narrow recovery payload.
 * Terminal and idle sessions are not recoverable, and foreground application
 * state is intentionally omitted.
 */
export function createInterruptedSessionRecovery(
  state: FocusSessionState,
  savedAtMs: number,
): InterruptedSessionRecovery | null {
  const sessionId = normalizeNonEmptyString(state.sessionId);
  if (
    !isRecoverablePhase(state.phase) ||
    !sessionId ||
    !state.config ||
    !isNonNegativeInteger(savedAtMs) ||
    !isNonNegativeInteger(state.focusedMs) ||
    !isNonNegativeInteger(state.awayMs)
  ) {
    return null;
  }

  const configResult = validateSessionConfig(state.config);
  if (!configResult.ok || state.focusedMs > configResult.config.durationMs) {
    return null;
  }

  return {
    sessionId,
    config: cloneSessionConfig(configResult.config),
    focusedMs: state.focusedMs,
    awayMs: state.awayMs,
    savedAtMs,
  };
}

/**
 * Rebuild safe runtime state after relaunch. The caller supplies a fresh
 * timestamp from the runtime clock; persisted wall time never accrues focus or
 * distraction. The current application is deliberately unknown until resume.
 */
export function createPausedSessionFromRecovery(
  recovery: unknown,
  restoredAtMs: number,
): FocusSessionState | null {
  const normalized = normalizeRecoveryCandidate(recovery);
  if (!normalized || !isNonNegativeInteger(restoredAtMs)) return null;

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: normalized.sessionId,
    phase: "paused",
    config: cloneSessionConfig(normalized.config),
    currentApplication: null,
    focusedMs: normalized.focusedMs,
    awayMs: normalized.awayMs,
    currentAwayMs: 0,
    lastEventAtMs: restoredAtMs,
    endedAtMs: null,
    stopReason: null,
  };
}

/**
 * Parse and sanitize an unknown value at the persistence boundary.
 *
 * Version 0 was a pre-release flat document. Its fixture was:
 *
 * ```json
 * {
 *   "schemaVersion": 0,
 *   "task": "Ship the release",
 *   "targetApplication": {"bundleId":"com.example.Editor","name":"Editor"},
 *   "durationMinutes": 25,
 *   "gracePeriodSeconds": 10,
 *   "interventionAfterSeconds": 60,
 *   "intensity": "balanced",
 *   "soundEnabled": true,
 *   "motionPreference": "system",
 *   "launchAtLogin": false,
 *   "petWindowSize": 320,
 *   "petWindowPlacement": {"displayId":"main","x":40,"y":80},
 *   "recovery": null
 * }
 * ```
 *
 * Migration maps the flat task and unit-based timing fields into the v1
 * `preferences` object. A pre-release document may also use the v1 millisecond
 * names; those are accepted as a compatibility courtesy before sanitization.
 * Unknown fields are never copied to the returned document.
 */
export function parseSettings(input: unknown): SettingsParseResult {
  if (!isRecord(input)) {
    return resultWithDefaults([
      issue("invalid-document", "Settings document must be a JSON object."),
    ]);
  }

  const version = input.schemaVersion;
  if (version === SETTINGS_SCHEMA_VERSION) {
    return parseV1(input);
  }

  if (version === 0) {
    const migrated = migrateV0(input);
    const parsed = parseV1(migrated);
    return {
      ...parsed,
      issues: [
        issue("migrated", "Migrated settings document from version 0."),
        ...parsed.issues,
      ],
    };
  }

  if (isSafeInteger(version) && version > SETTINGS_SCHEMA_VERSION) {
    return resultWithDefaults([
      issue(
        "unsupported-schema-version",
        "Settings document is from a newer unsupported schema version.",
        "schemaVersion",
      ),
    ]);
  }

  return resultWithDefaults([
    issue(
      "invalid-document",
      "Settings document has an unknown schema version.",
      "schemaVersion",
    ),
  ]);
}

/** Compatibility name for callers that prefer the storage-oriented wording. */
export const parseSettingsDocument = parseSettings;

function parseV1(input: Record<string, unknown>): SettingsParseResult {
  const issues: SettingsIssue[] = [];
  const preferences = normalizePreferences(input.preferences, issues);
  const recovery = normalizeRecovery(input, issues);
  const settings = buildDocument(preferences, recovery);

  return {
    settings,
    restoredRecovery: restorePausedRecovery(recovery),
    issues,
  };
}

function normalizePreferences(
  input: unknown,
  issues: SettingsIssue[],
): SettingsPreferences {
  if (!isRecord(input)) {
    issues.push(
      issue(
        "invalid-preferences",
        "Preferences must be a JSON object; documented defaults were used.",
        "preferences",
      ),
    );
    return clonePreferences(DEFAULT_SETTINGS_PREFERENCES);
  }

  const defaults = DEFAULT_SETTINGS_PREFERENCES;
  const taskDraft = normalizeStringPreference(
    input,
    "taskDraft",
    defaults.taskDraft,
    issues,
  );
  const targetApplication = normalizeNullableApplicationPreference(
    input,
    "targetApplication",
    defaults.targetApplication,
    issues,
  );

  const timing = normalizeTiming(input, issues);
  const intensity = normalizeEnumPreference(
    input,
    "intensity",
    defaults.intensity,
    isSessionIntensity,
    issues,
  );
  const soundEnabled = normalizeBooleanPreference(
    input,
    "soundEnabled",
    defaults.soundEnabled,
    issues,
  );
  const motionPreference = normalizeEnumPreference(
    input,
    "motionPreference",
    defaults.motionPreference,
    isMotionPreference,
    issues,
  );
  const launchAtLogin = normalizeBooleanPreference(
    input,
    "launchAtLogin",
    defaults.launchAtLogin,
    issues,
  );
  const petWindowSize = normalizePetWindowSizePreference(input, issues);
  const petWindowPlacement = normalizeNullablePlacementPreference(
    input,
    "petWindowPlacement",
    defaults.petWindowPlacement,
    issues,
  );

  return {
    taskDraft,
    targetApplication,
    durationMs: timing.durationMs,
    gracePeriodMs: timing.gracePeriodMs,
    interventionAfterMs: timing.interventionAfterMs,
    intensity,
    soundEnabled,
    motionPreference,
    launchAtLogin,
    petWindowSize,
    petWindowPlacement,
  };
}

function normalizePetWindowSizePreference(
  input: Record<string, unknown>,
  issues: SettingsIssue[],
): number {
  const defaults = DEFAULT_SETTINGS_PREFERENCES;
  if (!("petWindowSize" in input)) return defaults.petWindowSize;

  const value = input.petWindowSize;
  if (!isValidPetWindowSize(value)) {
    issues.push(
      issue(
        "invalid-preference-field",
        `Preference petWindowSize must be a whole number from ${PET_WINDOW_SIZE_MIN} to ${PET_WINDOW_SIZE_MAX}; its default was used.`,
        "preferences.petWindowSize",
      ),
    );
    return defaults.petWindowSize;
  }

  return value;
}

function normalizeTiming(
  input: Record<string, unknown>,
  issues: SettingsIssue[],
): Pick<
  SettingsPreferences,
  "durationMs" | "gracePeriodMs" | "interventionAfterMs"
> {
  const defaults = DEFAULT_SETTINGS_PREFERENCES;
  const durationMs = input.durationMs;
  const gracePeriodMs = input.gracePeriodMs;
  const interventionAfterMs = input.interventionAfterMs;

  if (
    !isPositiveInteger(durationMs) ||
    !isNonNegativeInteger(gracePeriodMs) ||
    !isPositiveInteger(interventionAfterMs) ||
    interventionAfterMs <= gracePeriodMs
  ) {
    issues.push(
      issue(
        "invalid-preference-field",
        "Timing preferences were invalid; documented timing defaults were used.",
        "preferences.timing",
      ),
    );
    return {
      durationMs: defaults.durationMs,
      gracePeriodMs: defaults.gracePeriodMs,
      interventionAfterMs: defaults.interventionAfterMs,
    };
  }

  return { durationMs, gracePeriodMs, interventionAfterMs };
}

function normalizeStringPreference(
  input: Record<string, unknown>,
  key: "taskDraft",
  fallback: string,
  issues: SettingsIssue[],
): string {
  if (!(key in input)) return fallback;
  const value = input[key];
  if (typeof value !== "string") {
    issues.push(
      issue(
        "invalid-preference-field",
        `Preference ${key} must be a string; its default was used.`,
        `preferences.${key}`,
      ),
    );
    return fallback;
  }
  return value;
}

function normalizeNullableApplicationPreference(
  input: Record<string, unknown>,
  key: "targetApplication",
  fallback: ObservedApplication | null,
  issues: SettingsIssue[],
): ObservedApplication | null {
  if (!(key in input)) return cloneApplication(fallback);
  const value = input[key];
  if (value === null) return null;
  const application = normalizeApplication(value);
  if (!application) {
    issues.push(
      issue(
        "invalid-preference-field",
        `Preference ${key} must be null or an application identity; its default was used.`,
        `preferences.${key}`,
      ),
    );
    return cloneApplication(fallback);
  }
  return application;
}

function normalizeNullablePlacementPreference(
  input: Record<string, unknown>,
  key: "petWindowPlacement",
  fallback: PetWindowPlacement | null,
  issues: SettingsIssue[],
): PetWindowPlacement | null {
  if (!(key in input)) return clonePlacement(fallback);
  const value = input[key];
  if (value === null) return null;
  const placement = normalizePlacement(value);
  if (!placement) {
    issues.push(
      issue(
        "invalid-preference-field",
        `Preference ${key} must be null or a window placement; its default was used.`,
        `preferences.${key}`,
      ),
    );
    return clonePlacement(fallback);
  }
  return placement;
}

function normalizeBooleanPreference(
  input: Record<string, unknown>,
  key: "soundEnabled" | "launchAtLogin",
  fallback: boolean,
  issues: SettingsIssue[],
): boolean {
  if (!(key in input)) return fallback;
  const value = input[key];
  if (typeof value !== "boolean") {
    issues.push(
      issue(
        "invalid-preference-field",
        `Preference ${key} must be a boolean; its default was used.`,
        `preferences.${key}`,
      ),
    );
    return fallback;
  }
  return value;
}

function normalizeEnumPreference<T extends string>(
  input: Record<string, unknown>,
  key: "intensity" | "motionPreference",
  fallback: T,
  isValid: (value: unknown) => value is T,
  issues: SettingsIssue[],
): T {
  if (!(key in input)) return fallback;
  const value = input[key];
  if (!isValid(value)) {
    issues.push(
      issue(
        "invalid-preference-field",
        `Preference ${key} had an unsupported value; its default was used.`,
        `preferences.${key}`,
      ),
    );
    return fallback;
  }
  return value;
}

function normalizeRecovery(
  input: Record<string, unknown>,
  issues: SettingsIssue[],
): InterruptedSessionRecovery | null {
  if (!("recovery" in input) || input.recovery === null) return null;
  const recovery = normalizeRecoveryCandidate(input.recovery);
  return recovery ?? invalidRecovery(issues);
}

function normalizeRecoveryCandidate(
  input: unknown,
): InterruptedSessionRecovery | null {
  if (!isRecord(input)) return null;

  const sessionId = normalizeNonEmptyString(input.sessionId);
  const configResult = validateSessionConfig(input.config);
  const focusedMs = input.focusedMs;
  const awayMs = input.awayMs;
  const savedAtMs = input.savedAtMs;
  if (
    !sessionId ||
    !configResult.ok ||
    !isNonNegativeInteger(focusedMs) ||
    !isNonNegativeInteger(awayMs) ||
    !isNonNegativeInteger(savedAtMs) ||
    (configResult.ok && focusedMs > configResult.config.durationMs)
  ) {
    return null;
  }

  return {
    sessionId,
    config: cloneSessionConfig(configResult.config),
    focusedMs,
    awayMs,
    savedAtMs,
  };
}

function isRecoverablePhase(
  phase: FocusSessionState["phase"],
): phase is "focused" | "grace" | "nudge" | "intervention" | "paused" {
  return (
    phase === "focused" ||
    phase === "grace" ||
    phase === "nudge" ||
    phase === "intervention" ||
    phase === "paused"
  );
}

function invalidRecovery(issues: SettingsIssue[]): null {
  issues.push(
    issue(
      "invalid-recovery",
      "Interrupted-session recovery was invalid and was discarded.",
      "recovery",
    ),
  );
  return null;
}

function migrateV0(input: Record<string, unknown>): Record<string, unknown> {
  const nested = isRecord(input.preferences) ? input.preferences : {};
  const source: Record<string, unknown> = { ...input, ...nested };
  const defaults = DEFAULT_SETTINGS_PREFERENCES;

  const targetApplication =
    source.targetApplication ??
    makeLegacyApplication(source.targetBundleId, source.targetName);

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    preferences: {
      taskDraft: source.taskDraft ?? source.task ?? "",
      targetApplication,
      durationMs:
        source.durationMs ??
        millisecondsFromUnits(source.durationMinutes, 60_000) ??
        defaults.durationMs,
      gracePeriodMs:
        source.gracePeriodMs ??
        millisecondsFromUnits(source.gracePeriodSeconds, 1_000) ??
        defaults.gracePeriodMs,
      interventionAfterMs:
        source.interventionAfterMs ??
        millisecondsFromUnits(source.interventionAfterSeconds, 1_000) ??
        defaults.interventionAfterMs,
      intensity: source.intensity ?? defaults.intensity,
      soundEnabled: source.soundEnabled ?? defaults.soundEnabled,
      motionPreference: source.motionPreference ?? defaults.motionPreference,
      launchAtLogin: source.launchAtLogin ?? defaults.launchAtLogin,
      petWindowSize:
        source.petWindowSize ??
        source.petWindowSizePx ??
        defaults.petWindowSize,
      petWindowPlacement: source.petWindowPlacement ?? null,
    },
    recovery: source.recovery ?? null,
  };
}

function millisecondsFromUnits(
  value: unknown,
  multiplier: number,
): number | undefined {
  if (!isNonNegativeInteger(value)) return undefined;
  const milliseconds = value * multiplier;
  return isNonNegativeInteger(milliseconds) ? milliseconds : undefined;
}

function makeLegacyApplication(
  bundleId: unknown,
  name: unknown,
): ObservedApplication | null {
  const normalizedBundleId = normalizeNonEmptyString(bundleId);
  const normalizedName = normalizeNonEmptyString(name);
  return normalizedBundleId && normalizedName
    ? { bundleId: normalizedBundleId, name: normalizedName }
    : null;
}

function buildDocument(
  preferences: SettingsPreferences,
  recovery: InterruptedSessionRecovery | null,
): SettingsDocument {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    preferences: clonePreferences(preferences),
    recovery: recovery ? cloneRecovery(recovery) : null,
  };
}

function resultWithDefaults(
  issues: readonly SettingsIssue[],
): SettingsParseResult {
  const settings = createDefaultSettings();
  return {
    settings,
    restoredRecovery: null,
    issues: [...issues],
  };
}

function clonePreferences(
  preferences: Readonly<SettingsPreferences>,
): SettingsPreferences {
  return {
    taskDraft: preferences.taskDraft,
    targetApplication: cloneApplication(preferences.targetApplication),
    durationMs: preferences.durationMs,
    gracePeriodMs: preferences.gracePeriodMs,
    interventionAfterMs: preferences.interventionAfterMs,
    intensity: preferences.intensity,
    soundEnabled: preferences.soundEnabled,
    motionPreference: preferences.motionPreference,
    launchAtLogin: preferences.launchAtLogin,
    petWindowSize: preferences.petWindowSize,
    petWindowPlacement: clonePlacement(preferences.petWindowPlacement),
  };
}

function cloneRecovery(
  recovery: InterruptedSessionRecovery,
): InterruptedSessionRecovery {
  return {
    sessionId: recovery.sessionId,
    config: cloneSessionConfig(recovery.config),
    focusedMs: recovery.focusedMs,
    awayMs: recovery.awayMs,
    savedAtMs: recovery.savedAtMs,
  };
}

function cloneSessionConfig(config: FocusSessionConfig): FocusSessionConfig {
  return {
    task: config.task,
    targetApplication: cloneApplication(
      config.targetApplication,
    ) as ObservedApplication,
    durationMs: config.durationMs,
    gracePeriodMs: config.gracePeriodMs,
    interventionAfterMs: config.interventionAfterMs,
    intensity: config.intensity,
  };
}

function cloneApplication(
  application: ObservedApplication | null,
): ObservedApplication | null {
  return application
    ? { bundleId: application.bundleId, name: application.name }
    : null;
}

function clonePlacement(
  placement: PetWindowPlacement | null,
): PetWindowPlacement | null {
  return placement
    ? { displayId: placement.displayId, x: placement.x, y: placement.y }
    : null;
}

function normalizeApplication(input: unknown): ObservedApplication | null {
  if (!isRecord(input)) return null;
  const bundleId = normalizeNonEmptyString(input.bundleId);
  const name = normalizeNonEmptyString(input.name);
  return bundleId && name ? { bundleId, name } : null;
}

function normalizePlacement(input: unknown): PetWindowPlacement | null {
  if (!isRecord(input)) return null;
  const displayId = normalizeNonEmptyString(input.displayId);
  return displayId && isSafeInteger(input.x) && isSafeInteger(input.y)
    ? { displayId, x: input.x, y: input.y }
    : null;
}

function normalizeNonEmptyString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length > 0 ? value : null;
}

function isSessionIntensity(input: unknown): input is SessionIntensity {
  return input === "gentle" || input === "balanced" || input === "strict";
}

function isMotionPreference(input: unknown): input is MotionPreference {
  return MOTION_PREFERENCES.includes(input as MotionPreference);
}

function isSafeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input);
}

function isNonNegativeInteger(input: unknown): input is number {
  return isSafeInteger(input) && input >= 0;
}

function isPositiveInteger(input: unknown): input is number {
  return isNonNegativeInteger(input) && input > 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function issue(
  code: SettingsIssueCode,
  message: string,
  path?: string,
): SettingsIssue {
  return path ? { code, message, path } : { code, message };
}
