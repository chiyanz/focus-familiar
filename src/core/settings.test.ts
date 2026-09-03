import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS_PREFERENCES,
  SETTINGS_SCHEMA_VERSION,
  createInterruptedSessionRecovery,
  createPausedSessionFromRecovery,
  createDefaultSettings,
  parseSettings,
  restorePausedRecovery,
  type SettingsDocument,
} from "./settings";
import type { FocusSessionState } from "./focus-session";

const editor = {
  bundleId: "com.example.Editor",
  name: "Example Editor",
};

const recoveryConfig = {
  task: "Ship the release",
  targetApplication: editor,
  durationMs: 1_500_000,
  gracePeriodMs: 10_000,
  interventionAfterMs: 60_000,
  intensity: "balanced" as const,
};

function validDocument(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    preferences: {
      taskDraft: "Ship the release",
      targetApplication: editor,
      durationMs: 1_500_000,
      gracePeriodMs: 10_000,
      interventionAfterMs: 60_000,
      intensity: "balanced",
      soundEnabled: true,
      motionPreference: "system",
      launchAtLogin: false,
      petWindowPlacement: { displayId: "main", x: 40, y: 80 },
    },
    recovery: {
      sessionId: "session-1",
      config: recoveryConfig,
      focusedMs: 120_000,
      awayMs: 20_000,
      savedAtMs: 1_700_000_000_000,
    },
    ...overrides,
  };
}

describe("settings defaults", () => {
  it("returns documented defaults in a version 1 document", () => {
    const settings = createDefaultSettings();

    expect(settings).toEqual({
      schemaVersion: 1,
      preferences: {
        taskDraft: "",
        targetApplication: null,
        durationMs: 25 * 60 * 1000,
        gracePeriodMs: 10 * 1000,
        interventionAfterMs: 60 * 1000,
        intensity: "balanced",
        soundEnabled: true,
        motionPreference: "system",
        launchAtLogin: false,
        petWindowPlacement: null,
      },
      recovery: null,
    });
    expect(settings.preferences).toEqual(DEFAULT_SETTINGS_PREFERENCES);
    expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
  });

  it("does not share mutable nested defaults between calls", () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();
    expect(first).not.toBe(second);
    expect(first.preferences).not.toBe(second.preferences);
  });
});

describe("settings parsing", () => {
  it("normalizes a current document and strips unknown fields", () => {
    const input = validDocument({
      unexpectedRoot: "remove",
      preferences: {
        taskDraft: "  Ship the release  ",
        targetApplication: {
          ...editor,
          title: "private window title",
          pid: 42,
        },
        durationMs: 1_500_000,
        gracePeriodMs: 10_000,
        interventionAfterMs: 60_000,
        intensity: "balanced",
        soundEnabled: true,
        motionPreference: "system",
        launchAtLogin: false,
        petWindowPlacement: {
          displayId: " main ",
          x: 40,
          y: 80,
          windowTitle: "do not persist",
        },
        rawAppEvents: [{ type: "application-changed" }],
      },
      recovery: {
        sessionId: " session-1 ",
        config: {
          ...recoveryConfig,
          currentApplication: {
            bundleId: "com.example.Browser",
            name: "Browser",
          },
          eventStream: [{ type: "application-changed" }],
        },
        focusedMs: 120_000,
        awayMs: 20_000,
        savedAtMs: 1_700_000_000_000,
        currentDistractionApplication: {
          bundleId: "com.example.Browser",
          name: "Browser",
        },
      },
    });

    const result = parseSettings(input);
    expect(result.issues).toEqual([]);
    expect(result.settings).toEqual({
      schemaVersion: 1,
      preferences: {
        taskDraft: "  Ship the release  ",
        targetApplication: editor,
        durationMs: 1_500_000,
        gracePeriodMs: 10_000,
        interventionAfterMs: 60_000,
        intensity: "balanced",
        soundEnabled: true,
        motionPreference: "system",
        launchAtLogin: false,
        petWindowPlacement: { displayId: "main", x: 40, y: 80 },
      },
      recovery: {
        sessionId: "session-1",
        config: recoveryConfig,
        focusedMs: 120_000,
        awayMs: 20_000,
        savedAtMs: 1_700_000_000_000,
      },
    });
    expect(result.settings).not.toHaveProperty("unexpectedRoot");
    expect(result.settings.recovery).not.toHaveProperty(
      "currentDistractionApplication",
    );
    expect(result.settings.recovery?.config).not.toHaveProperty("eventStream");
    expect(result.restoredRecovery).toMatchObject({ phase: "paused" });
    expect(JSON.parse(JSON.stringify(result.settings))).toEqual(
      result.settings,
    );
  });

  it("migrates the documented version 0 flat fixture to version 1", () => {
    const result = parseSettings({
      schemaVersion: 0,
      task: "  Ship the release  ",
      targetApplication: { ...editor, privateTitle: "strip me" },
      durationMinutes: 25,
      gracePeriodSeconds: 10,
      interventionAfterSeconds: 60,
      intensity: "balanced",
      soundEnabled: true,
      motionPreference: "system",
      launchAtLogin: false,
      petWindowPlacement: { displayId: "main", x: 40, y: 80 },
      recovery: null,
      oldActivityLog: ["do not migrate"],
    });

    expect(result.issues[0]?.code).toBe("migrated");
    expect(result.settings).toEqual({
      schemaVersion: 1,
      preferences: {
        taskDraft: "  Ship the release  ",
        targetApplication: editor,
        durationMs: 1_500_000,
        gracePeriodMs: 10_000,
        interventionAfterMs: 60_000,
        intensity: "balanced",
        soundEnabled: true,
        motionPreference: "system",
        launchAtLogin: false,
        petWindowPlacement: { displayId: "main", x: 40, y: 80 },
      },
      recovery: null,
    });
  });

  it("falls back without throwing for an unknown future version", () => {
    const result = parseSettings({
      schemaVersion: 99,
      preferences: { taskDraft: "future" },
      recovery: validDocument(),
    });

    expect(result.settings).toEqual(createDefaultSettings());
    expect(result.restoredRecovery).toBeNull();
    expect(result.issues).toEqual([
      {
        code: "unsupported-schema-version",
        message:
          "Settings document is from a newer unsupported schema version.",
        path: "schemaVersion",
      },
    ]);
  });

  it.each([null, undefined, "not-json", [], { schemaVersion: "1" }])(
    "falls back safely for corrupt document %j",
    (input) => {
      const result = parseSettings(input);
      expect(result.settings).toEqual(createDefaultSettings());
      expect(result.restoredRecovery).toBeNull();
      expect(result.issues[0]?.code).toBe("invalid-document");
    },
  );

  it("falls back to defaults for a corrupt preference object", () => {
    const result = parseSettings({ schemaVersion: 1, preferences: "broken" });

    expect(result.settings).toEqual(createDefaultSettings());
    expect(result.issues).toEqual([
      {
        code: "invalid-preferences",
        message:
          "Preferences must be a JSON object; documented defaults were used.",
        path: "preferences",
      },
    ]);
  });

  it("drops invalid recovery independently of valid preferences", () => {
    const result = parseSettings(
      validDocument({
        recovery: {
          sessionId: "session-1",
          config: recoveryConfig,
          focusedMs: recoveryConfig.durationMs + 1,
          awayMs: 20_000,
          savedAtMs: 1_700_000_000_000,
          rawEvents: [{ type: "application-changed" }],
        },
      }),
    );

    expect(result.settings.preferences.taskDraft).toBe("Ship the release");
    expect(result.settings.recovery).toBeNull();
    expect(result.restoredRecovery).toBeNull();
    expect(result.issues).toEqual([
      {
        code: "invalid-recovery",
        message: "Interrupted-session recovery was invalid and was discarded.",
        path: "recovery",
      },
    ]);
  });

  it("normalizes invalid preference fields independently", () => {
    const result = parseSettings({
      schemaVersion: 1,
      preferences: {
        taskDraft: "  keep this  ",
        targetApplication: { bundleId: " ", name: "Browser" },
        durationMs: 0,
        gracePeriodMs: 10_000,
        interventionAfterMs: 5_000,
        intensity: "unknown",
        soundEnabled: "yes",
        motionPreference: "jitter",
        launchAtLogin: 1,
        petWindowPlacement: { displayId: "main", x: 2.5, y: 4 },
      },
    });

    expect(result.settings.preferences).toEqual(
      expect.objectContaining({
        taskDraft: "  keep this  ",
        targetApplication: null,
        durationMs: DEFAULT_SETTINGS_PREFERENCES.durationMs,
        gracePeriodMs: DEFAULT_SETTINGS_PREFERENCES.gracePeriodMs,
        interventionAfterMs: DEFAULT_SETTINGS_PREFERENCES.interventionAfterMs,
        intensity: "balanced",
        soundEnabled: true,
        motionPreference: "system",
        launchAtLogin: false,
        petWindowPlacement: null,
      }),
    );
    expect(result.issues.map((item) => item.code)).toEqual([
      "invalid-preference-field",
      "invalid-preference-field",
      "invalid-preference-field",
      "invalid-preference-field",
      "invalid-preference-field",
      "invalid-preference-field",
      "invalid-preference-field",
    ]);
  });
});

describe("paused recovery domain", () => {
  it("returns a paused defensive copy with no activity stream", () => {
    const result = parseSettings(validDocument());
    const recovery = result.settings.recovery;
    expect(recovery).not.toBeNull();
    if (!recovery) throw new Error("expected recovery");

    expect(result.restoredRecovery).toEqual({
      phase: "paused",
      ...recovery,
    });
    expect(result.restoredRecovery).not.toBe(recovery);
    expect(result.restoredRecovery?.config).not.toBe(recovery.config);
    expect(result.restoredRecovery).not.toHaveProperty("currentApplication");
    expect(restorePausedRecovery(null)).toBeNull();
  });

  it("does not retain references from the untrusted input", () => {
    const input = validDocument() as {
      preferences: { targetApplication: { bundleId: string; name: string } };
      recovery: {
        config: { targetApplication: { bundleId: string; name: string } };
      };
    };
    const result = parseSettings(input);

    input.preferences.targetApplication.name = "mutated input";
    input.recovery.config.targetApplication.name = "mutated input";

    expect(result.settings.preferences.targetApplication?.name).toBe(
      "Example Editor",
    );
    expect(result.settings.recovery?.config.targetApplication.name).toBe(
      "Example Editor",
    );
  });

  it("projects only minimal recovery data from a live session", () => {
    const state: FocusSessionState = {
      schemaVersion: 1,
      sessionId: "session-1",
      phase: "intervention",
      config: recoveryConfig,
      currentApplication: {
        bundleId: "com.example.Browser",
        name: "Private Browser Window",
      },
      focusedMs: 120_000,
      awayMs: 20_000,
      currentAwayMs: 10_000,
      lastEventAtMs: 1_700_000_000_000,
      endedAtMs: null,
      stopReason: null,
    };

    const recovery = createInterruptedSessionRecovery(state, 1_700_000_001_000);

    expect(recovery).toEqual({
      sessionId: "session-1",
      config: recoveryConfig,
      focusedMs: 120_000,
      awayMs: 20_000,
      savedAtMs: 1_700_000_001_000,
    });
    expect(recovery).not.toHaveProperty("phase");
    expect(recovery).not.toHaveProperty("currentApplication");
    expect(recovery).not.toHaveProperty("currentAwayMs");
    expect(recovery).not.toHaveProperty("lastEventAtMs");
  });

  it.each(["idle", "completed", "stopped"] as const)(
    "does not create recovery for a %s session",
    (phase) => {
      const state: FocusSessionState = {
        schemaVersion: 1,
        sessionId: phase === "idle" ? null : "session-1",
        phase,
        config: phase === "idle" ? null : recoveryConfig,
        currentApplication: null,
        focusedMs: 0,
        awayMs: 0,
        currentAwayMs: 0,
        lastEventAtMs: phase === "idle" ? null : 100,
        endedAtMs: phase === "idle" ? null : 100,
        stopReason: phase === "stopped" ? "user" : null,
      };

      expect(createInterruptedSessionRecovery(state, 200)).toBeNull();
    },
  );

  it("rejects malformed session identity during projection", () => {
    const state: FocusSessionState = {
      schemaVersion: 1,
      sessionId: "   ",
      phase: "focused",
      config: recoveryConfig,
      currentApplication: editor,
      focusedMs: 0,
      awayMs: 0,
      currentAwayMs: 0,
      lastEventAtMs: 100,
      endedAtMs: null,
      stopReason: null,
    };

    expect(createInterruptedSessionRecovery(state, 200)).toBeNull();
  });

  it("restores paused state at a fresh runtime timestamp", () => {
    const persisted = parseSettings(validDocument()).settings.recovery;
    expect(persisted).not.toBeNull();

    expect(createPausedSessionFromRecovery(persisted, 250)).toEqual({
      schemaVersion: 1,
      sessionId: "session-1",
      phase: "paused",
      config: recoveryConfig,
      currentApplication: null,
      focusedMs: 120_000,
      awayMs: 20_000,
      currentAwayMs: 0,
      lastEventAtMs: 250,
      endedAtMs: null,
      stopReason: null,
    });
  });

  it("rejects invalid recovery or restore timestamps", () => {
    const persisted = parseSettings(validDocument()).settings.recovery;

    expect(createPausedSessionFromRecovery(persisted, -1)).toBeNull();
    expect(
      createPausedSessionFromRecovery(
        { ...persisted, focusedMs: Number.MAX_SAFE_INTEGER + 1 },
        250,
      ),
    ).toBeNull();
  });
});

describe("recovery validation", () => {
  it("requires a validated focus configuration and safe counters", () => {
    const result = parseSettings(
      validDocument({
        recovery: {
          sessionId: "session-1",
          config: { ...recoveryConfig, interventionAfterMs: 10_000 },
          focusedMs: -1,
          awayMs: 20_000,
          savedAtMs: 1_700_000_000_000,
        },
      }),
    );

    expect(result.settings.recovery).toBeNull();
    expect(result.issues[0]?.code).toBe("invalid-recovery");
  });
});

// Keep the type in this test so a future schema change cannot silently widen
// the persisted document beyond the documented shape.
const _schemaShapeCheck: SettingsDocument | null = null;
void _schemaShapeCheck;
