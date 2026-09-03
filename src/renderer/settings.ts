import type {
  ApplicationSummary,
  FocusFamiliarApi,
  SessionAction,
  SessionPhase,
  SessionSnapshot,
  SessionStartConfig,
} from "../shared/ipc";

import "./settings.css";

const sessionApi: FocusFamiliarApi | undefined = (window as Partial<Window>)
  .focusFamiliar;

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
let hasLoadedSession = false;
let focusDisplayTimer: number | undefined;
let focusDisplayStartedAtMs = 0;
let focusDisplayBaseMs = 0;
let focusDisplayDurationMs = 0;
let focusDisplaySessionId: string | null = null;

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
  void sessionApi?.requestWindowAction("quit");
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

let unsubscribeFromSession: (() => void) | undefined;
try {
  unsubscribeFromSession = sessionApi?.onSessionChanged((snapshot) => {
    applySnapshot(snapshot);
  });
} catch (error: unknown) {
  showError(errorMessage(error, "Live session updates are unavailable."));
}

void loadInitialState();

async function loadInitialState(): Promise<void> {
  await Promise.all([refreshApplications(), loadSessionSnapshot()]);
}

async function loadSessionSnapshot(): Promise<void> {
  if (!sessionApi) {
    hasLoadedSession = true;
    showError("Open this page from the Focus Familiar app to start a session.");
    renderIdlePreview();
    return;
  }
  try {
    const snapshot = await sessionApi.getSessionSnapshot();
    applySnapshot(snapshot);
  } catch (error: unknown) {
    hasLoadedSession = true;
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
    applications.clear();
    for (const application of runningApplications) {
      if (!isApplication(application)) continue;
      applications.set(application.bundleId, application);
    }
    renderApplicationOptions(previousSelection);
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

  setActionInFlight(startButton, "Starting…");
  try {
    const snapshot = await sessionApi.startSession(request.config);
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
  const task = taskInput?.value.trim() ?? "";
  if (task.length === 0) {
    return {
      ok: false,
      message: "Give this focus session a small task.",
      focus: taskInput,
    };
  }

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

  const intensity = intensitySelect?.value;
  if (
    intensity !== "gentle" &&
    intensity !== "balanced" &&
    intensity !== "strict"
  ) {
    return {
      ok: false,
      message: "Choose a valid reminder mood.",
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

function applySnapshot(snapshot: SessionSnapshot): void {
  currentSnapshot = snapshot;
  hasLoadedSession = true;

  if (snapshot.task !== null && snapshot.phase !== "idle" && taskInput) {
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
    intensitySelect.value = snapshot.intensity;
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
    statusDetail.textContent = hasLoadedSession
      ? "Focus sessions are unavailable on this platform."
      : "Pick a task and app, then start when you’re ready.";
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
      return "Pick a task and app, then start when you’re ready.";
    case "focused":
      return snapshot.task
        ? `Working on “${snapshot.task}” in ${targetName}.`
        : `Stay in ${targetName}; you’re doing well.`;
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
    control.disabled = !enabled || actionInFlight;
  }
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
  unsubscribeFromSession?.();
  stopFocusDisplayTimer();
});
