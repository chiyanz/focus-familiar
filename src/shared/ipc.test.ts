import { describe, expect, it } from "vitest";

import {
  IPC_CHANNELS,
  IPC_EVENTS,
  SESSION_ACTIONS,
  SESSION_INTENSITIES,
  SESSION_PHASES,
  UPDATE_PHASES,
  WINDOW_ACTIONS,
  parseApplicationList,
  isWindowAction,
  parseAppInfo,
  parsePetWindowPreferences,
  parsePetWindowSize,
  parseSessionAction,
  parsePreferencesFlushRequestId,
  parseSessionPreferences,
  parseSessionSnapshot,
  parseSessionStartConfig,
  parseWindowAction,
  parseUpdateStatus,
  toAppPlatform,
} from "./ipc";

describe("IPC contracts", () => {
  it("keeps the channel allow-list explicit", () => {
    expect(IPC_CHANNELS).toEqual({
      getAppInfo: "app:get-info",
      getUpdateStatus: "updates:get-status",
      checkForUpdates: "updates:check",
      openUpdateRelease: "updates:open-release",
      windowAction: "window:action",
      getPetWindowPreferences: "settings:get-pet-window-preferences",
      setPetWindowSize: "settings:set-pet-window-size",
      listApplications: "applications:list",
      getSessionSnapshot: "session:get",
      startSession: "session:start",
      sessionAction: "session:action",
      getSessionPreferences: "settings:get-session-preferences",
      saveSessionPreferences: "settings:save-session-preferences",
      acknowledgePreferencesFlush: "settings:acknowledge-flush",
    });
    expect(IPC_EVENTS).toEqual({
      sessionChanged: "session:changed",
      updateStatusChanged: "updates:status-changed",
      preferencesFlushRequested: "settings:flush-requested",
    });
    expect(WINDOW_ACTIONS).toEqual([
      "show-settings",
      "hide-settings",
      "show-pet",
      "quit",
    ]);
    expect(SESSION_ACTIONS).toEqual(["pause", "resume", "stop"]);
    expect(SESSION_PHASES).toEqual([
      "idle",
      "focused",
      "grace",
      "nudge",
      "intervention",
      "paused",
      "completed",
      "stopped",
    ]);
    expect(SESSION_INTENSITIES).toEqual(["gentle", "balanced", "strict"]);
    expect(UPDATE_PHASES).toEqual([
      "not-checked",
      "checking",
      "up-to-date",
      "available",
      "error",
    ]);
  });

  it("validates and sanitizes update status", () => {
    expect(
      parseUpdateStatus({
        phase: "available",
        currentVersion: "0.1.0-prototype.2",
        latestVersion: "0.1.0-prototype.3",
        releaseTag: "v0.1.0-prototype.3",
        releaseBody: "must not cross the boundary",
        releaseUrl: "https://example.com/untrusted",
      }),
    ).toEqual({
      phase: "available",
      currentVersion: "0.1.0-prototype.2",
      latestVersion: "0.1.0-prototype.3",
      releaseTag: "v0.1.0-prototype.3",
    });
    expect(
      parseUpdateStatus({
        phase: "up-to-date",
        currentVersion: "0.1.0",
        latestVersion: null,
        releaseTag: null,
      }),
    ).toMatchObject({ phase: "up-to-date" });

    for (const malformed of [
      null,
      { phase: "available", currentVersion: "0.1.0" },
      {
        phase: "up-to-date",
        currentVersion: "0.1.0",
        latestVersion: "1.0.0",
        releaseTag: null,
      },
      {
        phase: "unknown",
        currentVersion: "0.1.0",
        latestVersion: null,
        releaseTag: null,
      },
      {
        phase: "error",
        currentVersion: "x".repeat(129),
        latestVersion: null,
        releaseTag: null,
      },
    ]) {
      expect(() => parseUpdateStatus(malformed)).toThrow(
        "Malformed update status.",
      );
    }
  });

  it("validates preference flush request identifiers", () => {
    expect(parsePreferencesFlushRequestId("request-1")).toBe("request-1");
    expect(() => parsePreferencesFlushRequestId("")).toThrow(
      "Malformed preferences flush request.",
    );
    expect(() => parsePreferencesFlushRequestId(42)).toThrow(
      "Malformed preferences flush request.",
    );
  });

  it("validates pet window preferences at the IPC boundary", () => {
    expect(parsePetWindowSize(160)).toBe(160);
    expect(parsePetWindowSize(248)).toBe(248);
    expect(parsePetWindowSize(480)).toBe(480);
    expect(
      parsePetWindowPreferences({ sizePx: 320, privateField: "remove" }),
    ).toEqual({ sizePx: 320 });

    for (const value of [159, 481, 248.5, "248", null]) {
      expect(() => parsePetWindowSize(value)).toThrow("Pet size");
    }
    expect(() => parsePetWindowPreferences(null)).toThrow(
      "Malformed pet window preferences.",
    );
  });

  it("accepts only documented window actions", () => {
    expect(isWindowAction("show-settings")).toBe(true);
    expect(isWindowAction("run-shell-command")).toBe(false);
    expect(isWindowAction({ action: "show-settings" })).toBe(false);
    expect(parseWindowAction("quit")).toBe("quit");
    expect(() => parseWindowAction("run-shell-command")).toThrow(
      "Unknown window action.",
    );
  });

  it("validates app information at the IPC boundary", () => {
    expect(
      parseAppInfo({
        name: "Focus Familiar",
        version: "0.1.0",
        platform: "darwin",
      }),
    ).toEqual({ name: "Focus Familiar", version: "0.1.0", platform: "darwin" });
    expect(() => parseAppInfo({ name: "Focus Familiar" })).toThrow(
      "Malformed app information.",
    );
    expect(() => parseAppInfo(null)).toThrow("Malformed app information.");
  });

  it("normalizes unsupported host platforms", () => {
    expect(toAppPlatform("darwin")).toBe("darwin");
    expect(toAppPlatform("freebsd")).toBe("other");
  });

  it("validates and normalizes session start configuration", () => {
    expect(
      parseSessionStartConfig({
        task: "  Finish the prototype  ",
        targetApplication: {
          bundleId: "com.microsoft.VSCode",
          name: "Visual Studio Code",
        },
        durationMs: 25 * 60 * 1000,
        gracePeriodMs: 20 * 1000,
        interventionAfterMs: 90 * 1000,
        intensity: "balanced",
      }),
    ).toEqual({
      task: "Finish the prototype",
      targetApplication: {
        bundleId: "com.microsoft.VSCode",
        name: "Visual Studio Code",
      },
      durationMs: 25 * 60 * 1000,
      gracePeriodMs: 20 * 1000,
      interventionAfterMs: 90 * 1000,
      intensity: "balanced",
    });

    expect(() => parseSessionStartConfig(null)).toThrow(
      "Configuration must be an object.",
    );
    expect(() =>
      parseSessionStartConfig({
        task: "",
        targetApplication: { bundleId: "com.app", name: "App" },
        durationMs: 1,
        gracePeriodMs: 0,
        interventionAfterMs: 1,
        intensity: "gentle",
      }),
    ).toThrow("Task must be a non-empty string.");
    expect(() =>
      parseSessionStartConfig({
        task: "Task",
        targetApplication: { bundleId: "com.app", name: "App" },
        durationMs: 1,
        gracePeriodMs: 100,
        interventionAfterMs: 100,
        intensity: "gentle",
      }),
    ).toThrow("Intervention threshold must be greater than the grace period.");
    expect(() =>
      parseSessionStartConfig({
        task: "Task",
        targetApplication: { bundleId: "com.app", name: "App" },
        durationMs: 1.5,
        gracePeriodMs: 0,
        interventionAfterMs: 1,
        intensity: "gentle",
      }),
    ).toThrow("Duration must be a positive integer number of milliseconds.");
  });

  it("validates session preferences while preserving the task draft", () => {
    expect(
      parseSessionPreferences({
        taskDraft: "  Finish the prototype  ",
        targetApplication: {
          bundleId: "com.microsoft.VSCode",
          name: "  Visual Studio Code ",
        },
        durationMs: 25 * 60 * 1000,
        gracePeriodMs: 20 * 1000,
        interventionAfterMs: 90 * 1000,
        intensity: "balanced",
        recovery: { secret: "must not cross the boundary" },
        soundEnabled: true,
      }),
    ).toEqual({
      taskDraft: "  Finish the prototype  ",
      targetApplication: {
        bundleId: "com.microsoft.VSCode",
        name: "Visual Studio Code",
      },
      durationMs: 25 * 60 * 1000,
      gracePeriodMs: 20 * 1000,
      interventionAfterMs: 90 * 1000,
      intensity: "balanced",
    });

    expect(
      parseSessionPreferences({
        taskDraft: "",
        targetApplication: null,
        durationMs: 1,
        gracePeriodMs: 0,
        interventionAfterMs: 1,
        intensity: "gentle",
      }),
    ).toMatchObject({ taskDraft: "", targetApplication: null });
    expect(() => parseSessionPreferences(null)).toThrow(
      "Preferences must be an object.",
    );
    expect(() =>
      parseSessionPreferences({
        taskDraft: 42,
        targetApplication: null,
        durationMs: 1,
        gracePeriodMs: 0,
        interventionAfterMs: 1,
        intensity: "gentle",
      }),
    ).toThrow("Task draft must be a string.");
    expect(() =>
      parseSessionPreferences({
        taskDraft: "Task",
        targetApplication: null,
        durationMs: 1,
        gracePeriodMs: 10,
        interventionAfterMs: 10,
        intensity: "gentle",
      }),
    ).toThrow("Intervention threshold must be greater than the grace period.");
  });

  it("validates application lists and returns fresh summaries", () => {
    const input = [{ bundleId: "com.apple.Terminal", name: "  Terminal " }];
    const parsed = parseApplicationList(input);
    expect(parsed).toEqual([
      { bundleId: "com.apple.Terminal", name: "Terminal" },
    ]);
    expect(parsed[0]).not.toBe(input[0]);
    expect(() => parseApplicationList({})).toThrow(
      "Malformed application list.",
    );
    expect(() => parseApplicationList([{ bundleId: "com.app" }])).toThrow(
      "Malformed application list.",
    );
  });

  it("accepts only documented session actions", () => {
    expect(parseSessionAction("pause")).toBe("pause");
    expect(parseSessionAction("resume")).toBe("resume");
    expect(parseSessionAction("stop")).toBe("stop");
    expect(() => parseSessionAction("quit")).toThrow("Unknown session action.");
    expect(() => parseSessionAction({ action: "pause" })).toThrow(
      "Unknown session action.",
    );
  });

  it("sanitizes session snapshots and strips privileged fields", () => {
    const snapshot = parseSessionSnapshot({
      schemaVersion: 1,
      sessionId: "session-1",
      phase: "nudge",
      task: "Build the prototype",
      targetApplication: {
        bundleId: "com.microsoft.VSCode",
        name: "Visual Studio Code",
      },
      durationMs: 25 * 60 * 1000,
      gracePeriodMs: 20 * 1000,
      interventionAfterMs: 90 * 1000,
      intensity: "balanced",
      focusedMs: 12 * 1000,
      awayMs: 42 * 1000,
      currentAwayMs: 42 * 1000,
      capabilities: {
        canStart: false,
        canPause: true,
        canResume: false,
        canStop: true,
      },
      // A compromised/mistaken main response must not cross this boundary.
      currentApplication: {
        bundleId: "com.google.Chrome",
        name: "Google Chrome",
      },
      lastEventAtMs: 123456,
      endedAtMs: null,
      rawEvent: { type: "application-changed" },
    });

    expect(snapshot).toEqual({
      schemaVersion: 1,
      sessionId: "session-1",
      phase: "nudge",
      task: "Build the prototype",
      targetApplication: {
        bundleId: "com.microsoft.VSCode",
        name: "Visual Studio Code",
      },
      durationMs: 25 * 60 * 1000,
      gracePeriodMs: 20 * 1000,
      interventionAfterMs: 90 * 1000,
      intensity: "balanced",
      focusedMs: 12 * 1000,
      awayMs: 42 * 1000,
      currentAwayMs: 42 * 1000,
      capabilities: {
        canStart: false,
        canPause: true,
        canResume: false,
        canStop: true,
      },
    });
    expect(snapshot).not.toHaveProperty("currentApplication");
    expect(snapshot).not.toHaveProperty("lastEventAtMs");
    expect(snapshot).not.toHaveProperty("rawEvent");
  });

  it("validates snapshot shape, counters, thresholds, and capabilities", () => {
    const base = {
      schemaVersion: 1,
      sessionId: null,
      phase: "idle",
      task: null,
      targetApplication: null,
      durationMs: null,
      gracePeriodMs: null,
      interventionAfterMs: null,
      intensity: null,
      focusedMs: 0,
      awayMs: 0,
      currentAwayMs: 0,
      capabilities: {
        canStart: true,
        canPause: false,
        canResume: false,
        canStop: false,
      },
    };
    expect(parseSessionSnapshot(base)).toEqual(base);
    expect(() => parseSessionSnapshot({ ...base, phase: "unknown" })).toThrow(
      "Malformed session snapshot.",
    );
    expect(() => parseSessionSnapshot({ ...base, focusedMs: -1 })).toThrow(
      "Malformed session snapshot.",
    );
    expect(() =>
      parseSessionSnapshot({
        ...base,
        durationMs: 10,
        focusedMs: 11,
      }),
    ).toThrow("Malformed session snapshot.");
    expect(() =>
      parseSessionSnapshot({
        ...base,
        currentAwayMs: 1,
      }),
    ).toThrow("Malformed session snapshot.");
    expect(() =>
      parseSessionSnapshot({
        ...base,
        focusedMs: 1,
      }),
    ).toThrow("Malformed session snapshot.");
    expect(() =>
      parseSessionSnapshot({
        ...base,
        gracePeriodMs: 20,
        interventionAfterMs: 20,
      }),
    ).toThrow("Malformed session snapshot.");
    expect(() =>
      parseSessionSnapshot({
        ...base,
        sessionId: "session-1",
        phase: "paused",
        task: "Task",
      }),
    ).toThrow("Malformed session snapshot.");
    expect(() =>
      parseSessionSnapshot({
        ...base,
        capabilities: { canStart: true },
      }),
    ).toThrow("Malformed session snapshot.");
  });
});
