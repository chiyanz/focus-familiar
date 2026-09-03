import type {
  ApplicationSummary,
  SessionAction,
  SessionPhase,
  SessionPreferences,
  SessionSnapshot,
  SessionStartConfig,
  UpdateStatus,
} from "../shared/ipc";
import {
  PET_WINDOW_SIZE_DEFAULT,
  PET_WINDOW_SIZE_MAX,
  PET_WINDOW_SIZE_MIN,
} from "../core/settings";
import {
  areSessionPreferencesEqual,
  DEFAULT_SESSION_PREFERENCES,
  fallbackTaskForTarget,
  normalizeSessionIntensity,
  preferencesFromConfig,
  taskForStart,
} from "./session-preferences";

import "./settings.css";

const sessionApi = (window as Partial<Window>).focusFamiliar;

const versionLabel = document.querySelector<HTMLElement>("#app-version");
const closeButton =
  document.querySelector<HTMLButtonElement>("#close-settings");
const quitButton = document.querySelector<HTMLButtonElement>("#quit-app");
const sessionForm = document.querySelector<HTMLFormElement>("#session-form");
const taskInput = document.querySelector<HTMLInputElement>("#task");
const targetSelect = document.querySelector<HTMLSelectElement>(
  "#target-application",
);
const refreshApplicationsButton = document.querySelector<HTMLButtonElement>(
  "#refresh-applications",
);
const durationInput =
  document.querySelector<HTMLInputElement>("#duration-minutes");
const intensitySelect = document.querySelector<HTMLSelectElement>("#intensity");
const intensityHelp = document.querySelector<HTMLElement>("#intensity-hint");
const graceInput = document.querySelector<HTMLInputElement>("#grace-seconds");
const interventionInput = document.querySelector<HTMLInputElement>(
  "#intervention-seconds",
);
const startButton = document.querySelector<HTMLButtonElement>("#start-session");
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-session");
const stopButton = document.querySelector<HTMLButtonElement>("#stop-session");
const statusDot = document.querySelector<HTMLElement>("#status-dot");
const statusLabel = document.querySelector<HTMLElement>("#status-label");
const focusTime = document.querySelector<HTMLElement>("#focus-time");
const focusProgress =
  document.querySelector<HTMLProgressElement>("#focus-progress");
const statusDetail = document.querySelector<HTMLElement>("#status-detail");
const formError = document.querySelector<HTMLElement>("#form-error");
const saveStatus = document.querySelector<HTMLElement>("#save-status");
const petSizeInput = document.querySelector<HTMLInputElement>("#pet-size");
const petSizeValue =
  document.querySelector<HTMLOutputElement>("#pet-size-value");
const petSizeStatus = document.querySelector<HTMLElement>("#pet-size-status");
const updateCard = document.querySelector<HTMLElement>("#update-card");
const updateStatus = document.querySelector<HTMLElement>("#update-status");
const checkUpdatesButton =
  document.querySelector<HTMLButtonElement>("#check-updates");
const viewUpdateButton =
  document.querySelector<HTMLButtonElement>("#view-update");

const configurationControls = [
  taskInput,
  targetSelect,
  refreshApplicationsButton,
  durationInput,
  intensitySelect,
  graceInput,
  interventionInput,
].filter(
  (
    control,
  ): control is HTMLInputElement | HTMLSelectElement | HTMLButtonElement =>
    control !== null,
);

const PHASE_LABELS: Readonly<Record<SessionPhase, string>> = {
  idle: "Ready to focus",
  focused: "Focused",
  grace: "A gentle reminder",
  nudge: "A small nudge",
  intervention: "Time to return",
  paused: "Focus paused",
  completed: "Focus complete",
  stopped: "Session stopped",
};

const applications = new Map<string, ApplicationSummary>();
let currentSnapshot: SessionSnapshot | undefined;
let applicationsLoading = false;
let actionInFlight = false;
let focusDisplayTimer: number | undefined;
let focusDisplayStartedAtMs = 0;
let focusDisplayBaseMs = 0;
let focusDisplayDurationMs = 0;
let focusDisplaySessionId: string | null = null;
let preferencesReady = false;
let loadedPreferences: SessionPreferences | undefined;
let lastSavedPreferences: SessionPreferences = {
  ...DEFAULT_SESSION_PREFERENCES,
};
let saveTimer: number | undefined;
let saveGeneration = 0;
let pendingPreferences: SessionPreferences | undefined;
let inFlightSave: Promise<boolean> | undefined;
let lastSavedPetSize = PET_WINDOW_SIZE_DEFAULT;
let pendingPetSize: number | undefined;
let petSizeSaveTimer: number | undefined;
let petSizeSaveGeneration = 0;
let petSizeSaveQueue: Promise<void> = Promise.resolve();
let activeTaskDraft: string | undefined;

if (sessionApi) {
  void sessionApi
    .getAppInfo()
    .then(({ version }) => {
      if (versionLabel) versionLabel.textContent = `Version ${version}`;
    })
    .catch(() => {
      if (versionLabel) versionLabel.textContent = "Local prototype";
    });
} else if (versionLabel) {
  versionLabel.textContent = "Browser preview";
}

closeButton?.addEventListener("click", () => {
  void sessionApi?.requestWindowAction("hide-settings");
});

quitButton?.addEventListener("click", () => {
  void quitApp();
});

checkUpdatesButton?.addEventListener("click", () => {
  void checkForUpdates();
});

viewUpdateButton?.addEventListener("click", () => {
  void openUpdateRelease();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    void sessionApi?.requestWindowAction("hide-settings");
  }
});

refreshApplicationsButton?.addEventListener("click", () => {
  void refreshApplications();
});

sessionForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void startSession();
});

pauseButton?.addEventListener("click", () => {
  void requestSessionAction(
    currentSnapshot?.capabilities.canResume ? "resume" : "pause",
  );
});

stopButton?.addEventListener("click", () => {
  void requestSessionAction("stop");
});

durationInput?.addEventListener("input", () => {
  if (currentSnapshot?.capabilities.canStart) renderIdlePreview();
});

intensitySelect?.addEventListener("change", renderIntensityHelp);

petSizeInput?.addEventListener("input", () => {
  renderPetSizeValue(readPetSize() ?? PET_WINDOW_SIZE_DEFAULT);
  schedulePetSizeSave();
});

petSizeInput?.addEventListener("change", () => {
  void flushPendingPetSize();
});

for (const control of [
  taskInput,
  targetSelect,
  durationInput,
  intensitySelect,
  graceInput,
  interventionInput,
]) {
  control?.addEventListener("input", schedulePreferencesSave);
  control?.addEventListener("change", schedulePreferencesSave);
}

renderIntensityHelp();

let unsubscribeFromSession: (() => void) | undefined;
try {
  unsubscribeFromSession = sessionApi?.onSessionChanged((snapshot) => {
    applySnapshot(snapshot);
  });
} catch (error: unknown) {
  showError(errorMessage(error, "Live session updates are unavailable."));
}

let unsubscribeFromPreferencesFlush: (() => void) | undefined;
try {
  unsubscribeFromPreferencesFlush = sessionApi?.onPreferencesFlushRequested(
    flushPendingPreferences,
  );
} catch (error: unknown) {
  showError(errorMessage(error, "Could not prepare local preference saves."));
}

let unsubscribeFromUpdateStatus: (() => void) | undefined;
try {
  unsubscribeFromUpdateStatus = sessionApi?.onUpdateStatusChanged((status) => {
    renderUpdateStatus(status);
  });
} catch {
  renderUpdateUnavailable();
}

void loadInitialState();

async function loadInitialState(): Promise<void> {
  await Promise.all([
    refreshApplications(),
    loadSessionSnapshot(),
    loadPetWindowPreferences(),
    loadUpdateStatus(),
  ]);
  await loadSessionPreferences();
  preferencesReady = true;
  if (currentSnapshot) applySnapshot(currentSnapshot);
  else renderIdlePreview();
  if (loadedPreferences && currentSnapshot?.capabilities.canStart) {
    applySavedPreferences(loadedPreferences);
  }
}

async function loadUpdateStatus(): Promise<void> {
  if (!sessionApi) {
    if (updateStatus) updateStatus.textContent = "Browser preview";
    return;
  }

  try {
    renderUpdateStatus(await sessionApi.getUpdateStatus());
  } catch {
    renderUpdateUnavailable();
  }
}

async function checkForUpdates(): Promise<void> {
  if (!sessionApi) return;
  try {
    renderUpdateStatus(await sessionApi.checkForUpdates());
  } catch {
    renderUpdateUnavailable();
  }
}

async function openUpdateRelease(): Promise<void> {
  if (!sessionApi) return;
  try {
    await sessionApi.openUpdateRelease();
  } catch {
    if (updateStatus) {
      updateStatus.textContent =
        "The release page couldn’t be opened. Check again and retry.";
    }
  }
}

function renderUpdateStatus(status: UpdateStatus): void {
  if (updateCard) updateCard.dataset.updatePhase = status.phase;
  if (checkUpdatesButton) {
    checkUpdatesButton.disabled = status.phase === "checking";
    checkUpdatesButton.textContent =
      status.phase === "checking"
        ? "Checking…"
        : status.phase === "not-checked"
          ? "Check now"
          : "Check again";
  }
  if (viewUpdateButton) {
    viewUpdateButton.hidden = status.phase !== "available";
  }
  if (!updateStatus) return;

  switch (status.phase) {
    case "not-checked":
      updateStatus.textContent = `Version ${status.currentVersion}. An automatic check will run shortly.`;
      break;
    case "checking":
      updateStatus.textContent = "Checking GitHub for a newer release…";
      break;
    case "up-to-date":
      updateStatus.textContent = `Version ${status.currentVersion} is up to date.`;
      break;
    case "available":
      updateStatus.textContent = `Version ${status.latestVersion} is ready. Review and install it from GitHub.`;
      break;
    case "error":
      updateStatus.textContent =
        "Couldn’t reach GitHub. Focus sessions still work normally; try again later.";
      break;
  }
}

function renderUpdateUnavailable(): void {
  if (updateCard) updateCard.dataset.updatePhase = "error";
  if (updateStatus) {
    updateStatus.textContent = "Update checks are unavailable in this build.";
  }
  if (checkUpdatesButton) checkUpdatesButton.disabled = true;
  if (viewUpdateButton) viewUpdateButton.hidden = true;
}

async function loadPetWindowPreferences(): Promise<void> {
  if (!sessionApi) {
    renderPetSizeValue(PET_WINDOW_SIZE_DEFAULT);
    setPetSizeStatus("Browser preview", "idle");
    return;
  }

  try {
    const preferences = await sessionApi.getPetWindowPreferences();
    lastSavedPetSize = preferences.sizePx;
    if (petSizeInput) petSizeInput.value = String(preferences.sizePx);
    renderPetSizeValue(preferences.sizePx);
    setPetSizeStatus("Saved locally", "saved");
  } catch (error: unknown) {
    setPetSizeStatus("Couldn’t load locally", "error");
    showError(errorMessage(error, "Pet size could not be loaded."));
  }
}

async function loadSessionPreferences(): Promise<void> {
  if (!sessionApi) {
    preferencesReady = true;
    setSaveStatus("Browser preview", "idle");
    return;
  }

  try {
    const loaded = await sessionApi.getSessionPreferences();
    loadedPreferences = loaded;
    lastSavedPreferences = { ...loaded };
    setSaveStatus("Saved locally", "saved");
  } catch (error: unknown) {
    preferencesReady = true;
    setSaveStatus("Couldn’t load locally", "error");
    showError(errorMessage(error, "Saved preferences could not be loaded."));
  }
}

async function loadSessionSnapshot(): Promise<void> {
  if (!sessionApi) {
    showError("Open this page from the Focus Familiar app to start a session.");
    renderIdlePreview();
    return;
  }
  try {
    const snapshot = await sessionApi.getSessionSnapshot();
    applySnapshot(snapshot);
  } catch (error: unknown) {
    showError(errorMessage(error, "Focus sessions are unavailable right now."));
    renderIdlePreview(false);
  }
}

async function refreshApplications(): Promise<void> {
  if (applicationsLoading) return;
  applicationsLoading = true;
  if (refreshApplicationsButton) {
    refreshApplicationsButton.disabled = true;
    refreshApplicationsButton.textContent = "Refreshing…";
  }

  const previousSelection = targetSelect?.value ?? "";
  const previousApplication = previousSelection
    ? applications.get(previousSelection)
    : undefined;
  if (!sessionApi) {
    renderApplicationOptions(previousSelection);
    showError(
      "Open this page from the Focus Familiar app to list running apps.",
    );
    applicationsLoading = false;
    if (refreshApplicationsButton) {
      refreshApplicationsButton.disabled = false;
      refreshApplicationsButton.textContent = "Refresh";
    }
    return;
  }
  try {
    const runningApplications = await sessionApi.listApplications();
    const activeApplication = currentSnapshot?.targetApplication;
    const applicationToPreserve = activeApplication ?? previousApplication;
    const preferredBundleId =
      activeApplication?.bundleId ?? targetSelect?.value ?? previousSelection;

    applications.clear();
    for (const application of runningApplications) {
      if (!isApplication(application)) continue;
      applications.set(application.bundleId, application);
    }
    if (
      applicationToPreserve &&
      !applications.has(applicationToPreserve.bundleId)
    ) {
      applications.set(applicationToPreserve.bundleId, applicationToPreserve);
    }
    renderApplicationOptions(preferredBundleId);
    if (applications.size === 0) {
      showError(
        "No running applications were found. Open your focus app and refresh.",
      );
    } else if (formError?.textContent?.includes("No running applications")) {
      clearError();
    }
  } catch (error: unknown) {
    renderApplicationOptions(previousSelection);
    showError(errorMessage(error, "Could not read running applications."));
  } finally {
    applicationsLoading = false;
    if (refreshApplicationsButton) {
      refreshApplicationsButton.disabled = isConfigurationLocked();
      refreshApplicationsButton.textContent = "Refresh";
    }
  }
}

function renderApplicationOptions(preferredBundleId: string): void {
  if (!targetSelect) return;

  const selectedBundleId = applications.has(preferredBundleId)
    ? preferredBundleId
    : chooseDefaultApplication();
  targetSelect.replaceChildren();

  if (applications.size === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No running apps found";
    targetSelect.append(emptyOption);
    targetSelect.value = "";
    return;
  }

  const sortedApplications = [...applications.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose an app…";
  targetSelect.append(placeholder);
  for (const application of sortedApplications) {
    const option = document.createElement("option");
    option.value = application.bundleId;
    option.textContent = application.name;
    targetSelect.append(option);
  }
  targetSelect.value = selectedBundleId;
}

function chooseDefaultApplication(): string {
  const preferredNames = ["visual studio code", "cursor", "code"];
  const preferred = [...applications.values()].find((application) => {
    const normalized = application.name.trim().toLocaleLowerCase();
    return preferredNames.some(
      (name) => normalized === name || normalized.includes(name),
    );
  });
  return preferred?.bundleId ?? applications.keys().next().value ?? "";
}

async function startSession(): Promise<void> {
  if (
    actionInFlight ||
    (currentSnapshot !== undefined && !currentSnapshot.capabilities.canStart)
  ) {
    return;
  }
  if (!sessionApi) {
    showError("Open this page from the Focus Familiar app to start a session.");
    return;
  }
  clearError();

  const request = readSessionConfig();
  if (!request.ok) {
    showError(request.message);
    request.focus?.focus();
    return;
  }

  const taskDraft = taskInput?.value ?? "";
  setActionInFlight(startButton, "Saving…");
  const saved = await savePreferencesBeforeStart(
    preferencesFromConfig(request.config, taskDraft),
  );
  if (!saved) {
    clearActionInFlight(startButton, "Start focus");
    return;
  }

  if (startButton) startButton.textContent = "Starting…";
  try {
    const snapshot = await sessionApi.startSession(request.config);
    activeTaskDraft = taskDraft;
    applySnapshot(snapshot);
  } catch (error: unknown) {
    showError(errorMessage(error, "The focus session could not start."));
  } finally {
    clearActionInFlight(startButton, "Start focus");
  }
}

async function requestSessionAction(
  action: SessionAction | undefined,
): Promise<void> {
  if (!action || actionInFlight) return;
  if (!sessionApi) {
    showError(
      "Open this page from the Focus Familiar app to control a session.",
    );
    return;
  }
  clearError();
  if (action === "pause") setActionInFlight(pauseButton, "Pausing…");
  else if (action === "resume") setActionInFlight(pauseButton, "Resuming…");
  else setActionInFlight(stopButton, "Stopping…");

  try {
    const snapshot = await sessionApi.requestSessionAction(action);
    applySnapshot(snapshot);
  } catch (error: unknown) {
    showError(
      errorMessage(error, "That session action could not be completed."),
    );
  } finally {
    clearActionInFlight(
      pauseButton,
      currentSnapshot?.capabilities.canResume ? "Resume" : "Pause",
    );
    clearActionInFlight(stopButton, "Stop");
  }
}

function readSessionConfig():
  | { readonly ok: true; readonly config: SessionStartConfig }
  | {
      readonly ok: false;
      readonly message: string;
      readonly focus?: HTMLInputElement | HTMLSelectElement | null;
    } {
  const targetApplication = targetSelect
    ? applications.get(targetSelect.value)
    : undefined;
  if (!targetApplication) {
    return {
      ok: false,
      message: "Choose a running app to focus on, then try again.",
      focus: targetSelect,
    };
  }

  const task = taskForStart(taskInput?.value ?? "", targetApplication);

  const durationMinutes = readInteger(durationInput?.value, 1, 480);
  if (durationMinutes === undefined) {
    return {
      ok: false,
      message: "Focus time must be a whole number of minutes from 1 to 480.",
      focus: durationInput,
    };
  }

  const graceSeconds = readInteger(graceInput?.value, 0, 3_600);
  if (graceSeconds === undefined) {
    return {
      ok: false,
      message: "Gentle grace must be a whole number of seconds from 0 to 3600.",
      focus: graceInput,
    };
  }

  const interventionSeconds = readInteger(interventionInput?.value, 1, 7_200);
  if (interventionSeconds === undefined) {
    return {
      ok: false,
      message: "Return time must be a whole number of seconds from 1 to 7200.",
      focus: interventionInput,
    };
  }
  if (interventionSeconds <= graceSeconds) {
    return {
      ok: false,
      message: "Return time must be longer than the gentle grace period.",
      focus: interventionInput,
    };
  }

  const intensity = readIntensity(intensitySelect?.value);
  if (!intensity) {
    return {
      ok: false,
      message: "Choose how the pet should respond when you stay away.",
      focus: intensitySelect,
    };
  }

  return {
    ok: true,
    config: {
      task,
      targetApplication,
      durationMs: durationMinutes * 60_000,
      gracePeriodMs: graceSeconds * 1_000,
      interventionAfterMs: interventionSeconds * 1_000,
      intensity,
    },
  };
}

function applySavedPreferences(preferences: SessionPreferences): void {
  if (taskInput) taskInput.value = preferences.taskDraft;
  if (
    preferences.targetApplication &&
    applications.has(preferences.targetApplication.bundleId)
  ) {
    renderApplicationOptions(preferences.targetApplication.bundleId);
  } else if (targetSelect) {
    renderApplicationOptions(targetSelect.value);
    targetSelect.value = "";
  }
  if (durationInput) {
    durationInput.value = String(
      Math.max(1, Math.round(preferences.durationMs / 60_000)),
    );
  }
  if (graceInput) {
    graceInput.value = String(
      Math.max(0, Math.round(preferences.gracePeriodMs / 1_000)),
    );
  }
  if (interventionInput) {
    interventionInput.value = String(
      Math.max(1, Math.round(preferences.interventionAfterMs / 1_000)),
    );
  }
  if (intensitySelect) {
    intensitySelect.value = normalizeSessionIntensity(preferences.intensity);
  }
  renderIntensityHelp();
  if (currentSnapshot?.phase === "idle") renderIdlePreview();
}

function readSessionPreferences():
  | { readonly ok: true; readonly preferences: SessionPreferences }
  | { readonly ok: false; readonly message: string } {
  const durationMinutes = readInteger(durationInput?.value, 1, 480);
  if (durationMinutes === undefined) {
    return {
      ok: false,
      message: "Focus time must be a whole number of minutes from 1 to 480.",
    };
  }

  const graceSeconds = readInteger(graceInput?.value, 0, 3_600);
  if (graceSeconds === undefined) {
    return {
      ok: false,
      message: "Gentle grace must be a whole number of seconds from 0 to 3600.",
    };
  }

  const interventionSeconds = readInteger(interventionInput?.value, 1, 7_200);
  if (interventionSeconds === undefined) {
    return {
      ok: false,
      message: "Return time must be a whole number of seconds from 1 to 7200.",
    };
  }
  if (interventionSeconds <= graceSeconds) {
    return {
      ok: false,
      message: "Return time must be longer than the gentle grace period.",
    };
  }

  const intensity = readIntensity(intensitySelect?.value);
  if (!intensity) {
    return {
      ok: false,
      message: "Choose how the pet should respond when you stay away.",
    };
  }

  const targetApplication = targetSelect?.value
    ? (applications.get(targetSelect.value) ?? null)
    : null;
  return {
    ok: true,
    preferences: {
      taskDraft: taskInput?.value ?? "",
      targetApplication,
      durationMs: durationMinutes * 60_000,
      gracePeriodMs: graceSeconds * 1_000,
      interventionAfterMs: interventionSeconds * 1_000,
      intensity,
    },
  };
}

function schedulePreferencesSave(): void {
  if (
    !preferencesReady ||
    !sessionApi ||
    (currentSnapshot !== undefined && !currentSnapshot.capabilities.canStart)
  ) {
    return;
  }

  clearSaveTimer();
  const result = readSessionPreferences();
  if (!result.ok) {
    pendingPreferences = undefined;
    saveGeneration += 1;
    setSaveStatus("Not saved yet", "error");
    return;
  }
  if (areSessionPreferencesEqual(result.preferences, lastSavedPreferences)) {
    pendingPreferences = undefined;
    saveGeneration += 1;
    setSaveStatus("Saved locally", "saved");
    return;
  }

  pendingPreferences = result.preferences;
  const generation = ++saveGeneration;
  setSaveStatus("Saving…", "saving");
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    const preferences = pendingPreferences;
    pendingPreferences = undefined;
    if (!preferences) return;
    void persistPreferences(preferences, generation);
  }, 500);
}

async function savePreferencesBeforeStart(
  preferences: SessionPreferences,
): Promise<boolean> {
  clearSaveTimer();
  pendingPreferences = undefined;
  const generation = ++saveGeneration;
  if (!sessionApi) return false;

  if (inFlightSave) await inFlightSave;
  if (currentSnapshot && !currentSnapshot.capabilities.canStart) {
    showError("The session became active before its preferences were saved.");
    return false;
  }
  return persistPreferences(preferences, generation);
}

async function persistPreferences(
  preferences: SessionPreferences,
  generation: number,
): Promise<boolean> {
  if (!sessionApi) return false;
  if (currentSnapshot && !currentSnapshot.capabilities.canStart) return false;

  setSaveStatus("Saving…", "saving");
  const savePromise = (async (): Promise<boolean> => {
    try {
      await sessionApi.saveSessionPreferences(preferences);
      lastSavedPreferences = { ...preferences };
      if (generation === saveGeneration)
        setSaveStatus("Saved locally", "saved");
      return true;
    } catch (error: unknown) {
      if (generation === saveGeneration) {
        setSaveStatus("Couldn’t save locally", "error");
        showError(
          errorMessage(error, "Preferences could not be saved locally."),
        );
      }
      return false;
    }
  })();
  inFlightSave = savePromise;
  try {
    return await savePromise;
  } finally {
    if (inFlightSave === savePromise) inFlightSave = undefined;
  }
}

function applySnapshot(snapshot: SessionSnapshot): void {
  currentSnapshot = snapshot;

  // A recovered session may arrive before preferences finish loading. Keep the
  // raw optional note around so ending that session does not turn our generated
  // core task into a persisted draft.
  if (
    !snapshot.capabilities.canStart &&
    activeTaskDraft === undefined &&
    loadedPreferences !== undefined &&
    snapshot.sessionId !== null
  ) {
    activeTaskDraft = loadedPreferences.taskDraft;
  }

  if (snapshot.capabilities.canStart && activeTaskDraft !== undefined) {
    if (taskInput) taskInput.value = activeTaskDraft;
    activeTaskDraft = undefined;
  }

  if (!snapshot.capabilities.canStart) {
    if (snapshot.task !== null && taskInput) {
      taskInput.value = snapshot.task;
    }
    if (snapshot.targetApplication !== null) {
      applications.set(
        snapshot.targetApplication.bundleId,
        snapshot.targetApplication,
      );
      renderApplicationOptions(snapshot.targetApplication.bundleId);
    }
    if (snapshot.durationMs !== null && durationInput) {
      durationInput.value = String(Math.round(snapshot.durationMs / 60_000));
    }
    if (
      snapshot.gracePeriodMs !== null &&
      graceInput &&
      snapshot.sessionId !== null
    ) {
      graceInput.value = String(Math.round(snapshot.gracePeriodMs / 1_000));
    }
    if (
      snapshot.interventionAfterMs !== null &&
      interventionInput &&
      snapshot.sessionId !== null
    ) {
      interventionInput.value = String(
        Math.round(snapshot.interventionAfterMs / 1_000),
      );
    }
    if (snapshot.intensity !== null && intensitySelect) {
      intensitySelect.value = normalizeSessionIntensity(snapshot.intensity);
      renderIntensityHelp();
    }
  }

  const durationMs = snapshot.durationMs ?? readPreviewDurationMs();
  resetFocusDisplay(snapshot, durationMs);
  if (statusLabel) statusLabel.textContent = PHASE_LABELS[snapshot.phase];
  if (statusDot) statusDot.dataset.phase = snapshot.phase;
  if (statusDetail) statusDetail.textContent = detailFor(snapshot);

  setConfigurationEnabled(snapshot.capabilities.canStart);
  if (startButton) {
    startButton.disabled = !snapshot.capabilities.canStart || actionInFlight;
    startButton.textContent = "Start focus";
  }
  if (pauseButton) {
    pauseButton.disabled =
      actionInFlight ||
      (!snapshot.capabilities.canPause && !snapshot.capabilities.canResume);
    pauseButton.textContent = snapshot.capabilities.canResume
      ? "Resume"
      : "Pause";
  }
  if (stopButton) {
    stopButton.disabled = actionInFlight || !snapshot.capabilities.canStop;
  }
}

function renderIdlePreview(sessionAvailable = Boolean(sessionApi)): void {
  const durationMs = readPreviewDurationMs();
  stopFocusDisplayTimer();
  renderFocusProgress(0, durationMs);
  if (statusLabel) statusLabel.textContent = PHASE_LABELS.idle;
  if (statusDot) statusDot.dataset.phase = "idle";
  if (statusDetail) {
    statusDetail.textContent = sessionAvailable
      ? "Pick an app, then start when you’re ready."
      : "Focus sessions are unavailable on this platform.";
  }
  setConfigurationEnabled(true);
  if (startButton) startButton.disabled = !sessionAvailable;
  if (pauseButton) pauseButton.disabled = true;
  if (stopButton) stopButton.disabled = true;
}

/**
 * Progress counters are authoritative when they arrive from main. While the
 * user is focused, this display-only clock fills the quiet seconds between
 * runtime events. It never sends an event or drives a transition.
 */
function resetFocusDisplay(
  snapshot: SessionSnapshot,
  durationMs: number,
): void {
  stopFocusDisplayTimer();
  renderFocusProgress(snapshot.focusedMs, durationMs);

  if (
    snapshot.phase !== "focused" ||
    snapshot.durationMs === null ||
    snapshot.sessionId === null
  ) {
    return;
  }

  focusDisplayStartedAtMs = performance.now();
  focusDisplayBaseMs = snapshot.focusedMs;
  focusDisplayDurationMs = durationMs;
  focusDisplaySessionId = snapshot.sessionId;
  focusDisplayTimer = window.setInterval(() => {
    const activeSnapshot = currentSnapshot;
    if (
      activeSnapshot === undefined ||
      activeSnapshot.sessionId !== focusDisplaySessionId ||
      activeSnapshot.phase !== "focused"
    ) {
      stopFocusDisplayTimer();
      return;
    }

    const elapsedMs = Math.max(0, performance.now() - focusDisplayStartedAtMs);
    const projectedFocusedMs = Math.min(
      focusDisplayDurationMs,
      focusDisplayBaseMs + Math.floor(elapsedMs),
    );
    renderFocusProgress(projectedFocusedMs, focusDisplayDurationMs);
  }, 1_000);
}

function stopFocusDisplayTimer(): void {
  if (focusDisplayTimer !== undefined) {
    window.clearInterval(focusDisplayTimer);
    focusDisplayTimer = undefined;
  }
  focusDisplaySessionId = null;
}

function renderFocusProgress(focusedMs: number, durationMs: number): void {
  const safeDurationMs = Math.max(1, durationMs);
  const safeFocusedMs = Math.max(0, Math.min(focusedMs, safeDurationMs));
  if (focusProgress) {
    focusProgress.max = safeDurationMs;
    focusProgress.value = safeFocusedMs;
    focusProgress.setAttribute(
      "aria-label",
      `Focused time: ${formatDuration(safeFocusedMs)} of ${formatDuration(safeDurationMs)}`,
    );
  }
  if (focusTime) {
    focusTime.textContent = `${formatDuration(safeFocusedMs)} / ${formatDuration(safeDurationMs)}`;
  }
}

function detailFor(snapshot: SessionSnapshot): string {
  const targetName = snapshot.targetApplication?.name ?? "your focus app";
  switch (snapshot.phase) {
    case "idle":
      return "Pick an app, then start when you’re ready.";
    case "focused":
      return snapshot.task && !isFallbackTask(snapshot)
        ? `Working on “${snapshot.task}” in ${targetName}.`
        : `Focusing in ${targetName}; you’re doing well.`;
    case "grace":
      return `You’re away from ${targetName}. Come back when you’re ready.`;
    case "nudge":
      return `A little time away. Let’s return to ${targetName}.`;
    case "intervention":
      return `The pet is waiting for you in ${targetName}. You can pause or stop here.`;
    case "paused":
      return `Paused with ${formatDuration(snapshot.focusedMs)} of focused time. Resume when ready.`;
    case "completed":
      return `You reached ${formatDuration(snapshot.focusedMs)} of focused time. Nice work.`;
    case "stopped":
      return "This session is stopped. You can start another whenever you’re ready.";
  }
}

function setConfigurationEnabled(enabled: boolean): void {
  for (const control of configurationControls) {
    control.disabled = !enabled || actionInFlight || !preferencesReady;
  }
}

function clearSaveTimer(): void {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

function setSaveStatus(
  message: string,
  state: "idle" | "saved" | "saving" | "error",
): void {
  if (!saveStatus) return;
  saveStatus.textContent = message;
  saveStatus.dataset.saveState = state;
}

function readPetSize(): number | undefined {
  return readInteger(
    petSizeInput?.value,
    PET_WINDOW_SIZE_MIN,
    PET_WINDOW_SIZE_MAX,
  );
}

function renderPetSizeValue(sizePx: number): void {
  if (!petSizeValue) return;
  const label = sizePx <= 200 ? "Small" : sizePx < 360 ? "Medium" : "Large";
  petSizeValue.textContent = `${label} · ${sizePx} px`;
}

function setPetSizeStatus(
  message: string,
  state: "idle" | "saved" | "saving" | "error",
): void {
  if (!petSizeStatus) return;
  petSizeStatus.textContent = message;
  petSizeStatus.dataset.saveState = state;
}

function schedulePetSizeSave(): void {
  if (!sessionApi) {
    pendingPetSize = undefined;
    setPetSizeStatus("Browser preview", "idle");
    return;
  }
  if (petSizeSaveTimer !== undefined) {
    window.clearTimeout(petSizeSaveTimer);
    petSizeSaveTimer = undefined;
  }

  const sizePx = readPetSize();
  if (sizePx === undefined) {
    pendingPetSize = undefined;
    petSizeSaveGeneration += 1;
    setPetSizeStatus("Choose a valid size", "error");
    return;
  }
  if (sizePx === lastSavedPetSize && pendingPetSize === undefined) {
    setPetSizeStatus("Saved locally", "saved");
    return;
  }

  pendingPetSize = sizePx;
  const generation = ++petSizeSaveGeneration;
  setPetSizeStatus("Adjusting…", "saving");
  petSizeSaveTimer = window.setTimeout(() => {
    petSizeSaveTimer = undefined;
    const pendingSize = pendingPetSize;
    pendingPetSize = undefined;
    if (pendingSize === undefined) return;
    void persistPetSize(pendingSize, generation);
  }, 140);
}

async function persistPetSize(
  sizePx: number,
  generation: number,
): Promise<void> {
  if (!sessionApi) return;

  const operation = petSizeSaveQueue.then(() =>
    sessionApi.setPetWindowSize(sizePx),
  );
  petSizeSaveQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  try {
    const saved = await operation;
    lastSavedPetSize = saved.sizePx;
    if (generation !== petSizeSaveGeneration) return;
    if (petSizeInput) petSizeInput.value = String(saved.sizePx);
    renderPetSizeValue(saved.sizePx);
    setPetSizeStatus("Saved locally", "saved");
  } catch (error: unknown) {
    if (generation !== petSizeSaveGeneration) return;
    setPetSizeStatus("Couldn’t save locally", "error");
    showError(errorMessage(error, "Pet size could not be saved."));
  }
}

async function flushPendingPetSize(): Promise<void> {
  if (petSizeSaveTimer !== undefined) {
    window.clearTimeout(petSizeSaveTimer);
    petSizeSaveTimer = undefined;
  }

  const sizePx = pendingPetSize;
  pendingPetSize = undefined;
  if (sizePx !== undefined && sizePx !== lastSavedPetSize) {
    await persistPetSize(sizePx, petSizeSaveGeneration);
  }
  await petSizeSaveQueue;
}

async function quitApp(): Promise<void> {
  await flushPendingPreferences();
  await sessionApi?.requestWindowAction("quit");
}

async function flushPendingPreferences(): Promise<void> {
  if (sessionApi && preferencesReady && !actionInFlight) {
    const hasPendingSave =
      saveTimer !== undefined ||
      pendingPreferences !== undefined ||
      inFlightSave !== undefined;
    if (hasPendingSave) {
      const draft = readSessionPreferences();
      if (draft.ok) await savePreferencesBeforeStart(draft.preferences);
    }
  }
  await flushPendingPetSize();
}

function isConfigurationLocked(): boolean {
  return (
    currentSnapshot !== undefined && !currentSnapshot.capabilities.canStart
  );
}

function setActionInFlight(
  button: HTMLButtonElement | null,
  label: string,
): void {
  actionInFlight = true;
  if (button) {
    button.disabled = true;
    button.textContent = label;
    button.setAttribute("aria-busy", "true");
  }
  setConfigurationEnabled(false);
  if (startButton) startButton.disabled = true;
  if (stopButton && button !== stopButton) stopButton.disabled = true;
}

function clearActionInFlight(
  button: HTMLButtonElement | null,
  label: string,
): void {
  if (button) {
    button.textContent = label;
    button.removeAttribute("aria-busy");
  }
  actionInFlight = false;
  if (currentSnapshot) {
    applySnapshot(currentSnapshot);
  } else {
    renderIdlePreview();
  }
}

function readPreviewDurationMs(): number {
  const durationMinutes = readInteger(durationInput?.value, 1, 480) ?? 25;
  return durationMinutes * 60_000;
}

function renderIntensityHelp(): void {
  if (!intensityHelp) return;
  intensityHelp.textContent =
    readIntensity(intensitySelect?.value) === "strict"
      ? "The pet grows more insistent and asks macOS to bring your focus app forward once."
      : "The pet uses stronger visual reminders as you stay away; it never changes apps.";
}

function readIntensity(
  value: string | undefined,
): "balanced" | "strict" | undefined {
  if (value === "strict") return "strict";
  if (value === "balanced" || value === "gentle") return "balanced";
  return undefined;
}

function isFallbackTask(snapshot: SessionSnapshot): boolean {
  return (
    snapshot.task?.trim() ===
    (snapshot.targetApplication
      ? fallbackTaskForTarget(snapshot.targetApplication)
      : "")
  );
}

function readInteger(
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : undefined;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function isApplication(value: unknown): value is ApplicationSummary {
  if (typeof value !== "object" || value === null) return false;
  const application = value as Record<string, unknown>;
  return (
    typeof application.bundleId === "string" &&
    application.bundleId.trim().length > 0 &&
    typeof application.name === "string" &&
    application.name.trim().length > 0
  );
}

function showError(message: string): void {
  if (formError) formError.textContent = message;
}

function clearError(): void {
  if (formError) formError.textContent = "";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

window.addEventListener("beforeunload", () => {
  clearSaveTimer();
  if (petSizeSaveTimer !== undefined) {
    window.clearTimeout(petSizeSaveTimer);
    petSizeSaveTimer = undefined;
  }
  unsubscribeFromSession?.();
  unsubscribeFromPreferencesFlush?.();
  unsubscribeFromUpdateStatus?.();
  stopFocusDisplayTimer();
});
