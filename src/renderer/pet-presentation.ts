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

export const PET_FRAME_DURATION_MS = 600 as const;

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export interface PetPresentationDefinition {
  readonly frames: NonEmptyReadonlyArray<PetAssetPath>;
  readonly mode: PetPresentationMode;
  readonly provisional: boolean;
  readonly statusText: string;
}

export interface PetPresentation extends PetPresentationDefinition {
  readonly phase: SessionPhase;
  readonly reducedMotion: boolean;
  /** `null` means that the presentation must not schedule a timer. */
  readonly frameDurationMs: number | null;
}

/** The calm loop is intentionally ordered as a low-arousal breathing cycle. */
export const FOCUSED_IDLE_LOOP_FRAMES = [
  PET_ASSET_PATHS.idleNeutral,
  PET_ASSET_PATHS.idleInhaleStart,
  PET_ASSET_PATHS.idleInhalePeak,
  PET_ASSET_PATHS.idleExhaleStart,
  PET_ASSET_PATHS.idleEarTurn,
  PET_ASSET_PATHS.idleEarTwitch,
  PET_ASSET_PATHS.idleSettle,
  PET_ASSET_PATHS.idleClose,
] as const satisfies NonEmptyReadonlyArray<PetAssetPath>;

/**
 * Every session phase has an explicit presentation. The `satisfies` check is
 * intentional: adding a core phase requires a renderer decision at compile
 * time instead of silently falling back to a generic image.
 */
export const PET_PRESENTATIONS = {
  idle: {
    frames: [PET_ASSET_PATHS.idleNeutral],
    mode: "still",
    provisional: false,
    statusText: "Ready when you are.",
  },
  focused: {
    frames: FOCUSED_IDLE_LOOP_FRAMES,
    mode: "loop",
    provisional: false,
    statusText: "Focused with you.",
  },
  grace: {
    frames: [PET_ASSET_PATHS.graceGlance],
    mode: "still",
    provisional: false,
    statusText: "A gentle glance. Come back when ready.",
  },
  nudge: {
    frames: [PET_ASSET_PATHS.nudgeStare],
    mode: "still",
    provisional: false,
    statusText: "Let’s return to your focus app.",
  },
  intervention: {
    frames: [PET_ASSET_PATHS.interventionWait],
    mode: "still",
    provisional: true,
    statusText: "Please return to your focus app.",
  },
  paused: {
    frames: [PET_ASSET_PATHS.idleNeutral],
    mode: "still",
    provisional: false,
    statusText: "Focus session paused.",
  },
  completed: {
    frames: [PET_ASSET_PATHS.forwardStretch],
    mode: "still",
    provisional: true,
    statusText: "Focus session complete.",
  },
  stopped: {
    frames: [PET_ASSET_PATHS.idleNeutral],
    mode: "still",
    provisional: false,
    statusText: "Focus session stopped.",
  },
} as const satisfies Record<SessionPhase, PetPresentationDefinition>;

/**
 * Resolve one immutable renderer presentation for a core phase. Reduced
 * motion collapses even the focused loop to its first frame and removes the
 * timer interval entirely.
 */
export function getPetPresentation(
  phase: SessionPhase,
  reducedMotion = false,
): PetPresentation {
  const definition = PET_PRESENTATIONS[phase];
  const shouldAnimate =
    !reducedMotion &&
    definition.mode === "loop" &&
    definition.frames.length > 1;

  return {
    phase,
    frames: shouldAnimate ? definition.frames : [definition.frames[0]],
    mode: shouldAnimate ? "loop" : "still",
    provisional: definition.provisional,
    statusText: definition.statusText,
    reducedMotion,
    frameDurationMs: shouldAnimate ? PET_FRAME_DURATION_MS : null,
  };
}
