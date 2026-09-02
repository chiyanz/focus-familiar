import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain } from "electron";

import { registerIpcHandlers, type ManagedWindow } from "./ipc";
import { resolveMacOSActivityHelperPath } from "./native-helper";
import { SessionActivityBridge } from "./session-activity-bridge";
import {
  getWindowOptions,
  loadRendererWindow,
  resolveRendererTarget,
  type WindowKind,
} from "./windows";
import { ChildProcessNativeHelperRunner } from "../platform/macos/helper-runner";
import { MacOSApplicationAdapter } from "../platform/macos/macos-application-adapter";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(moduleDirectory, "../preload/index.cjs");
const rendererDirectory = join(moduleDirectory, "../renderer");
const isSmokeTest = process.argv.includes("--smoke-test");
const managedWindows: ManagedWindow[] = [];
let isQuitting = false;
let sessionActivityBridge: SessionActivityBridge | undefined;
let activityAdapter: MacOSApplicationAdapter | undefined;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let removeIpcHandlers: (() => void) | undefined;

  app.on("second-instance", () => {
    const settings = findWindow("settings");
    settings?.show();
    settings?.focus();
  });

  app
    .whenReady()
    .then(async () => {
      removeIpcHandlers = registerIpcHandlers({
        app,
        ipcMain,
        getWindows: () => managedWindows,
      });

      await startApplicationAwareness();

      await createApplicationWindows();

      if (isSmokeTest) {
        await verifySmokeBoundary();
        console.log("FOCUS_FAMILIAR_SMOKE_READY");
        app.quit();
      } else {
        findWindow("pet")?.showInactive();
      }
    })
    .catch((error: unknown) => {
      sessionActivityBridge?.dispose();
      console.error("Focus Familiar failed to start.", error);
      app.exit(1);
    });

  app.on("activate", () => {
    if (managedWindows.every(({ window }) => window.isDestroyed())) {
      void createApplicationWindows().then(() =>
        findWindow("pet")?.showInactive(),
      );
    } else {
      findWindow("pet")?.showInactive();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    sessionActivityBridge?.dispose();
  });

  app.on("will-quit", () => {
    removeIpcHandlers?.();
  });
}

async function createApplicationWindows(): Promise<void> {
  managedWindows.splice(0, managedWindows.length);
  await Promise.all([createWindow("pet"), createWindow("settings")]);
}

async function createWindow(kind: WindowKind): Promise<void> {
  const window = new BrowserWindow(getWindowOptions(kind, preloadPath));
  const target = resolveRendererTarget(kind, {
    rendererDirectory,
    ...(process.env.ELECTRON_RENDERER_URL
      ? { devServerUrl: process.env.ELECTRON_RENDERER_URL }
      : {}),
  });

  managedWindows.push({ kind, window, target });
  if (kind === "settings") {
    window.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        window.hide();
      }
    });
  }
  window.on("closed", () => {
    const index = managedWindows.findIndex((entry) => entry.window === window);
    if (index >= 0) managedWindows.splice(index, 1);
  });

  await loadRendererWindow(window, target);
}

function findWindow(kind: WindowKind): BrowserWindow | undefined {
  return managedWindows.find((entry) => entry.kind === kind)?.window;
}

async function verifySmokeBoundary(): Promise<void> {
  if (managedWindows.length !== 2)
    throw new Error("Smoke test expected two windows.");

  for (const { window } of managedWindows) {
    const result = await window.webContents.executeJavaScript(`({
      hasBridge: typeof window.focusFamiliar === 'object',
      hasNodeRequire: typeof globalThis.require !== 'undefined',
      hasNodeProcess: typeof globalThis.process !== 'undefined'
    })`);

    if (!result.hasBridge || result.hasNodeRequire || result.hasNodeProcess) {
      throw new Error(
        `Renderer security boundary smoke check failed: ${JSON.stringify(result)}`,
      );
    }
  }
}

async function startApplicationAwareness(): Promise<void> {
  if (process.platform !== "darwin") return;

  const clock = {
    nowMs: (): number => Math.floor(performance.timeOrigin + performance.now()),
  };
  const helperPath = resolveMacOSActivityHelperPath({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    isDevelopment: Boolean(process.env.ELECTRON_RENDERER_URL),
  });
  activityAdapter = new MacOSApplicationAdapter(
    new ChildProcessNativeHelperRunner(helperPath),
    clock,
  );
  sessionActivityBridge = new SessionActivityBridge(activityAdapter, clock, {
    onObservationError: (error) => {
      console.error(`Application awareness unavailable: ${error.message}`);
    },
  });
  sessionActivityBridge.startMonitoring();

  if (isSmokeTest) {
    const current = await activityAdapter.currentApplication();
    if (!current.ok) {
      throw new Error(
        `Application awareness smoke check failed: ${current.error.message}`,
      );
    }
  }
}
