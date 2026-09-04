import forwardStretchUrl from "./assets/shokupan-cat/idle-actions/idle-05-forward-stretch.png";
import pawGroomUrl from "./assets/shokupan-cat/idle-actions/idle-06-paw-groom.png";
import idleExhaleStartUrl from "./assets/shokupan-cat/idle-loop/loop-04-exhale-start.png";
import idleInhalePeakUrl from "./assets/shokupan-cat/idle-loop/loop-03-inhale-peak.png";
import idleInhaleStartUrl from "./assets/shokupan-cat/idle-loop/loop-02-inhale-start.png";
import idleNeutralUrl from "./assets/shokupan-cat/idle-loop/loop-01-neutral.png";
import graceGlanceUrl from "./assets/shokupan-cat/reactions/reaction-01-grace-glance.png";
import persistentStareUrl from "./assets/shokupan-cat/reactions/reaction-03-half-lens-stare.png";
import nudgePawTapUrl from "./assets/shokupan-cat/reactions/reaction-05-paw-tap.png";
import interventionWaitUrl from "./assets/shokupan-cat/reactions/reaction-06-polite-wait.png";

import type { SessionPhase, SessionSnapshot } from "../shared/ipc";
import { startPetAnimation } from "./pet-animation";
import {
  canPlayPetHoverAction,
  choosePetHoverAction,
  getPetPresentation,
  getPetSnapshotPresentation,
  getPetSnapshotStatus,
  PET_ASSET_PATHS,
  type PetAssetPath,
  type PetHoverAction,
} from "./pet-presentation";
import "./pet.css";

const sessionApi = window.focusFamiliar;

const petShell = document.querySelector<HTMLElement>(".pet-shell");
const petAvatar = document.querySelector<HTMLElement>("#pet-avatar");
const petVisual = document.querySelector<HTMLElement>("#pet-visual");
const petImage = document.querySelector<HTMLImageElement>("#pet-image");
const petHint = document.querySelector<HTMLElement>("#pet-hint");
const settingsButton =
  document.querySelector<HTMLButtonElement>("#open-settings");
const reducedMotionQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

const petAssetUrls: Readonly<Record<PetAssetPath, string>> = {
  [PET_ASSET_PATHS.idleNeutral]: idleNeutralUrl,
  [PET_ASSET_PATHS.idleInhaleStart]: idleInhaleStartUrl,
  [PET_ASSET_PATHS.idleInhalePeak]: idleInhalePeakUrl,
  [PET_ASSET_PATHS.idleExhaleStart]: idleExhaleStartUrl,
  [PET_ASSET_PATHS.graceGlance]: graceGlanceUrl,
  [PET_ASSET_PATHS.persistentStare]: persistentStareUrl,
  [PET_ASSET_PATHS.nudgePawTap]: nudgePawTapUrl,
  [PET_ASSET_PATHS.interventionWait]: interventionWaitUrl,
  [PET_ASSET_PATHS.forwardStretch]: forwardStretchUrl,
  [PET_ASSET_PATHS.pawGroom]: pawGroomUrl,
};

// Decode every local frame before a hover action so the first interaction and
// later focus-state swaps cannot briefly flash a blank image.
const petAssetsReady = Promise.allSettled(
  Object.keys(petAssetUrls).map(async (asset) => {
    const preload = new Image();
    preload.decoding = "async";
    preload.src = petAssetUrl(asset as PetAssetPath);
    await preload.decode();
  }),
);

let currentPhase: SessionPhase | undefined;
let currentReducedMotion: boolean | undefined;
let currentPresentationKey: string | undefined;
let stopAnimation: (() => void) | undefined;
let currentHoverAction: PetHoverAction | undefined;
let previousHoverActionId: PetHoverAction["id"] | undefined;
let pointerInsideAvatar = false;
let pointerInsideHint = false;
let forcedHintTimer: number | undefined;
let collapseHintTimer: number | undefined;
let currentSnapshot: SessionSnapshot | undefined;
let previousReminderBeat = -1;
let isDraggingPet = false;
let queuedDragPosition:
  | { readonly screenX: number; readonly screenY: number }
  | undefined;
let dragFrame: number | undefined;

function showPetAsset(asset: PetAssetPath): void {
  if (petShell) petShell.dataset.petAsset = asset;
  if (petImage) petImage.src = petAssetUrl(asset);
}

function petAssetUrl(asset: PetAssetPath): string {
  const url = petAssetUrls[asset];
  if (!url) throw new Error(`Pet asset is not bundled: ${asset}`);
  return url;
}

function renderCurrentPhasePresentation(force = false): void {
  const phase = currentPhase ?? "idle";
  const reducedMotion = currentReducedMotion ?? reducedMotionQuery.matches;
  const snapshot = currentSnapshot?.phase === phase ? currentSnapshot : null;
  const presentation = snapshot
    ? getPetSnapshotPresentation(snapshot, reducedMotion)
    : getPetPresentation(phase, reducedMotion);
  const status = snapshot ? getPetSnapshotStatus(snapshot) : null;
  const presentationKey = [
    phase,
    String(reducedMotion),
    status?.presentationStage ?? "base",
    ...presentation.timeline.map(
      ({ asset, durationMs }) => `${asset}:${String(durationMs)}`,
    ),
  ].join("|");

  if (petShell) {
    petShell.dataset.petPhase = phase;
    petShell.dataset.reducedMotion = String(reducedMotion);
    petShell.dataset.petStage = status?.presentationStage ?? "base";
    petShell.dataset.petAttention = String(status?.attentionLevel ?? 0);
  }
  if (petHint) {
    petHint.textContent = status?.statusText ?? presentation.statusText;
  }
  if (!force && presentationKey === currentPresentationKey) return;

  currentPresentationKey = presentationKey;
  if (petShell) {
    petShell.dataset.petMotion = presentation.mode;
    delete petShell.dataset.petAction;
  }

  currentHoverAction = undefined;
  stopPetAnimation();
  stopAnimation = startPetAnimation(
    presentation.timeline,
    showPetAsset,
    window,
  );
}

/**
 * Render a phase without knowing anything about foreground activity. The
 * main process remains the source of session truth; this function only maps a
 * phase to the already-bundled local art and accessible copy.
 */
export function renderPetPhase(
  phase: SessionPhase,
  reducedMotion = reducedMotionQuery.matches,
): void {
  currentPhase = phase;
  currentReducedMotion = reducedMotion;
  renderCurrentPhasePresentation();
}

function renderPetSnapshot(snapshot: SessionSnapshot): void {
  currentSnapshot = snapshot;
  renderPetPhase(snapshot.phase);
  const status = getPetSnapshotStatus(snapshot);

  const isFreshReminder =
    snapshot.phase === "intervention" &&
    status.reminderBeat !== previousReminderBeat;
  previousReminderBeat =
    snapshot.phase === "intervention" ? status.reminderBeat : -1;

  if (snapshot.phase === "nudge" || isFreshReminder) {
    revealHintTemporarily(snapshot.phase === "nudge" ? 3_000 : 4_500);
  }
  if (isFreshReminder && !reducedMotionQuery.matches) playAttentionPop();
}

function stopPetAnimation(): void {
  stopAnimation?.();
  stopAnimation = undefined;
}

async function playRandomHoverAction(): Promise<void> {
  await petAssetsReady;
  const phase = currentPhase ?? "idle";
  const reducedMotion = currentReducedMotion ?? reducedMotionQuery.matches;
  if (
    !pointerInsideAvatar ||
    currentHoverAction ||
    !canPlayPetHoverAction(phase, reducedMotion)
  ) {
    return;
  }

  const action = choosePetHoverAction(Math.random(), previousHoverActionId);
  currentHoverAction = action;
  previousHoverActionId = action.id;
  stopPetAnimation();

  if (petShell) {
    petShell.dataset.petMotion = "hover-action";
    petShell.dataset.petAction = action.id;
  }
  stopAnimation = startPetAnimation(action.timeline, showPetAsset, window, {
    loop: false,
    onComplete: () => {
      // A focus-state transition cancels this player, so completion can only
      // restore the still-current ambient phase.
      if (currentHoverAction !== action) return;
      renderCurrentPhasePresentation(true);
    },
  });
}

settingsButton?.addEventListener("click", () => {
  void window.focusFamiliar.requestWindowAction("show-settings");
});

petAvatar?.addEventListener("mouseenter", () => {
  pointerInsideAvatar = true;
  updateHintVisibility();
  void playRandomHoverAction();
});
petAvatar?.addEventListener("mouseleave", () => {
  pointerInsideAvatar = false;
  scheduleHintCollapse();
});

settingsButton?.addEventListener("mouseenter", () => {
  pointerInsideHint = true;
  updateHintVisibility();
});
settingsButton?.addEventListener("mouseleave", () => {
  pointerInsideHint = false;
  scheduleHintCollapse();
});

petAvatar?.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || isDraggingPet) return;
  event.preventDefault();
  isDraggingPet = true;
  petAvatar.dataset.dragging = "true";
  const position = petDragPosition(event);
  void sessionApi
    .dragPetWindow({
      phase: "start",
      ...position,
    })
    .catch(() => undefined);
});

window.addEventListener("mousemove", (event) => {
  if (!isDraggingPet) return;
  queuedDragPosition = petDragPosition(event);
  if (dragFrame !== undefined) return;
  dragFrame = window.requestAnimationFrame(() => {
    dragFrame = undefined;
    const position = queuedDragPosition;
    queuedDragPosition = undefined;
    if (!position || !isDraggingPet) return;
    void sessionApi
      .dragPetWindow({ phase: "move", ...position })
      .catch(() => undefined);
  });
});

function endPetDrag(event: MouseEvent): void {
  if (!isDraggingPet) return;
  const finalPosition = queuedDragPosition ?? {
    ...petDragPosition(event),
  };
  isDraggingPet = false;
  delete petAvatar?.dataset.dragging;
  if (dragFrame !== undefined) {
    window.cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  }
  queuedDragPosition = undefined;
  void sessionApi
    .dragPetWindow({ phase: "move", ...finalPosition })
    .then(() => sessionApi.dragPetWindow({ phase: "end", ...finalPosition }))
    .catch(() => undefined);
}

window.addEventListener("mouseup", endPetDrag);

function petDragPosition(event: MouseEvent): {
  readonly screenX: number;
  readonly screenY: number;
} {
  // Chromium's screen coordinates are not populated for every injected or
  // accessibility input source. Window origin + client coordinates is the
  // same logical screen-space value and works consistently on macOS.
  return {
    screenX: Math.round(window.screenX + event.clientX),
    screenY: Math.round(window.screenY + event.clientY),
  };
}

reducedMotionQuery.addEventListener("change", () => {
  renderPetPhase(currentPhase ?? "idle", reducedMotionQuery.matches);
});

renderPetPhase("idle");

/**
 * The pet is a read-only presentation of the sanitized session projection.
 * It never observes the active application itself and never receives the
 * current distraction identity.
 */
let unsubscribeFromSession: (() => void) | undefined;
try {
  unsubscribeFromSession = sessionApi.onSessionChanged((snapshot) => {
    renderPetSnapshot(snapshot);
  });
  void sessionApi
    .getSessionSnapshot()
    .then(renderPetSnapshot)
    .catch(() => {
      if (petHint) petHint.textContent = "Ready when you are";
    });
} catch {
  // A renderer opened against an older development preload can still show
  // the idle pet; the settings action remains available for recovery.
}

let unsubscribeFromUpdateStatus: (() => void) | undefined;
try {
  const renderUpdateAvailability = (available: boolean): void => {
    if (!settingsButton) return;
    settingsButton.dataset.updateAvailable = String(available);
    settingsButton.title = available
      ? "Update available — open settings"
      : "Open settings";
    settingsButton.setAttribute(
      "aria-label",
      available
        ? "Update available. Open Focus Familiar settings"
        : "Open Focus Familiar settings",
    );
  };
  unsubscribeFromUpdateStatus = sessionApi.onUpdateStatusChanged((status) => {
    renderUpdateAvailability(status.phase === "available");
  });
  void sessionApi
    .getUpdateStatus()
    .then((status) => renderUpdateAvailability(status.phase === "available"))
    .catch(() => undefined);
} catch {
  // An older development preload can still show and control the pet.
}

window.addEventListener("beforeunload", () => {
  unsubscribeFromSession?.();
  unsubscribeFromUpdateStatus?.();
  stopPetAnimation();
  if (forcedHintTimer !== undefined) window.clearTimeout(forcedHintTimer);
  if (collapseHintTimer !== undefined) window.clearTimeout(collapseHintTimer);
  if (dragFrame !== undefined) window.cancelAnimationFrame(dragFrame);
});

function revealHintTemporarily(durationMs: number): void {
  if (forcedHintTimer !== undefined) window.clearTimeout(forcedHintTimer);
  if (collapseHintTimer !== undefined) window.clearTimeout(collapseHintTimer);
  if (petShell) petShell.dataset.hintVisible = "true";
  forcedHintTimer = window.setTimeout(() => {
    forcedHintTimer = undefined;
    updateHintVisibility();
  }, durationMs);
}

function scheduleHintCollapse(): void {
  if (collapseHintTimer !== undefined) window.clearTimeout(collapseHintTimer);
  collapseHintTimer = window.setTimeout(() => {
    collapseHintTimer = undefined;
    updateHintVisibility();
  }, 180);
}

function updateHintVisibility(): void {
  if (collapseHintTimer !== undefined) {
    window.clearTimeout(collapseHintTimer);
    collapseHintTimer = undefined;
  }
  if (!petShell) return;
  petShell.dataset.hintVisible = String(
    pointerInsideAvatar || pointerInsideHint || forcedHintTimer !== undefined,
  );
}

function playAttentionPop(): void {
  if (!petVisual) return;
  petVisual.classList.remove("attention-pop");
  void petVisual.offsetWidth;
  petVisual.classList.add("attention-pop");
  window.setTimeout(() => petVisual.classList.remove("attention-pop"), 700);
}
