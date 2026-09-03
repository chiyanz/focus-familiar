import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SESSION_PHASES, type SessionPhase } from "../core";
import {
  getPetPresentation,
  PET_ASSET_PATHS,
  PET_PRESENTATIONS,
  SLEEPING_BREATH_TIMELINE,
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

  it("holds the neutral frame while paused and stopped", () => {
    for (const phase of ["paused", "stopped"] as const) {
      expect(getPetPresentation(phase)).toMatchObject({
        timeline: [{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }],
        mode: "still",
        provisional: false,
      });
    }
  });

  it("animates idle and focused states with the sleeping breath timeline", () => {
    for (const phase of ["idle", "focused"] as const) {
      expect(getPetPresentation(phase)).toMatchObject({
        timeline: SLEEPING_BREATH_TIMELINE,
        mode: "loop",
        provisional: false,
      });
    }
  });

  it("uses the locked reaction stills for grace and nudge", () => {
    expect(getPetPresentation("grace")).toMatchObject({
      timeline: [{ asset: PET_ASSET_PATHS.graceGlance, durationMs: null }],
      mode: "still",
      provisional: false,
    });
    expect(getPetPresentation("nudge")).toMatchObject({
      timeline: [{ asset: PET_ASSET_PATHS.nudgeStare, durationMs: null }],
      mode: "still",
      provisional: false,
    });
  });

  it("marks intervention and completed art as provisional", () => {
    expect(getPetPresentation("intervention")).toMatchObject({
      timeline: [{ asset: PET_ASSET_PATHS.interventionWait, durationMs: null }],
      mode: "still",
      provisional: true,
    });
    expect(getPetPresentation("completed")).toMatchObject({
      timeline: [{ asset: PET_ASSET_PATHS.forwardStretch, durationMs: null }],
      mode: "still",
      provisional: true,
    });
  });

  it("collapses idle and focused loops to one frame for reduced motion", () => {
    for (const phase of ["idle", "focused"] as const) {
      expect(getPetPresentation(phase, true)).toMatchObject({
        timeline: [{ asset: PET_ASSET_PATHS.idleNeutral, durationMs: null }],
        mode: "still",
        reducedMotion: true,
      });
    }
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

  it("uses a slow, non-uniform breathing cadence", () => {
    const durations = SLEEPING_BREATH_TIMELINE.map(
      ({ durationMs }) => durationMs,
    );

    expect(new Set(durations).size).toBeGreaterThan(4);
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(200);
    expect(durations.reduce((total, duration) => total + duration, 0)).toBe(
      10_040,
    );
  });
});
