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

export type PetPresentationMode = "still" | "loop";

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

/**
 * A low-arousal sleep cycle: two unhurried breaths, one quick ear twitch,
 * then a long settle. Per-frame timing avoids the mechanical feel of a
 * fixed-rate slideshow and gives future pet packs an explicit cadence to
 * replace.
 */
export const SLEEPING_BREATH_TIMELINE = [
  { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 1_100 },
  { asset: PET_ASSET_PATHS.idleInhaleStart, durationMs: 520 },
  { asset: PET_ASSET_PATHS.idleInhalePeak, durationMs: 720 },
  { asset: PET_ASSET_PATHS.idleExhaleStart, durationMs: 620 },
  { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 1_000 },
  { asset: PET_ASSET_PATHS.idleInhaleStart, durationMs: 520 },
  { asset: PET_ASSET_PATHS.idleInhalePeak, durationMs: 720 },
  { asset: PET_ASSET_PATHS.idleExhaleStart, durationMs: 620 },
  { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 1_300 },
  { asset: PET_ASSET_PATHS.idleEarTurn, durationMs: 260 },
  { asset: PET_ASSET_PATHS.idleEarTwitch, durationMs: 220 },
  { asset: PET_ASSET_PATHS.idleEarTurn, durationMs: 240 },
  { asset: PET_ASSET_PATHS.idleSettle, durationMs: 800 },
  { asset: PET_ASSET_PATHS.idleClose, durationMs: 1_400 },
] as const satisfies NonEmptyReadonlyArray<PetAnimationStep>;

/**
 * Every session phase has an explicit presentation. The `satisfies` check is
 * intentional: adding a core phase requires a renderer decision at compile
 * time instead of silently falling back to a generic image.
 */
export const PET_PRESENTATIONS = {
  idle: {
    timeline: SLEEPING_BREATH_TIMELINE,
    mode: "loop",
    provisional: false,
    statusText: "Ready when you are.",
  },
  focused: {
    timeline: SLEEPING_BREATH_TIMELINE,
    mode: "loop",
    provisional: false,
    statusText: "Focused with you.",
  },
  grace: {
    timeline: [{ asset: PET_ASSET_PATHS.graceGlance, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "A gentle glance. Come back when ready.",
  },
  nudge: {
    timeline: [{ asset: PET_ASSET_PATHS.nudgeStare, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Let’s return to your focus app.",
  },
  intervention: {
    timeline: [{ asset: PET_ASSET_PATHS.interventionWait, durationMs: null }],
    mode: "still",
    provisional: true,
    statusText: "Please return to your focus app.",
  },
  paused: {
    timeline: [{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Focus session paused.",
  },
  completed: {
    timeline: [{ asset: PET_ASSET_PATHS.forwardStretch, durationMs: null }],
    mode: "still",
    provisional: true,
    statusText: "Focus session complete.",
  },
  stopped: {
    timeline: [{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }],
    mode: "still",
    provisional: false,
    statusText: "Focus session stopped.",
  },
} as const satisfies Record<SessionPhase, PetPresentationDefinition>;

/**
 * Resolve one immutable renderer presentation for a core phase. Reduced
 * motion collapses every loop to its first frame and removes its timer.
 */
export function getPetPresentation(
  phase: SessionPhase,
  reducedMotion = false,
): PetPresentation {
  const definition = PET_PRESENTATIONS[phase];
  const shouldAnimate =
    !reducedMotion &&
    definition.mode === "loop" &&
    definition.timeline.length > 1;
  const firstStep = definition.timeline[0];

  return {
    phase,
    timeline: shouldAnimate
      ? definition.timeline
      : [{ asset: firstStep.asset, durationMs: null }],
    mode: shouldAnimate ? "loop" : "still",
    provisional: definition.provisional,
    statusText: definition.statusText,
    reducedMotion,
  };
}
