import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  screen,
  shell,
  type MessageBoxOptions,
} from "electron";

import {
  publishSessionSnapshot,
  publishUpdateStatus,
  registerIpcHandlers,
  type ManagedWindow,
} from "./ipc";
import { LocalSettingsService } from "./local-settings-service";
import { resolveMacOSActivityHelperPath } from "./native-helper";
import { SessionRuntime } from "./session-runtime";
import {
  resolveSettingsFilePath,
  SettingsRepository,
} from "./settings-repository";
import {
  getWindowOptions,
  clampPetWindowBounds,
  loadRendererWindow,
  resizePetWindowBounds,
  resolveRendererTarget,
  type WindowKind,
} from "./windows";
import { ChildProcessNativeHelperRunner } from "../platform/macos/helper-runner";
import { MacOSApplicationAdapter } from "../platform/macos/macos-application-adapter";
import {
  createPausedSessionFromRecovery,
  PET_WINDOW_SIZE_DEFAULT,
  type PetWindowPlacement,
  type PausedSessionRecovery,
} from "../core";
import type { ActivityProvider, Clock } from "../platform/application";
import { IPC_EVENTS } from "../shared/ipc";
import {
  githubReleasePageUrl,
  GitHubReleaseSource,
  UpdateChecker,
} from "./update-checker";
import { UpdateCheckScheduler } from "./update-check-scheduler";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(moduleDirectory, "../preload/index.cjs");
const rendererDirectory = join(moduleDirectory, "../renderer");
const isSmokeTest = process.argv.includes("--smoke-test");
const expectsSmokeRecovery = process.argv.includes("--expect-recovery");
const managedWindows: ManagedWindow[] = [];
let isQuitting = false;
let sessionRuntime: SessionRuntime | undefined;
let applicationProvider: ActivityProvider | undefined;
let runtimeClock: Clock | undefined;
let localSettings: LocalSettingsService | undefined;
let updateChecker: UpdateChecker | undefined;
let unsubscribeFromUpdateChecker: (() => void) | undefined;
let automaticUpdateChecks: UpdateCheckScheduler | undefined;
let restoredRecovery: PausedSessionRecovery | null = null;
let quitPreparation: Promise<void> | undefined;
let isReadyToQuit = false;
let didShowCheckpointFailure = false;
let didShowPetPlacementFailure = false;
let petPlacementSaveTimer: ReturnType<typeof setTimeout> | undefined;
let isDisplayRecoveryInstalled = false;
let pendingPreferencesFlush:
  | { readonly requestId: string; readonly resolve: () => void }
  | undefined;

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
      createUpdateChecker();
      removeIpcHandlers = registerIpcHandlers({
        app,
        ipcMain,
        getWindows: () => managedWindows,
        getApplicationProvider: () => applicationProvider,
        getSessionController: () => sessionRuntime,
        getSettingsController: () => localSettings,
        getUpdateController: () => {
          const checker = updateChecker;
          return checker
            ? {
                snapshot: () => checker.snapshot(),
                check: () => checker.check(),
                openAvailableRelease,
              }
            : undefined;
        },
        getPetWindowSize: () =>
          localSettings?.petWindowPreferences().petWindowSize,
        setPetWindowSize: updatePetWindowSize,
        acknowledgePreferencesFlush: acknowledgePreferencesFlush,
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
        startAutomaticUpdateChecks();
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

  app.on("before-quit", (event) => {
    automaticUpdateChecks?.dispose();
    if (isReadyToQuit) {
      isQuitting = true;
      sessionRuntime?.dispose();
      return;
    }

    event.preventDefault();
    if (quitPreparation) return;
    isQuitting = true;
    quitPreparation = prepareToQuit()
      .catch((error: unknown) => {
        console.error(
          "Focus Familiar could not finish its quit checkpoint.",
          error,
        );
      })
      .finally(() => {
        isReadyToQuit = true;
        app.quit();
      });
  });

  app.on("will-quit", () => {
    unsubscribeFromUpdateChecker?.();
    removeIpcHandlers?.();
  });
}

function createUpdateChecker(): void {
  const currentVersion = app.getVersion();
  updateChecker = new UpdateChecker(
    currentVersion,
    new GitHubReleaseSource(
      (url, init) =>
        net.fetch(url, {
          method: "GET",
          headers: init.headers,
          signal: init.signal,
          redirect: "error",
        }),
      currentVersion,
    ),
    (error) => console.warn(`Update check unavailable: ${error.message}`),
  );
  unsubscribeFromUpdateChecker = updateChecker.subscribe((status) => {
    publishUpdateStatus(managedWindows, status);
  });
}

function startAutomaticUpdateChecks(): void {
  if (!app.isPackaged || isSmokeTest || isQuitting) return;
  const checker = updateChecker;
  if (!checker) return;
  automaticUpdateChecks = new UpdateCheckScheduler(
    () => checker.check(),
    undefined,
    (error) => console.warn(`Automatic update check failed: ${error.message}`),
  );
  automaticUpdateChecks.start();
}

async function openAvailableRelease(): Promise<void> {
  const tag = updateChecker?.availableReleaseTag();
  if (!tag) throw new Error("No newer release is available.");
  await shell.openExternal(githubReleasePageUrl(tag));
}

async function loadLocalSettings(): Promise<void> {
  localSettings = new LocalSettingsService(
    new SettingsRepository(resolveSettingsFilePath(app.getPath("userData"))),
  );
  const loaded = await localSettings.load();
  restoredRecovery = loaded.restoredRecovery;

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
  installDisplayRecovery();
}

async function createWindow(kind: WindowKind): Promise<void> {
  const petPreferences =
    kind === "pet" ? localSettings?.petWindowPreferences() : undefined;
  const window = new BrowserWindow(
    getWindowOptions(
      kind,
      preloadPath,
      petPreferences?.petWindowSize ?? PET_WINDOW_SIZE_DEFAULT,
    ),
  );
  const target = resolveRendererTarget(kind, {
    rendererDirectory,
    ...(process.env.ELECTRON_RENDERER_URL
      ? { devServerUrl: process.env.ELECTRON_RENDERER_URL }
      : {}),
  });

  managedWindows.push({ kind, window, target });
  if (kind === "pet") {
    restorePetWindowPlacement(window, petPreferences?.petWindowPlacement);
    window.on("move", schedulePetWindowPlacementSave);
  }
  if (kind === "settings") {
    window.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        window.hide();
      }
    });
  }
  window.on("closed", () => {
    if (kind === "pet") clearPetWindowPlacementTimer();
    const index = managedWindows.findIndex((entry) => entry.window === window);
    if (index >= 0) managedWindows.splice(index, 1);
  });

  await loadRendererWindow(window, target);
}

async function updatePetWindowSize(sizePx: number): Promise<void> {
  const settings = localSettings;
  if (!settings) throw new Error("Local settings are unavailable.");

  const saved = await settings.updatePetWindowSize(sizePx);
  if (!saved.ok) throw new Error(saved.error.message);

  const petWindow = findWindow("pet");
  if (!petWindow || petWindow.isDestroyed()) {
    throw new Error("The pet window is unavailable.");
  }

  const currentBounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const nextBounds = resizePetWindowBounds(
    currentBounds,
    sizePx,
    display.workArea,
  );
  petWindow.setBounds(nextBounds);
  await persistPetWindowPlacement();
}

function restorePetWindowPlacement(
  petWindow: BrowserWindow,
  placement: PetWindowPlacement | null | undefined,
): void {
  if (!placement) return;

  const targetDisplay =
    screen
      .getAllDisplays()
      .find((display) => String(display.id) === placement.displayId) ??
    screen.getDisplayNearestPoint({ x: placement.x, y: placement.y });
  const bounds = clampPetWindowBounds(
    placement.x,
    placement.y,
    petWindow.getBounds().width,
    targetDisplay.workArea,
  );
  petWindow.setBounds(bounds);
}

function schedulePetWindowPlacementSave(): void {
  clearPetWindowPlacementTimer();
  petPlacementSaveTimer = setTimeout(() => {
    petPlacementSaveTimer = undefined;
    void persistPetWindowPlacement();
  }, 250);
}

async function persistPetWindowPlacement(): Promise<void> {
  clearPetWindowPlacementTimer();
  const settings = localSettings;
  const petWindow = findWindow("pet");
  if (!settings || !petWindow || petWindow.isDestroyed()) return;

  const bounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const result = await settings.updatePetWindowPlacement({
    displayId: String(display.id),
    x: bounds.x,
    y: bounds.y,
  });
  if (result.ok || didShowPetPlacementFailure) return;

  didShowPetPlacementFailure = true;
  console.error(`Pet placement unavailable: ${result.error.message}`);
  showRuntimeNotice(
    "Pet position could not be saved",
    "You can keep using and moving Focus Familiar, but its position may reset after relaunch.",
  );
}

function clearPetWindowPlacementTimer(): void {
  if (petPlacementSaveTimer === undefined) return;
  clearTimeout(petPlacementSaveTimer);
  petPlacementSaveTimer = undefined;
}

function installDisplayRecovery(): void {
  if (isDisplayRecoveryInstalled) return;
  isDisplayRecoveryInstalled = true;
  screen.on("display-removed", recoverPetWindowToVisibleArea);
  screen.on("display-metrics-changed", recoverPetWindowToVisibleArea);
}

function recoverPetWindowToVisibleArea(): void {
  const petWindow = findWindow("pet");
  if (!petWindow || petWindow.isDestroyed()) return;

  const currentBounds = petWindow.getBounds();
  const display = screen.getDisplayMatching(currentBounds);
  const recoveredBounds = clampPetWindowBounds(
    currentBounds.x,
    currentBounds.y,
    currentBounds.width,
    display.workArea,
  );
  if (
    recoveredBounds.x !== currentBounds.x ||
    recoveredBounds.y !== currentBounds.y ||
    recoveredBounds.width !== currentBounds.width ||
    recoveredBounds.height !== currentBounds.height
  ) {
    petWindow.setBounds(recoveredBounds);
  }
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
      })(),
      petDragContract: (() => {
        const avatar = document.querySelector('#pet-avatar');
        const settingsButton = document.querySelector('#open-settings');
        if (!(avatar instanceof HTMLElement) || !(settingsButton instanceof HTMLElement)) {
          return { avatar: '', settings: '' };
        }
        return {
          avatar: getComputedStyle(avatar).getPropertyValue('-webkit-app-region'),
          settings: getComputedStyle(settingsButton).getPropertyValue('-webkit-app-region')
        };
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
        result.petImage.naturalWidth <= 0 ||
        result.petDragContract.avatar !== "drag" ||
        result.petDragContract.settings !== "no-drag")
    ) {
      throw new Error(
        `Pet renderer smoke check failed: ${JSON.stringify(result)}`,
      );
    }
  }

  if (process.platform === "darwin") {
    const petWindow = findWindow("pet");
    if (!petWindow) throw new Error("Pet window is unavailable.");
    petWindow.showInactive();
    const petContentBounds = petWindow.getContentBounds();
    petWindow.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(petContentBounds.width / 2),
      y: Math.round(petContentBounds.height / 3),
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const hoverResult = await petWindow.webContents.executeJavaScript(`({
      motion: document.querySelector('.pet-shell')?.dataset.petMotion,
      action: document.querySelector('.pet-shell')?.dataset.petAction
    })`);
    const hoverActionStarted =
      hoverResult.motion === "hover-action" &&
      ["ear-twitch", "sleepy-blink"].includes(hoverResult.action);
    if (
      (expectsSmokeRecovery && hoverActionStarted) ||
      (!expectsSmokeRecovery && !hoverActionStarted)
    ) {
      throw new Error(
        `Pet hover-action smoke check failed: ${JSON.stringify(hoverResult)}`,
      );
    }

    const settingsWindow = findWindow("settings");
    if (!settingsWindow) throw new Error("Settings window is unavailable.");
    const initialPetBounds = findWindow("pet")?.getBounds();
    const sessionResult = await settingsWindow.webContents.executeJavaScript(`
      (async () => {
        const appInfo = await window.focusFamiliar.getAppInfo();
        const updateStatus = await window.focusFamiliar.getUpdateStatus();
        const initial = await window.focusFamiliar.getSessionSnapshot();
        const initialPreferences = await window.focusFamiliar.getSessionPreferences();
        const initialPetWindowPreferences = await window.focusFamiliar.getPetWindowPreferences();
        const savedPetWindowPreferences = await window.focusFamiliar.setPetWindowSize(320);
        const initialSelectedTarget = document.querySelector("#target-application")?.value;
        if (initial.phase === "paused") {
          await window.focusFamiliar.requestSessionAction("stop");
        }
        const applications = await window.focusFamiliar.listApplications();
        const targetApplication = applications[0];
        if (!targetApplication) return { ok: false, reason: "no-applications" };
        const savedPreferences = await window.focusFamiliar.saveSessionPreferences({
          taskDraft: "Saved smoke draft",
          targetApplication,
          durationMs: 60000,
          gracePeriodMs: 1000,
          interventionAfterMs: 3000,
          intensity: "balanced"
        });
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
        const taskInput = document.querySelector("#task");
        if (taskInput instanceof HTMLInputElement) {
          taskInput.value = "Flushed during quit";
          taskInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return {
          ok: true,
          appInfo,
          updateStatus,
          renderedUpdateStatus: document.querySelector("#update-status")?.textContent,
          updateCheckEnabled: !document.querySelector("#check-updates")?.disabled,
          updateReleaseHidden: document.querySelector("#view-update")?.hidden,
          initial,
          initialPreferences,
          initialPetWindowPreferences,
          savedPetWindowPreferences,
          initialSelectedTarget,
          savedPreferences,
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
      sessionResult.appInfo.version !== "0.1.0-prototype.4" ||
      sessionResult.updateStatus.phase !== "not-checked" ||
      sessionResult.updateStatus.currentVersion !== "0.1.0-prototype.4" ||
      !sessionResult.renderedUpdateStatus?.includes("0.1.0-prototype.4") ||
      !sessionResult.updateCheckEnabled ||
      !sessionResult.updateReleaseHidden ||
      (expectsSmokeRecovery &&
        (sessionResult.initial.phase !== "paused" ||
          sessionResult.initial.focusedMs !== 1_234 ||
          sessionResult.initialSelectedTarget !==
            "com.example.RecoveredEditor" ||
          sessionResult.initialPreferences.taskDraft !==
            "Recovered smoke draft" ||
          sessionResult.initialPetWindowPreferences.sizePx !== 280 ||
          initialPetBounds?.width !== 280 ||
          initialPetBounds?.height !== 280)) ||
      sessionResult.savedPreferences.taskDraft !== "Saved smoke draft" ||
      sessionResult.savedPetWindowPreferences.sizePx !== 320 ||
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
    const petBounds = findWindow("pet")?.getBounds();
    if (petBounds?.width !== 320 || petBounds.height !== 320) {
      throw new Error(
        `Pet resize smoke check failed: ${JSON.stringify(petBounds)}`,
      );
    }
  }
}

async function startApplicationAwareness(): Promise<void> {
  if (process.platform !== "darwin") return;

  const clock: Clock = {
    nowMs: (): number => Math.floor(performance.timeOrigin + performance.now()),
  };
  runtimeClock = clock;
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
  const initialState = restoredRecovery
    ? createPausedSessionFromRecovery(restoredRecovery, clock.nowMs())
    : null;
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
      ...(initialState ? { initialState } : {}),
      onStateChanged: (state) => {
        publishSessionSnapshot(managedWindows, state);
        const checkpoint = localSettings?.checkpointSession(
          state,
          clock.nowMs(),
        );
        void checkpoint?.then((result) => {
          if (result.ok || didShowCheckpointFailure) return;
          didShowCheckpointFailure = true;
          console.error(
            `Session recovery unavailable: ${result.error.message}`,
          );
          showRuntimeNotice(
            "Session recovery is unavailable",
            "Focus Familiar can keep running, but this session may not be recoverable after the app closes.",
          );
        });
      },
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

async function prepareToQuit(): Promise<void> {
  await flushRendererPreferences();
  await persistPetWindowPlacement();

  const runtime = sessionRuntime;
  const settings = localSettings;
  const clock = runtimeClock;
  if (runtime && settings && clock) {
    const state = runtime.snapshot();
    const shouldPause =
      state.phase === "focused" ||
      state.phase === "grace" ||
      state.phase === "nudge" ||
      state.phase === "intervention";
    const finalState = shouldPause ? runtime.pause().state : state;
    const saved = await settings.checkpointSession(finalState, clock.nowMs());
    if (!saved.ok) {
      console.error(`Final session recovery failed: ${saved.error.message}`);
    }
    await settings.flush();
  }
  runtime?.dispose();
}

async function flushRendererPreferences(): Promise<void> {
  const settings = findWindow("settings");
  if (!settings || settings.isDestroyed()) return;

  const requestId = randomUUID();
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      if (pendingPreferencesFlush?.requestId === requestId) {
        pendingPreferencesFlush = undefined;
      }
      resolve();
    };

    pendingPreferencesFlush = { requestId, resolve: finish };
    const timeout = setTimeout(finish, 1_500);
    settings.webContents.send(IPC_EVENTS.preferencesFlushRequested, requestId);
  });
}

function acknowledgePreferencesFlush(requestId: string): void {
  if (pendingPreferencesFlush?.requestId !== requestId) return;
  pendingPreferencesFlush.resolve();
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
