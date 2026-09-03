import type { PetAnimationStep } from "./pet-presentation";

type PetTimeline = readonly [PetAnimationStep, ...PetAnimationStep[]];

export interface PetAnimationClock {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export interface PetAnimationOptions {
  /** Loop by default; hover reactions opt into one-shot playback. */
  readonly loop?: boolean;
  readonly onComplete?: () => void;
}

/**
 * Play one non-empty timeline and return an idempotent stop function. The
 * clock is injected so timing stays deterministic in tests and independent of
 * session policy.
 */
export function startPetAnimation(
  timeline: PetTimeline,
  showAsset: (asset: PetAnimationStep["asset"]) => void,
  clock: PetAnimationClock,
  options: PetAnimationOptions = {},
): () => void {
  let stopped = false;
  let stepIndex = 0;
  let timer: number | undefined;
  const loop = options.loop ?? true;

  const scheduleCurrentStep = (): void => {
    const currentStep = timeline[stepIndex] ?? timeline[0];
    if (stopped || currentStep.durationMs === null) return;

    timer = clock.setTimeout(() => {
      timer = undefined;
      if (stopped) return;

      const nextStepIndex = stepIndex + 1;
      if (!loop && nextStepIndex >= timeline.length) {
        stopped = true;
        options.onComplete?.();
        return;
      }

      stepIndex = nextStepIndex % timeline.length;
      showAsset((timeline[stepIndex] ?? timeline[0]).asset);
      scheduleCurrentStep();
    }, currentStep.durationMs);
  };

  showAsset(timeline[0].asset);
  scheduleCurrentStep();

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  };
}
