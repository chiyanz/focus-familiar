import type { App, BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import type {
  FocusSessionConfig,
  FocusSessionState,
  SessionReduction,
} from "../core";
import type {
  ActivityProvider,
  ApplicationIdentity,
} from "../platform/application";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  parseSessionAction,
  parseSessionStartConfig,
  parseWindowAction,
  toAppPlatform,
  type AppInfo,
  type SessionSnapshot,
} from "../shared/ipc";
import {
  isTrustedRendererUrl,
  type RendererTarget,
  type WindowKind,
} from "./windows";

export interface ManagedWindow {
  readonly kind: WindowKind;
  readonly window: BrowserWindow;
  readonly target: RendererTarget;
}

export interface IpcDependencies {
  readonly app: Pick<App, "getName" | "getVersion" | "quit">;
  readonly ipcMain: Pick<IpcMain, "handle" | "removeHandler">;
  readonly getWindows: () => readonly ManagedWindow[];
  readonly getApplicationProvider: () =>
    | Pick<ActivityProvider, "listApplications">
    | undefined;
  readonly getSessionController: () => SessionController | undefined;
  readonly createSessionId: () => string;
}

export interface SessionController {
  readonly snapshot: () => FocusSessionState;
  readonly startSession: (
    sessionId: string,
    config: FocusSessionConfig,
  ) => Promise<SessionReduction>;
  readonly pause: () => SessionReduction;
  readonly resume: () => Promise<SessionReduction>;
  readonly stop: (reason: "user" | "emergency") => SessionReduction;
}

export function registerIpcHandlers(dependencies: IpcDependencies): () => void {
  const { app, ipcMain, getWindows } = dependencies;

  ipcMain.handle(IPC_CHANNELS.getAppInfo, (event) => {
    assertTrustedSender(event, getWindows());

    const info: AppInfo = {
      name: app.getName(),
      version: app.getVersion(),
      platform: toAppPlatform(process.platform),
    };
    return info;
  });

  ipcMain.handle(IPC_CHANNELS.windowAction, (event, payload: unknown) => {
    assertTrustedSender(event, getWindows());
    const action = parseWindowAction(payload);
    const windows = getWindows();

    switch (action) {
      case "show-settings":
        windows.find(({ kind }) => kind === "settings")?.window.show();
        break;
      case "hide-settings":
        windows.find(({ kind }) => kind === "settings")?.window.hide();
        break;
      case "show-pet":
        windows.find(({ kind }) => kind === "pet")?.window.showInactive();
        break;
      case "quit":
        app.quit();
        break;
    }
  });

  ipcMain.handle(IPC_CHANNELS.listApplications, async (event) => {
    assertTrustedSender(event, getWindows());
    const provider = requireService(
      dependencies.getApplicationProvider(),
      "Application awareness is unavailable on this platform.",
    );
    const result = await provider.listApplications();
    if (!result.ok) throw new Error(result.error.message);
    return sanitizeApplications(result.value);
  });

  ipcMain.handle(IPC_CHANNELS.getSessionSnapshot, (event) => {
    assertTrustedSender(event, getWindows());
    const runtime = requireService(
      dependencies.getSessionController(),
      "Focus sessions are unavailable on this platform.",
    );
    return toSessionSnapshot(runtime.snapshot());
  });

  ipcMain.handle(IPC_CHANNELS.startSession, async (event, payload: unknown) => {
    assertTrustedSender(event, getWindows());
    const request = parseSessionStartConfig(payload);
    const runtime = requireService(
      dependencies.getSessionController(),
      "Focus sessions are unavailable on this platform.",
    );
    const result = await runtime.startSession(
      dependencies.createSessionId(),
      request,
    );
    return reductionSnapshot(result);
  });

  ipcMain.handle(
    IPC_CHANNELS.sessionAction,
    async (event, payload: unknown) => {
      assertTrustedSender(event, getWindows());
      const action = parseSessionAction(payload);
      const runtime = requireService(
        dependencies.getSessionController(),
        "Focus sessions are unavailable on this platform.",
      );
      const result =
        action === "pause"
          ? runtime.pause()
          : action === "resume"
            ? await runtime.resume()
            : runtime.stop("user");
      return reductionSnapshot(result);
    },
  );

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.getAppInfo);
    ipcMain.removeHandler(IPC_CHANNELS.windowAction);
    ipcMain.removeHandler(IPC_CHANNELS.listApplications);
    ipcMain.removeHandler(IPC_CHANNELS.getSessionSnapshot);
    ipcMain.removeHandler(IPC_CHANNELS.startSession);
    ipcMain.removeHandler(IPC_CHANNELS.sessionAction);
  };
}

/** Broadcast only the deliberately sanitized session projection. */
export function publishSessionSnapshot(
  windows: readonly ManagedWindow[],
  state: FocusSessionState,
): void {
  const snapshot = toSessionSnapshot(state);
  for (const { window } of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.sessionChanged, snapshot);
    }
  }
}

export function toSessionSnapshot(state: FocusSessionState): SessionSnapshot {
  const config = state.config;
  const canPause =
    state.phase === "focused" ||
    state.phase === "grace" ||
    state.phase === "nudge" ||
    state.phase === "intervention";

  return {
    schemaVersion: 1,
    sessionId: state.sessionId,
    phase: state.phase,
    task: config?.task ?? null,
    targetApplication: config?.targetApplication ?? null,
    durationMs: config?.durationMs ?? null,
    gracePeriodMs: config?.gracePeriodMs ?? null,
    interventionAfterMs: config?.interventionAfterMs ?? null,
    intensity: config?.intensity ?? null,
    focusedMs: state.focusedMs,
    awayMs: state.awayMs,
    currentAwayMs: state.currentAwayMs,
    capabilities: {
      canStart:
        state.phase === "idle" ||
        state.phase === "completed" ||
        state.phase === "stopped",
      canPause,
      canResume: state.phase === "paused",
      canStop:
        state.phase !== "idle" &&
        state.phase !== "completed" &&
        state.phase !== "stopped",
    },
  };
}

function reductionSnapshot(result: SessionReduction): SessionSnapshot {
  if (!result.ok) throw new Error(result.error.message);
  return toSessionSnapshot(result.state);
}

function sanitizeApplications(
  applications: readonly ApplicationIdentity[],
): readonly ApplicationIdentity[] {
  return applications.map(({ bundleId, name }) => ({ bundleId, name }));
}

function requireService<T>(service: T | undefined, message: string): T {
  if (!service) throw new Error(message);
  return service;
}

export function assertTrustedSender(
  event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">,
  windows: readonly ManagedWindow[],
): void {
  const managedWindow = windows.find(
    ({ window }) => window.webContents === event.sender,
  );
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();

  if (
    !managedWindow ||
    !isTrustedRendererUrl(senderUrl, managedWindow.target)
  ) {
    throw new Error("Rejected IPC from an untrusted renderer.");
  }
}
