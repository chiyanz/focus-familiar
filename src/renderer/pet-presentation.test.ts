import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SESSION_PHASES, type SessionPhase } from "../core";
import {
  FOCUSED_IDLE_LOOP_FRAMES,
  getPetPresentation,
  PET_ASSET_PATHS,
  PET_FRAME_DURATION_MS,
  PET_PRESENTATIONS,
} from "./pet-presentation";

const rendererDirectory = dirname(fileURLToPath(import.meta.url));

describe("pet presentation", () => {
  it("makes an explicit presentation decision for every session phase", () => {
    expect(Object.keys(PET_PRESENTATIONS).sort()).toEqual(
      [...SESSION_PHASES].sort(),
    );
  });

  it.each(SESSION_PHASES)(
    "returns one deterministic presentation for %s",
    (phase: SessionPhase) => {
      const presentation = getPetPresentation(phase);

      expect(presentation.phase).toBe(phase);
      expect(presentation.statusText).not.toContain("bundle");
      expect(presentation.statusText).not.toContain("URL");
      expect(presentation.reducedMotion).toBe(false);
    },
  );

  it("holds the neutral frame while idle, paused, and stopped", () => {
    for (const phase of ["idle", "paused", "stopped"] as const) {
      expect(getPetPresentation(phase)).toMatchObject({
        frames: [PET_ASSET_PATHS.idleNeutral],
        mode: "still",
        frameDurationMs: null,
        provisional: false,
      });
    }
  });

  it("animates the focused state with the ordered calm loop", () => {
    expect(getPetPresentation("focused")).toMatchObject({
      frames: FOCUSED_IDLE_LOOP_FRAMES,
      mode: "loop",
      frameDurationMs: PET_FRAME_DURATION_MS,
      provisional: false,
    });
  });

  it("uses the locked reaction stills for grace and nudge", () => {
    expect(getPetPresentation("grace")).toMatchObject({
      frames: [PET_ASSET_PATHS.graceGlance],
      mode: "still",
      frameDurationMs: null,
      provisional: false,
    });
    expect(getPetPresentation("nudge")).toMatchObject({
      frames: [PET_ASSET_PATHS.nudgeStare],
      mode: "still",
      frameDurationMs: null,
      provisional: false,
    });
  });

  it("marks intervention and completed art as provisional", () => {
    expect(getPetPresentation("intervention")).toMatchObject({
      frames: [PET_ASSET_PATHS.interventionWait],
      mode: "still",
      frameDurationMs: null,
      provisional: true,
    });
    expect(getPetPresentation("completed")).toMatchObject({
      frames: [PET_ASSET_PATHS.forwardStretch],
      mode: "still",
      frameDurationMs: null,
      provisional: true,
    });
  });

  it("collapses the focused loop to one frame for reduced motion", () => {
    expect(getPetPresentation("focused", true)).toMatchObject({
      frames: [PET_ASSET_PATHS.idleNeutral],
      mode: "still",
      frameDurationMs: null,
      reducedMotion: true,
    });
  });

  it("keeps all mapped asset paths local and bundled", () => {
    const paths = Object.values(PET_ASSET_PATHS);

    expect(new Set(paths).size).toBe(paths.length);
    for (const assetPath of paths) {
      expect(assetPath.startsWith("./assets/shokupan-cat/")).toBe(true);
      expect(assetPath.includes("docs/design")).toBe(false);
      expect(existsSync(resolve(rendererDirectory, assetPath))).toBe(true);
    }
  });

  it("uses a low-arousal 600ms focused frame interval", () => {
    expect(PET_FRAME_DURATION_MS).toBe(600);
    expect(getPetPresentation("focused").frameDurationMs).toBe(600);
    expect(getPetPresentation("focused", true).frameDurationMs).toBeNull();
    expect(getPetPresentation("grace").frameDurationMs).toBeNull();
  });
});
