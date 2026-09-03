import type { SessionPreferences, SessionStartConfig } from "../shared/ipc";

export type { SessionPreferences } from "../shared/ipc";

export const DEFAULT_SESSION_PREFERENCES: Readonly<SessionPreferences> = {
  taskDraft: "",
  targetApplication: null,
  durationMs: 25 * 60_000,
  gracePeriodMs: 10_000,
  interventionAfterMs: 60_000,
  intensity: "balanced",
};

export function preferencesFromConfig(
  config: SessionStartConfig,
): SessionPreferences {
  return {
    taskDraft: config.task,
    targetApplication: { ...config.targetApplication },
    durationMs: config.durationMs,
    gracePeriodMs: config.gracePeriodMs,
    interventionAfterMs: config.interventionAfterMs,
    intensity: config.intensity,
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
