import type { App, BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import {
  IPC_CHANNELS,
  parseWindowAction,
  toAppPlatform,
  type AppInfo,
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

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.getAppInfo);
    ipcMain.removeHandler(IPC_CHANNELS.windowAction);
  };
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
