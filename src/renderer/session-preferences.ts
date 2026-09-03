import type {
  ApplicationSummary,
  SessionIntensity,
  SessionPreferences,
  SessionStartConfig,
} from "../shared/ipc";

export type { SessionPreferences } from "../shared/ipc";

export const DEFAULT_SESSION_PREFERENCES: Readonly<SessionPreferences> = {
  taskDraft: "",
  targetApplication: null,
  durationMs: 25 * 60_000,
  gracePeriodMs: 10_000,
  interventionAfterMs: 60_000,
  intensity: "balanced",
};

/**
 * The core session contract keeps a non-empty task for compatibility, while
 * the settings UI lets the user leave the optional focus note blank.
 */
export function fallbackTaskForTarget(
  targetApplication: ApplicationSummary,
): string {
  return `Focus in ${targetApplication.name.trim()}`;
}

/** Convert the optional UI note into the non-empty task required by the core. */
export function taskForStart(
  taskDraft: string,
  targetApplication: ApplicationSummary,
): string {
  return taskDraft.trim() || fallbackTaskForTarget(targetApplication);
}

/** Keep legacy persisted `gentle` settings safe while the UI uses clearer names. */
export function normalizeSessionIntensity(
  intensity: SessionIntensity,
): Exclude<SessionIntensity, "gentle"> {
  return intensity === "gentle" ? "balanced" : intensity;
}

export function preferencesFromConfig(
  config: SessionStartConfig,
  taskDraft: string = config.task,
): SessionPreferences {
  return {
    taskDraft,
    targetApplication: { ...config.targetApplication },
    durationMs: config.durationMs,
    gracePeriodMs: config.gracePeriodMs,
    interventionAfterMs: config.interventionAfterMs,
    intensity: normalizeSessionIntensity(config.intensity),
  };
}

export function areSessionPreferencesEqual(
  left: SessionPreferences,
  right: SessionPreferences,
): boolean {
  return (
    left.taskDraft === right.taskDraft &&
    left.durationMs === right.durationMs &&
    left.gracePeriodMs === right.gracePeriodMs &&
    left.interventionAfterMs === right.interventionAfterMs &&
    left.intensity === right.intensity &&
    left.targetApplication?.bundleId === right.targetApplication?.bundleId &&
    left.targetApplication?.name === right.targetApplication?.name
  );
}
