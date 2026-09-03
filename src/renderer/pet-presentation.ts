import type { SessionPhase } from "../core";

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
  idleEarTurn: "./assets/shokupan-cat/idle-loop/loop-05-ear-turn.png",
  idleEarTwitch: "./assets/shokupan-cat/idle-loop/loop-06-ear-twitch.png",
  idleSettle: "./assets/shokupan-cat/idle-loop/loop-07-settle.png",
  idleClose: "./assets/shokupan-cat/idle-loop/loop-08-close.png",
  graceGlance: "./assets/shokupan-cat/reactions/reaction-01-grace-glance.png",
  nudgeStare: "./assets/shokupan-cat/reactions/reaction-03-half-lens-stare.png",
  interventionWait:
    "./assets/shokupan-cat/reactions/reaction-06-polite-wait.png",
  forwardStretch:
    "./assets/shokupan-cat/idle-actions/idle-05-forward-stretch.png",
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
  readonly id: "ear-twitch" | "sleepy-blink";
  readonly timeline: NonEmptyReadonlyArray<PetAnimationStep>;
}

/**
 * Ambient breathing uses one stable sprite plus a continuous CSS transform.
 * Keeping the baseline fixed avoids visible jumps between independently
 * generated keyframes while still giving the loaf a quiet breathing rhythm.
 */
export const SLEEPING_BREATH_TIMELINE = [
  { asset: PET_ASSET_PATHS.idleNeutral, durationMs: null },
] as const satisfies NonEmptyReadonlyArray<PetAnimationStep>;

/**
 * Short, one-shot ambient reactions. They intentionally reuse only idle art;
 * focus-policy reactions remain reserved for grace and nudge states.
 */
export const PET_HOVER_ACTIONS = [
  {
    id: "ear-twitch",
    timeline: [
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 120 },
      { asset: PET_ASSET_PATHS.idleEarTurn, durationMs: 180 },
      { asset: PET_ASSET_PATHS.idleEarTwitch, durationMs: 240 },
      { asset: PET_ASSET_PATHS.idleEarTurn, durationMs: 180 },
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 280 },
    ],
  },
  {
    id: "sleepy-blink",
    timeline: [
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 120 },
      { asset: PET_ASSET_PATHS.idleSettle, durationMs: 180 },
      { asset: PET_ASSET_PATHS.idleClose, durationMs: 520 },
      { asset: PET_ASSET_PATHS.idleSettle, durationMs: 180 },
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 280 },
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
    statusText: "A gentle glance · come back when ready",
  },
  nudge: {
    timeline: [{ asset: PET_ASSET_PATHS.nudgeStare, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Let’s return to your focus app",
  },
  intervention: {
    timeline: [{ asset: PET_ASSET_PATHS.interventionWait, durationMs: null }],
    mode: "still",
    provisional: true,
    statusText: "Please return to your focus app",
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
    provisional: true,
    statusText: "Focus session complete",
  },
  stopped: {
    timeline: [{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Focus session stopped",
  },
} as const satisfies Record<SessionPhase, PetPresentationDefinition>;

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

  return {
    phase,
    timeline: definition.timeline,
    mode: shouldAnimate ? "ambient" : "still",
    provisional: definition.provisional,
    statusText: definition.statusText,
    reducedMotion,
  };
}
