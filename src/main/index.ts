import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type MessageBoxOptions,
} from "electron";

import {
  publishSessionSnapshot,
  registerIpcHandlers,
  type ManagedWindow,
} from "./ipc";
import { resolveMacOSActivityHelperPath } from "./native-helper";
import { SessionRuntime } from "./session-runtime";
import {
  resolveSettingsFilePath,
  SettingsRepository,
} from "./settings-repository";
import {
  getWindowOptions,
  loadRendererWindow,
  resolveRendererTarget,
  type WindowKind,
} from "./windows";
import { ChildProcessNativeHelperRunner } from "../platform/macos/helper-runner";
import { MacOSApplicationAdapter } from "../platform/macos/macos-application-adapter";
import type { ActivityProvider } from "../platform/application";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(moduleDirectory, "../preload/index.cjs");
const rendererDirectory = join(moduleDirectory, "../renderer");
const isSmokeTest = process.argv.includes("--smoke-test");
const managedWindows: ManagedWindow[] = [];
let isQuitting = false;
let sessionRuntime: SessionRuntime | undefined;
let applicationProvider: ActivityProvider | undefined;

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
        getApplicationProvider: () => applicationProvider,
        getSessionController: () => sessionRuntime,
        createSessionId: randomUUID,
      });

      await loadLocalSettings();
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
      sessionRuntime?.dispose();
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
    sessionRuntime?.dispose();
  });

  app.on("will-quit", () => {
    removeIpcHandlers?.();
  });
}

async function loadLocalSettings(): Promise<void> {
  const repository = new SettingsRepository(
    resolveSettingsFilePath(app.getPath("userData")),
  );
  const loaded = await repository.load();

  if (!loaded.ok) {
    console.error(`Local settings unavailable: ${loaded.error.message}`);
    return;
  }

  for (const issue of loaded.issues) {
    console.warn(`Local settings notice: ${issue.message}`);
  }
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

  for (const { kind, window } of managedWindows) {
    const result = await window.webContents.executeJavaScript(`({
      hasBridge: typeof window.focusFamiliar === 'object',
      hasNodeRequire: typeof globalThis.require !== 'undefined',
      hasNodeProcess: typeof globalThis.process !== 'undefined',
      petImage: (() => {
        const image = document.querySelector('#pet-image');
        return image instanceof HTMLImageElement
          ? { exists: true, complete: image.complete, naturalWidth: image.naturalWidth }
          : { exists: false, complete: false, naturalWidth: 0 };
      })()
    })`);

    if (!result.hasBridge || result.hasNodeRequire || result.hasNodeProcess) {
      throw new Error(
        `Renderer security boundary smoke check failed: ${JSON.stringify(result)}`,
      );
    }

    if (
      kind === "pet" &&
      (!result.petImage.exists ||
        !result.petImage.complete ||
        result.petImage.naturalWidth <= 0)
    ) {
      throw new Error(
        `Pet asset smoke check failed: ${JSON.stringify(result.petImage)}`,
      );
    }
  }

  if (process.platform === "darwin") {
    const settingsWindow = findWindow("settings");
    if (!settingsWindow) throw new Error("Settings window is unavailable.");
    const sessionResult = await settingsWindow.webContents.executeJavaScript(`
      (async () => {
        const applications = await window.focusFamiliar.listApplications();
        const targetApplication = applications[0];
        if (!targetApplication) return { ok: false, reason: "no-applications" };
        const started = await window.focusFamiliar.startSession({
          task: "Verify the packaged prototype",
          targetApplication,
          durationMs: 60000,
          gracePeriodMs: 1000,
          interventionAfterMs: 3000,
          intensity: "balanced"
        });
        const paused = await window.focusFamiliar.requestSessionAction("pause");
        const resumed = await window.focusFamiliar.requestSessionAction("resume");
        const stopped = await window.focusFamiliar.requestSessionAction("stop");
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          ok: true,
          applicationCount: applications.length,
          phases: [started.phase, paused.phase, resumed.phase, stopped.phase],
          renderedStatus: document.querySelector("#status-label")?.textContent,
          startEnabled: !document.querySelector("#start-session")?.disabled,
          pauseDisabled: document.querySelector("#pause-session")?.disabled,
          stopDisabled: document.querySelector("#stop-session")?.disabled
        };
      })()
    `);
    if (
      !sessionResult.ok ||
      sessionResult.applicationCount < 1 ||
      sessionResult.phases[1] !== "paused" ||
      sessionResult.phases[3] !== "stopped" ||
      sessionResult.renderedStatus !== "Session stopped" ||
      !sessionResult.startEnabled ||
      !sessionResult.pauseDisabled ||
      !sessionResult.stopDisabled
    ) {
      throw new Error(
        `Live session smoke check failed: ${JSON.stringify(sessionResult)}`,
      );
    }

    const petPhase = await findWindow("pet")?.webContents.executeJavaScript(
      'document.querySelector(".pet-shell")?.dataset.petPhase',
    );
    if (petPhase !== "stopped") {
      throw new Error(`Pet live phase smoke check failed: ${String(petPhase)}`);
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
  const activityAdapter = new MacOSApplicationAdapter(
    new ChildProcessNativeHelperRunner(helperPath),
    clock,
  );
  applicationProvider = activityAdapter;
  sessionRuntime = new SessionRuntime(
    activityAdapter,
    activityAdapter,
    clock,
    {
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      cancel: (handle) => clearTimeout(handle),
    },
    {
      onStateChanged: (state) => publishSessionSnapshot(managedWindows, state),
      onRuntimeError: (error) => {
        console.error(`Focus runtime unavailable: ${error.message}`);
        showRuntimeNotice(
          "Focus monitoring needs attention",
          `${error.message} Any running focus session was paused safely.`,
        );
      },
      onActivationFailed: ({ error }) => {
        console.error(`Strict return request failed: ${error.message}`);
        showRuntimeNotice(
          "Please return to your focus app",
          `${error.message} Focus Familiar did not close or block any application.`,
        );
      },
    },
  );
  sessionRuntime.startMonitoring();

  if (isSmokeTest) {
    const current = await activityAdapter.currentApplication();
    if (!current.ok) {
      throw new Error(
        `Application awareness smoke check failed: ${current.error.message}`,
      );
    }
  }
}

function showRuntimeNotice(message: string, detail: string): void {
  if (isSmokeTest || isQuitting) return;
  const settings = findWindow("settings");
  settings?.show();
  if (settings) settings.focus();
  const options: MessageBoxOptions = {
    type: "warning",
    title: "Focus Familiar",
    message,
    detail,
    buttons: ["OK"],
    noLink: true,
  };
  if (settings) void dialog.showMessageBox(settings, options);
  else void dialog.showMessageBox(options);
}
