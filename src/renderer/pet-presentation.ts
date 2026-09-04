import type { SessionPhase } from "../core";
import type { SessionSnapshot } from "../shared/ipc";

/**
 * The renderer's deliberately small asset vocabulary. Keeping paths here
 * makes the state-to-art contract readable and gives future pet packs one
 * place to replace the default frame set.
 */
export const PET_ASSET_PATHS = {
  idleNeutral: "./assets/shokupan-cat/idle-loop/loop-01-neutral.png",
  idleInhaleStart: "./assets/shokupan-cat/idle-loop/loop-02-inhale-start.png",
  idleInhalePeak: "./assets/shokupan-cat/idle-loop/loop-03-inhale-peak.png",
  idleExhaleStart: "./assets/shokupan-cat/idle-loop/loop-04-exhale-start.png",
  graceGlance: "./assets/shokupan-cat/reactions/reaction-01-grace-glance.png",
  nudgePawTap: "./assets/shokupan-cat/reactions/reaction-05-paw-tap.png",
  interventionWait:
    "./assets/shokupan-cat/reactions/reaction-06-polite-wait.png",
  persistentSideEye: "./assets/shokupan-cat/reactions/reaction-04-side-eye.png",
  forwardStretch:
    "./assets/shokupan-cat/idle-actions/idle-05-forward-stretch.png",
  pawGroom: "./assets/shokupan-cat/idle-actions/idle-06-paw-groom.png",
} as const;

export type PetAssetPath =
  (typeof PET_ASSET_PATHS)[keyof typeof PET_ASSET_PATHS];

export type PetPresentationMode = "still" | "ambient";

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export interface PetAnimationStep {
  readonly asset: PetAssetPath;
  /** How long this frame remains visible. `null` means no timer is scheduled. */
  readonly durationMs: number | null;
}

export interface PetPresentationDefinition {
  readonly timeline: NonEmptyReadonlyArray<PetAnimationStep>;
  readonly mode: PetPresentationMode;
  readonly provisional: boolean;
  readonly statusText: string;
}

export interface PetPresentation extends PetPresentationDefinition {
  readonly phase: SessionPhase;
  readonly reducedMotion: boolean;
}

export interface PetHoverAction {
  readonly id: "big-stretch" | "paw-groom";
  readonly timeline: NonEmptyReadonlyArray<PetAnimationStep>;
}

/**
 * Four bottom-anchored frames make the sleeping loaf breathe. These are the
 * deliberately calm half of the original eight-frame set; the larger ear
 * motion is reserved for future polish instead of making the loop twitchy.
 */
export const SLEEPING_BREATH_TIMELINE = [
  { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 1_100 },
  { asset: PET_ASSET_PATHS.idleInhaleStart, durationMs: 800 },
  { asset: PET_ASSET_PATHS.idleInhalePeak, durationMs: 700 },
  { asset: PET_ASSET_PATHS.idleExhaleStart, durationMs: 900 },
] as const satisfies NonEmptyReadonlyArray<PetAnimationStep>;

/**
 * Short, one-shot ambient reactions use unmistakably different body poses.
 * Focus-policy reactions remain reserved for grace and away states.
 */
export const PET_HOVER_ACTIONS = [
  {
    id: "big-stretch",
    timeline: [
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 120 },
      { asset: PET_ASSET_PATHS.forwardStretch, durationMs: 900 },
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 240 },
    ],
  },
  {
    id: "paw-groom",
    timeline: [
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 120 },
      { asset: PET_ASSET_PATHS.pawGroom, durationMs: 900 },
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 240 },
    ],
  },
] as const satisfies readonly PetHoverAction[];

export function choosePetHoverAction(
  randomValue: number,
  previousActionId?: PetHoverAction["id"],
): PetHoverAction {
  const availableActions = PET_HOVER_ACTIONS.filter(
    ({ id }) => id !== previousActionId,
  );
  const normalizedRandomValue = Number.isFinite(randomValue)
    ? Math.min(Math.max(randomValue, 0), 1 - Number.EPSILON)
    : 0;
  const index = Math.floor(normalizedRandomValue * availableActions.length);

  return availableActions[index] ?? PET_HOVER_ACTIONS[0];
}

export function canPlayPetHoverAction(
  phase: SessionPhase,
  reducedMotion: boolean,
): boolean {
  return !reducedMotion && (phase === "idle" || phase === "focused");
}

/**
 * Every session phase has an explicit presentation. The `satisfies` check is
 * intentional: adding a core phase requires a renderer decision at compile
 * time instead of silently falling back to a generic image.
 */
export const PET_PRESENTATIONS = {
  idle: {
    timeline: SLEEPING_BREATH_TIMELINE,
    mode: "ambient",
    provisional: false,
    statusText: "Ready when you are",
  },
  focused: {
    timeline: SLEEPING_BREATH_TIMELINE,
    mode: "ambient",
    provisional: false,
    statusText: "Focused with you",
  },
  grace: {
    timeline: [{ asset: PET_ASSET_PATHS.graceGlance, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Come back when ready",
  },
  nudge: {
    timeline: [{ asset: PET_ASSET_PATHS.nudgePawTap, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Let’s head back",
  },
  intervention: {
    timeline: [{ asset: PET_ASSET_PATHS.interventionWait, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Time to return",
  },
  paused: {
    timeline: [{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Focus session paused",
  },
  completed: {
    timeline: [{ asset: PET_ASSET_PATHS.forwardStretch, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Focus session complete",
  },
  stopped: {
    timeline: [{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Focus session stopped",
  },
} as const satisfies Record<SessionPhase, PetPresentationDefinition>;

export const PET_INTERVENTION_REMINDER_INTERVAL_MS = 15_000;
export const PET_SIDE_EYE_AFTER_MS = PET_INTERVENTION_REMINDER_INTERVAL_MS;
export const PET_HINT_REVEAL_DURATION_MS = 7_000;

export type PetSnapshotPresentationStage = "base" | "persistent-side-eye";

export interface PetSnapshotStatus {
  readonly statusText: string;
  readonly attentionLevel: 0 | 1 | 2 | 3;
  readonly reminderBeat: number;
  readonly presentationStage: PetSnapshotPresentationStage;
  readonly presentationAsset: PetAssetPath | null;
}

/**
 * Derive stronger but reversible intervention feedback from the sanitized
 * session snapshot. This remains presentation-only: it never changes policy
 * or activates an application.
 */
export function getPetSnapshotStatus(
  snapshot: SessionSnapshot,
): PetSnapshotStatus {
  const base = PET_PRESENTATIONS[snapshot.phase].statusText;
  if (
    snapshot.phase !== "intervention" ||
    snapshot.interventionAfterMs === null
  ) {
    return {
      statusText: base,
      attentionLevel: 0,
      reminderBeat: 0,
      presentationStage: "base",
      presentationAsset: null,
    };
  }

  const elapsedAfterThreshold = Math.max(
    0,
    snapshot.currentAwayMs - snapshot.interventionAfterMs,
  );
  const reminderBeat = Math.floor(
    elapsedAfterThreshold / PET_INTERVENTION_REMINDER_INTERVAL_MS,
  );
  const isPersistentSideEye = elapsedAfterThreshold >= PET_SIDE_EYE_AFTER_MS;
  const attentionLevel = Math.min(3, 1 + Math.floor(reminderBeat / 2)) as
    | 1
    | 2
    | 3;
  const targetName = snapshot.targetApplication?.name ?? "your focus app";
  const copy = [
    `Time to return to ${targetName}`,
    `${targetName} is waiting`,
    `Let’s return to ${targetName}`,
  ] as const;

  return {
    statusText: copy[Math.min(copy.length - 1, attentionLevel - 1)] ?? copy[0],
    attentionLevel,
    reminderBeat,
    presentationStage: isPersistentSideEye ? "persistent-side-eye" : "base",
    presentationAsset: isPersistentSideEye
      ? PET_ASSET_PATHS.persistentSideEye
      : null,
  };
}

export interface PetSnapshotTransitionCue {
  readonly revealHint: boolean;
  readonly emphasizePet: boolean;
  readonly durationMs: number;
}

/**
 * Decide whether a new authoritative snapshot deserves a readable, temporary
 * status expansion. Duplicate counter snapshots remain silent, while every
 * phase change, intervention reminder, and side-eye arrival is surfaced.
 */
export function getPetSnapshotTransitionCue(
  previous: SessionSnapshot | undefined,
  next: SessionSnapshot,
): PetSnapshotTransitionCue {
  const nextStatus = getPetSnapshotStatus(next);
  if (!previous) {
    const revealHint = next.phase !== "idle";
    return {
      revealHint,
      emphasizePet: revealHint && next.phase === "intervention",
      durationMs: PET_HINT_REVEAL_DURATION_MS,
    };
  }

  const previousStatus = getPetSnapshotStatus(previous);
  const phaseChanged = previous.phase !== next.phase;
  const presentationChanged =
    previousStatus.presentationStage !== nextStatus.presentationStage;
  const interventionReminderChanged =
    next.phase === "intervention" &&
    (previous.phase !== "intervention" ||
      previousStatus.reminderBeat !== nextStatus.reminderBeat);
  const revealHint =
    phaseChanged || presentationChanged || interventionReminderChanged;

  return {
    revealHint,
    emphasizePet:
      next.phase === "intervention" &&
      (phaseChanged || presentationChanged || interventionReminderChanged),
    durationMs: PET_HINT_REVEAL_DURATION_MS,
  };
}

/**
 * Resolve snapshot-aware art without adding another policy phase. Prolonged
 * intervention can therefore change presentation while the core session
 * remains in its single, deterministic intervention state.
 */
export function getPetSnapshotPresentation(
  snapshot: SessionSnapshot,
  reducedMotion = false,
): PetPresentation {
  const base = getPetPresentation(snapshot.phase, reducedMotion);
  const status = getPetSnapshotStatus(snapshot);
  if (!status.presentationAsset) {
    return { ...base, statusText: status.statusText };
  }

  return {
    ...base,
    timeline: [{ asset: status.presentationAsset, durationMs: null }],
    mode: "still",
    statusText: status.statusText,
  };
}

/**
 * Resolve one immutable renderer presentation for a core phase. Reduced
 * motion collapses ambient movement to a calm still.
 */
export function getPetPresentation(
  phase: SessionPhase,
  reducedMotion = false,
): PetPresentation {
  const definition = PET_PRESENTATIONS[phase];
  const shouldAnimate = !reducedMotion && definition.mode === "ambient";
  const timeline = shouldAnimate
    ? definition.timeline
    : definition.mode === "ambient"
      ? ([{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }] as const)
      : definition.timeline;

  return {
    phase,
    timeline,
    mode: shouldAnimate ? "ambient" : "still",
    provisional: definition.provisional,
    statusText: definition.statusText,
    reducedMotion,
  };
}
