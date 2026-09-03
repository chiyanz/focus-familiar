import { describe, expect, it, vi } from "vitest";

import {
  createIdleSession,
  reduceSession,
  type FocusSessionConfig,
  type FocusSessionState,
} from "../core";
import type { UpdateStatus } from "../shared/ipc";
import {
  assertTrustedSender,
  publishSessionSnapshot,
  publishUpdateStatus,
  registerIpcHandlers,
  toSessionSnapshot,
  type ManagedWindow,
} from "./ipc";

const editor = { bundleId: "com.example.Editor", name: "Editor" };
const browser = { bundleId: "com.example.Browser", name: "Browser" };
const config: FocusSessionConfig = {
  task: "Ship the prototype",
  targetApplication: editor,
  durationMs: 25 * 60 * 1_000,
  gracePeriodMs: 10_000,
  interventionAfterMs: 60_000,
  intensity: "balanced",
};

function managedWindow(
  url = "file:///app/out/renderer/pet.html",
): ManagedWindow {
  const webContents = { getURL: () => url, send: vi.fn() };
  return {
    kind: "pet",
    window: { webContents, isDestroyed: () => false } as never,
    target: {
      kind: "file",
      filePath: "/app/out/renderer/pet.html",
      url: "file:///app/out/renderer/pet.html",
    },
  };
}

function runningState(): FocusSessionState {
  const started = reduceSession(createIdleSession(), {
    type: "session-started",
    atMs: 100,
    sessionId: "session-1",
    config,
    currentApplication: browser,
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

describe("IPC sender boundary", () => {
  it("accepts the exact local renderer and web contents", () => {
    const entry = managedWindow();
    expect(() =>
      assertTrustedSender(
        {
          sender: entry.window.webContents,
          senderFrame: { url: entry.target.url } as never,
        },
        [entry],
      ),
    ).not.toThrow();
  });

  it("rejects a different web contents even when it claims a trusted URL", () => {
    const entry = managedWindow();
    expect(() =>
      assertTrustedSender(
        {
          sender: { getURL: vi.fn(() => entry.target.url) } as never,
          senderFrame: { url: entry.target.url } as never,
        },
        [entry],
      ),
    ).toThrow("untrusted renderer");
  });

  it("rejects navigation away from the fixed production entry point", () => {
    const entry = managedWindow("https://example.com");
    expect(() =>
      assertTrustedSender(
        {
          sender: entry.window.webContents,
          senderFrame: { url: "https://example.com" } as never,
        },
        [entry],
      ),
    ).toThrow("untrusted renderer");
  });
});

describe("session IPC projection", () => {
  it("never exposes the current non-target application or event timestamps", () => {
    const snapshot = toSessionSnapshot(runningState());

    expect(snapshot).toMatchObject({
      sessionId: "session-1",
      phase: "grace",
      task: config.task,
      targetApplication: editor,
      capabilities: {
        canStart: false,
        canPause: true,
        canResume: false,
        canStop: true,
      },
    });
    expect(snapshot).not.toHaveProperty("currentApplication");
    expect(snapshot).not.toHaveProperty("lastEventAtMs");
    expect(snapshot).not.toHaveProperty("endedAtMs");
  });

  it("broadcasts the same sanitized snapshot to managed windows", () => {
    const first = managedWindow();
    const second = managedWindow("file:///app/out/renderer/settings.html");

    publishSessionSnapshot([first, second], runningState());

    for (const entry of [first, second]) {
      expect(entry.window.webContents.send).toHaveBeenCalledWith(
        "session:changed",
        expect.objectContaining({ phase: "grace" }),
      );
      const payload = vi.mocked(entry.window.webContents.send).mock
        .calls[0]?.[1];
      expect(payload).not.toHaveProperty("currentApplication");
    }
  });
});

describe("update IPC projection", () => {
  it("broadcasts only the sanitized update status", () => {
    const entry = managedWindow();
    publishUpdateStatus([entry], {
      phase: "available",
      currentVersion: "0.1.0-prototype.2",
      latestVersion: "0.1.0-prototype.3",
      releaseTag: "v0.1.0-prototype.3",
    });

    expect(entry.window.webContents.send).toHaveBeenCalledWith(
      "updates:status-changed",
      {
        phase: "available",
        currentVersion: "0.1.0-prototype.2",
        latestVersion: "0.1.0-prototype.3",
        releaseTag: "v0.1.0-prototype.3",
      },
    );
  });
});

describe("session IPC handlers", () => {
  it("lists apps and drives start, pause, resume, stop through the runtime", async () => {
    const entry = managedWindow();
    const handlers = new Map<
      string,
      (event: never, payload?: unknown) => unknown
    >();
    let state = createIdleSession();
    const startSession = vi.fn(async (sessionId: string) => {
      const result = reduceSession(state, {
        type: "session-started",
        atMs: 100,
        sessionId,
        config,
        currentApplication: editor,
      });
      if (result.ok) state = result.state;
      return result;
    });
    const pause = vi.fn(() => {
      const result = reduceSession(state, {
        type: "session-paused",
        atMs: 200,
      });
      if (result.ok) state = result.state;
      return result;
    });
    const resume = vi.fn(async () => {
      const result = reduceSession(state, {
        type: "session-resumed",
        atMs: 300,
        currentApplication: editor,
      });
      if (result.ok) state = result.state;
      return result;
    });
    const stop = vi.fn(() => {
      const result = reduceSession(state, {
        type: "session-stopped",
        atMs: 400,
        reason: "user",
      });
      if (result.ok) state = result.state;
      return result;
    });
    let preferences = {
      taskDraft: "",
      targetApplication: null as typeof editor | null,
      durationMs: config.durationMs,
      gracePeriodMs: config.gracePeriodMs,
      interventionAfterMs: config.interventionAfterMs,
      intensity: config.intensity,
    };
    let petWindowSize = 248;
    const setPetWindowSize = vi.fn(async (sizePx: number) => {
      petWindowSize = sizePx;
    });
    const removeHandler = vi.fn();
    const acknowledgePreferencesFlush = vi.fn();
    let updateStatus: UpdateStatus = {
      phase: "not-checked",
      currentVersion: "0.1.0-prototype.3",
      latestVersion: null,
      releaseTag: null,
    };
    const checkForUpdates = vi.fn(async () => {
      const available = {
        phase: "available" as const,
        currentVersion: "0.1.0-prototype.3",
        latestVersion: "0.1.0-prototype.4",
        releaseTag: "v0.1.0-prototype.4",
      };
      updateStatus = available;
      return available;
    });
    const openAvailableRelease = vi.fn(async () => undefined);
    const dispose = registerIpcHandlers({
      app: {
        getName: () => "Focus Familiar",
        getVersion: () => "0.1.0",
        quit: vi.fn(),
      },
      ipcMain: {
        handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
        removeHandler,
      } as never,
      getWindows: () => [entry],
      getApplicationProvider: () => ({
        listApplications: async () => ({
          ok: true as const,
          value: [editor, browser],
        }),
      }),
      getSessionController: () => ({
        snapshot: () => state,
        startSession: async (sessionId) => startSession(sessionId),
        pause,
        resume,
        stop,
      }),
      getSettingsController: () => ({
        sessionPreferences: () => preferences,
        updateSessionPreferences: async (next) => {
          preferences = next;
          return { ok: true };
        },
      }),
      getUpdateController: () => ({
        snapshot: () => updateStatus,
        check: checkForUpdates,
        openAvailableRelease,
      }),
      getPetWindowSize: () => petWindowSize,
      setPetWindowSize,
      acknowledgePreferencesFlush,
      createSessionId: () => "generated-session",
    });
    const event = {
      sender: entry.window.webContents,
      senderFrame: { url: entry.target.url },
    } as never;

    await expect(handlers.get("applications:list")?.(event)).resolves.toEqual([
      editor,
      browser,
    ]);
    expect(handlers.get("updates:get-status")?.(event)).toMatchObject({
      phase: "not-checked",
    });
    await expect(handlers.get("updates:check")?.(event)).resolves.toMatchObject(
      {
        phase: "available",
        latestVersion: "0.1.0-prototype.4",
      },
    );
    await expect(
      handlers.get("updates:open-release")?.(event),
    ).resolves.toBeUndefined();
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(openAvailableRelease).toHaveBeenCalledOnce();
    expect(
      handlers.get("settings:get-pet-window-preferences")?.(event),
    ).toEqual({ sizePx: 248 });
    await expect(
      handlers.get("settings:set-pet-window-size")?.(event, 320),
    ).resolves.toEqual({ sizePx: 320 });
    expect(setPetWindowSize).toHaveBeenCalledWith(320);
    await expect(
      handlers.get("session:start")?.(event, config),
    ).resolves.toMatchObject({ phase: "focused" });
    expect(startSession).toHaveBeenCalledWith("generated-session");

    await expect(
      handlers.get("session:action")?.(event, "pause"),
    ).resolves.toMatchObject({ phase: "paused" });
    await expect(
      handlers.get("session:action")?.(event, "resume"),
    ).resolves.toMatchObject({ phase: "focused" });
    await expect(
      handlers.get("session:action")?.(event, "stop"),
    ).resolves.toMatchObject({ phase: "stopped" });
    expect(
      handlers.get("settings:get-session-preferences")?.(event),
    ).toMatchObject({ taskDraft: "" });
    await expect(
      handlers.get("settings:save-session-preferences")?.(event, {
        ...preferences,
        taskDraft: "Remember me",
        targetApplication: editor,
      }),
    ).resolves.toMatchObject({
      taskDraft: "Remember me",
      targetApplication: editor,
    });
    expect(
      handlers.get("settings:acknowledge-flush")?.(event, "request-1"),
    ).toBeUndefined();
    expect(acknowledgePreferencesFlush).toHaveBeenCalledWith("request-1");

    dispose();
    expect(removeHandler).toHaveBeenCalledTimes(14);
  });

  it("rejects session operations when the macOS service is unavailable", async () => {
    const entry = managedWindow();
    const handlers = new Map<
      string,
      (event: never, payload?: unknown) => unknown
    >();
    registerIpcHandlers({
      app: {
        getName: () => "Focus Familiar",
        getVersion: () => "0.1.0",
        quit: vi.fn(),
      },
      ipcMain: {
        handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
        removeHandler: vi.fn(),
      } as never,
      getWindows: () => [entry],
      getApplicationProvider: () => undefined,
      getSessionController: () => undefined,
      getSettingsController: () => undefined,
      getUpdateController: () => undefined,
      getPetWindowSize: () => undefined,
      setPetWindowSize: async () => {
        throw new Error("Pet window preferences are unavailable.");
      },
      acknowledgePreferencesFlush: vi.fn(),
      createSessionId: () => "unused",
    });
    const event = {
      sender: entry.window.webContents,
      senderFrame: { url: entry.target.url },
    } as never;

    expect(() => handlers.get("session:get")?.(event)).toThrow("unavailable");
    expect(() =>
      handlers.get("settings:get-pet-window-preferences")?.(event),
    ).toThrow("unavailable");
    await expect(
      handlers.get("settings:set-pet-window-size")?.(event, 159),
    ).rejects.toThrow("Pet size");
  });
});
