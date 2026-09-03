import { describe, expect, it, vi } from "vitest";

import { PET_ASSET_PATHS, type PetAnimationStep } from "./pet-presentation";
import { startPetAnimation, type PetAnimationClock } from "./pet-animation";

function createClock() {
  let nextHandle = 1;
  const pending = new Map<
    number,
    { readonly callback: () => void; readonly delayMs: number }
  >();
  const clock: PetAnimationClock = {
    setTimeout(callback, delayMs) {
      const handle = nextHandle++;
      pending.set(handle, { callback, delayMs });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
  };

  return {
    clock,
    pending,
    runNext() {
      const entry = pending.entries().next().value;
      if (!entry) throw new Error("No animation timer is pending.");
      const [handle, task] = entry;
      pending.delete(handle);
      task.callback();
    },
  };
}

describe("pet animation player", () => {
  it("renders immediately and follows each step's own duration", () => {
    const timeline = [
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 1_100 },
      { asset: PET_ASSET_PATHS.idleInhaleStart, durationMs: 520 },
    ] as const satisfies readonly [PetAnimationStep, ...PetAnimationStep[]];
    const rendered: string[] = [];
    const { clock, pending, runNext } = createClock();

    startPetAnimation(timeline, (asset) => rendered.push(asset), clock);

    expect(rendered).toEqual([PET_ASSET_PATHS.idleNeutral]);
    expect([...pending.values()].map(({ delayMs }) => delayMs)).toEqual([
      1_100,
    ]);

    runNext();
    expect(rendered.at(-1)).toBe(PET_ASSET_PATHS.idleInhaleStart);
    expect([...pending.values()].map(({ delayMs }) => delayMs)).toEqual([520]);

    runNext();
    expect(rendered.at(-1)).toBe(PET_ASSET_PATHS.idleNeutral);
  });

  it("does not schedule a still presentation", () => {
    const showAsset = vi.fn();
    const { clock, pending } = createClock();

    startPetAnimation(
      [{ asset: PET_ASSET_PATHS.graceGlance, durationMs: null }],
      showAsset,
      clock,
    );

    expect(showAsset).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
  });

  it("stops a pending loop idempotently", () => {
    const showAsset = vi.fn();
    const { clock, pending } = createClock();
    const stop = startPetAnimation(
      [
        { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 1_100 },
        { asset: PET_ASSET_PATHS.idleInhaleStart, durationMs: 520 },
      ],
      showAsset,
      clock,
    );

    stop();
    stop();

    expect(pending.size).toBe(0);
    expect(showAsset).toHaveBeenCalledOnce();
  });

  it("plays a one-shot timeline once and reports completion", () => {
    const rendered: string[] = [];
    const onComplete = vi.fn();
    const { clock, pending, runNext } = createClock();

    startPetAnimation(
      [
        { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 120 },
        { asset: PET_ASSET_PATHS.idleEarTurn, durationMs: 180 },
      ],
      (asset) => rendered.push(asset),
      clock,
      { loop: false, onComplete },
    );

    runNext();
    runNext();

    expect(rendered).toEqual([
      PET_ASSET_PATHS.idleNeutral,
      PET_ASSET_PATHS.idleEarTurn,
    ]);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
  });

  it("does not complete a cancelled one-shot timeline", () => {
    const onComplete = vi.fn();
    const { clock, pending } = createClock();
    const stop = startPetAnimation(
      [
        { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 120 },
        { asset: PET_ASSET_PATHS.idleEarTurn, durationMs: 180 },
      ],
      vi.fn(),
      clock,
      { loop: false, onComplete },
    );

    stop();

    expect(pending.size).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
