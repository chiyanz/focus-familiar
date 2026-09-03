import { describe, expect, it } from "vitest";

import type { SessionStartConfig } from "../shared/ipc";
import {
  areSessionPreferencesEqual,
  DEFAULT_SESSION_PREFERENCES,
  preferencesFromConfig,
} from "./session-preferences";

const config: SessionStartConfig = {
  task: "Ship the prototype",
  targetApplication: {
    bundleId: "com.example.editor",
    name: "Editor",
  },
  durationMs: 30 * 60_000,
  gracePeriodMs: 15_000,
  interventionAfterMs: 90_000,
  intensity: "strict",
};

describe("session preferences", () => {
  it("projects a start config into the persisted draft shape", () => {
    expect(preferencesFromConfig(config)).toEqual({
      taskDraft: config.task,
      targetApplication: config.targetApplication,
      durationMs: config.durationMs,
      gracePeriodMs: config.gracePeriodMs,
      interventionAfterMs: config.interventionAfterMs,
      intensity: config.intensity,
    });
  });

  it("keeps a safe blank draft as the renderer fallback", () => {
    expect(DEFAULT_SESSION_PREFERENCES).toMatchObject({
      taskDraft: "",
      targetApplication: null,
      durationMs: 25 * 60_000,
      gracePeriodMs: 10_000,
      interventionAfterMs: 60_000,
      intensity: "balanced",
    });
  });

  it("compares application identity and preference values", () => {
    const same = { ...DEFAULT_SESSION_PREFERENCES };
    const changedTarget = {
      ...same,
      targetApplication: {
        bundleId: "com.example.editor",
        name: "Editor",
      },
    };
    const renamedTarget = {
      ...changedTarget,
      targetApplication: {
        bundleId: "com.example.editor",
        name: "Code Editor",
      },
    };

    expect(areSessionPreferencesEqual(same, { ...same })).toBe(true);
    expect(areSessionPreferencesEqual(same, changedTarget)).toBe(false);
    expect(areSessionPreferencesEqual(changedTarget, renamedTarget)).toBe(
      false,
    );
  });
});
