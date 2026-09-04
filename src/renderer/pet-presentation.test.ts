import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SESSION_PHASES, type SessionPhase } from "../core";
import {
  canPlayPetHoverAction,
  choosePetHoverAction,
  getPetPresentation,
  getPetSnapshotPresentation,
  getPetSnapshotStatus,
  PET_ASSET_PATHS,
  PET_HOVER_ACTIONS,
  PET_PRESENTATIONS,
  PET_PERSISTENT_STARE_AFTER_MS,
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
      expect(presentation.statusText).not.toMatch(/\.$/);
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

  it("animates idle and focused states with the complete breathing loop", () => {
    for (const phase of ["idle", "focused"] as const) {
      expect(getPetPresentation(phase)).toMatchObject({
        timeline: SLEEPING_BREATH_TIMELINE,
        mode: "ambient",
        provisional: false,
      });
    }
  });

  it("maps every away phase to its own non-idle reaction pose", () => {
    const awayContract = {
      grace: PET_ASSET_PATHS.graceGlance,
      nudge: PET_ASSET_PATHS.nudgePawTap,
      intervention: PET_ASSET_PATHS.interventionWait,
    } as const;
    const awayAssets = Object.values(awayContract);

    expect(new Set(awayAssets).size).toBe(awayAssets.length);
    for (const [phase, asset] of Object.entries(awayContract)) {
      expect(getPetPresentation(phase as SessionPhase)).toMatchObject({
        timeline: [{ asset, durationMs: null }],
        mode: "still",
        provisional: false,
      });
      expect(asset).toContain("/reactions/");
      expect(asset).not.toContain("/idle-loop/");
      expect(asset).not.toBe(PET_ASSET_PATHS.idleNeutral);
    }
  });

  it("celebrates completion with a distinct stretch pose", () => {
    expect(getPetPresentation("completed")).toMatchObject({
      timeline: [{ asset: PET_ASSET_PATHS.forwardStretch, durationMs: null }],
      mode: "still",
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

  it("keeps ambient breathing on four ordered, timed frames", () => {
    expect(SLEEPING_BREATH_TIMELINE).toEqual([
      { asset: PET_ASSET_PATHS.idleNeutral, durationMs: 1_100 },
      { asset: PET_ASSET_PATHS.idleInhaleStart, durationMs: 800 },
      { asset: PET_ASSET_PATHS.idleInhalePeak, durationMs: 700 },
      { asset: PET_ASSET_PATHS.idleExhaleStart, durationMs: 900 },
    ]);
    expect(
      new Set(SLEEPING_BREATH_TIMELINE.map(({ asset }) => asset)).size,
    ).toBe(4);
    expect(
      SLEEPING_BREATH_TIMELINE.every(
        ({ durationMs }) => durationMs !== null && durationMs > 0,
      ),
    ).toBe(true);
  });

  it("selects non-repeating hover actions with an injected random value", () => {
    expect(choosePetHoverAction(0).id).toBe("big-stretch");
    expect(choosePetHoverAction(0.999).id).toBe("paw-groom");
    expect(choosePetHoverAction(0, "big-stretch").id).toBe("paw-groom");
    expect(choosePetHoverAction(Number.NaN, "paw-groom").id).toBe(
      "big-stretch",
    );
  });

  it("reserves hover actions for full-motion ambient phases", () => {
    for (const phase of SESSION_PHASES) {
      expect(canPlayPetHoverAction(phase, false)).toBe(
        phase === "idle" || phase === "focused",
      );
      expect(canPlayPetHoverAction(phase, true)).toBe(false);
    }
  });

  it("uses obvious idle-only body poses for hover actions", () => {
    const reactionAssets = new Set<string>([
      PET_ASSET_PATHS.graceGlance,
      PET_ASSET_PATHS.nudgePawTap,
      PET_ASSET_PATHS.interventionWait,
      PET_ASSET_PATHS.persistentStare,
    ]);
    const ambientAssets = new Set<string>(
      SLEEPING_BREATH_TIMELINE.map(({ asset }) => asset),
    );

    expect(PET_HOVER_ACTIONS).toHaveLength(2);
    for (const action of PET_HOVER_ACTIONS) {
      expect(action.timeline[0].asset).toBe(PET_ASSET_PATHS.idleNeutral);
      expect(action.timeline.at(-1)?.asset).toBe(PET_ASSET_PATHS.idleNeutral);
      expect(
        action.timeline.some(
          ({ asset }) =>
            asset.includes("/idle-actions/") && !ambientAssets.has(asset),
        ),
      ).toBe(true);
      for (const step of action.timeline) {
        expect(reactionAssets.has(step.asset)).toBe(false);
      }
    }
  });

  it("strengthens intervention copy and attention without changing policy", () => {
    const base = {
      schemaVersion: 1 as const,
      sessionId: "session-1",
      phase: "intervention" as const,
      task: "Ship",
      targetApplication: { bundleId: "com.example.Editor", name: "Editor" },
      durationMs: 60_000,
      gracePeriodMs: 1_000,
      interventionAfterMs: 5_000,
      intensity: "balanced" as const,
      focusedMs: 0,
      awayMs: 5_000,
      currentAwayMs: 5_000,
      capabilities: {
        canStart: false,
        canPause: true,
        canResume: false,
        canStop: true,
      },
    };

    expect(getPetSnapshotStatus(base)).toMatchObject({
      statusText: "Time to return to Editor",
      attentionLevel: 1,
      reminderBeat: 0,
      presentationStage: "base",
      presentationAsset: null,
    });
    expect(
      getPetSnapshotStatus({
        ...base,
        currentAwayMs:
          base.interventionAfterMs + PET_PERSISTENT_STARE_AFTER_MS - 1,
      }),
    ).toMatchObject({
      presentationStage: "base",
      presentationAsset: null,
    });
    expect(
      getPetSnapshotStatus({
        ...base,
        awayMs: 35_000,
        currentAwayMs: 35_000,
      }),
    ).toMatchObject({
      statusText: "Editor is waiting",
      attentionLevel: 2,
      reminderBeat: 2,
      presentationStage: "persistent-stare",
      presentationAsset: PET_ASSET_PATHS.persistentStare,
    });
    expect(
      getPetSnapshotStatus({
        ...base,
        awayMs: 65_000,
        currentAwayMs: 65_000,
      }),
    ).toMatchObject({
      statusText: "Let’s return to Editor",
      attentionLevel: 3,
      reminderBeat: 4,
      presentationStage: "persistent-stare",
      presentationAsset: PET_ASSET_PATHS.persistentStare,
    });
  });

  it("adds the close-up stare only after prolonged intervention", () => {
    const snapshot = {
      schemaVersion: 1 as const,
      sessionId: "session-1",
      phase: "intervention" as const,
      task: "Ship",
      targetApplication: { bundleId: "com.example.Editor", name: "Editor" },
      durationMs: 60_000,
      gracePeriodMs: 1_000,
      interventionAfterMs: 5_000,
      intensity: "balanced" as const,
      focusedMs: 0,
      awayMs: 35_000,
      currentAwayMs: 35_000,
      capabilities: {
        canStart: false,
        canPause: true,
        canResume: false,
        canStop: true,
      },
    };

    expect(getPetSnapshotPresentation(snapshot)).toMatchObject({
      phase: "intervention",
      timeline: [{ asset: PET_ASSET_PATHS.persistentStare, durationMs: null }],
      mode: "still",
    });
    expect(PET_ASSET_PATHS.persistentStare).toContain(
      "reaction-03-half-lens-stare",
    );
  });
});
