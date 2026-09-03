import idleForwardStretchUrl from "./assets/shokupan-cat/idle-actions/idle-05-forward-stretch.png";
import idleCloseUrl from "./assets/shokupan-cat/idle-loop/loop-08-close.png";
import idleEarTwitchUrl from "./assets/shokupan-cat/idle-loop/loop-06-ear-twitch.png";
import idleEarTurnUrl from "./assets/shokupan-cat/idle-loop/loop-05-ear-turn.png";
import idleExhaleStartUrl from "./assets/shokupan-cat/idle-loop/loop-04-exhale-start.png";
import idleInhalePeakUrl from "./assets/shokupan-cat/idle-loop/loop-03-inhale-peak.png";
import idleInhaleStartUrl from "./assets/shokupan-cat/idle-loop/loop-02-inhale-start.png";
import idleNeutralUrl from "./assets/shokupan-cat/idle-loop/loop-01-neutral.png";
import idleSettleUrl from "./assets/shokupan-cat/idle-loop/loop-07-settle.png";
import graceGlanceUrl from "./assets/shokupan-cat/reactions/reaction-01-grace-glance.png";
import interventionWaitUrl from "./assets/shokupan-cat/reactions/reaction-06-polite-wait.png";
import nudgeStareUrl from "./assets/shokupan-cat/reactions/reaction-03-half-lens-stare.png";

import type { SessionPhase } from "../shared/ipc";
import { startPetAnimation } from "./pet-animation";
import {
  canPlayPetHoverAction,
  choosePetHoverAction,
  getPetPresentation,
  PET_ASSET_PATHS,
  type PetAssetPath,
  type PetHoverAction,
} from "./pet-presentation";
import "./pet.css";

const sessionApi = window.focusFamiliar;

const petShell = document.querySelector<HTMLElement>(".pet-shell");
const petAvatar = document.querySelector<HTMLElement>("#pet-avatar");
const petImage = document.querySelector<HTMLImageElement>("#pet-image");
const petHint = document.querySelector<HTMLElement>("#pet-hint");
const settingsButton =
  document.querySelector<HTMLButtonElement>("#open-settings");
const reducedMotionQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

const petAssetUrls: Record<PetAssetPath, string> = {
  [PET_ASSET_PATHS.idleNeutral]: idleNeutralUrl,
  [PET_ASSET_PATHS.idleInhaleStart]: idleInhaleStartUrl,
  [PET_ASSET_PATHS.idleInhalePeak]: idleInhalePeakUrl,
  [PET_ASSET_PATHS.idleExhaleStart]: idleExhaleStartUrl,
  [PET_ASSET_PATHS.idleEarTurn]: idleEarTurnUrl,
  [PET_ASSET_PATHS.idleEarTwitch]: idleEarTwitchUrl,
  [PET_ASSET_PATHS.idleSettle]: idleSettleUrl,
  [PET_ASSET_PATHS.idleClose]: idleCloseUrl,
  [PET_ASSET_PATHS.graceGlance]: graceGlanceUrl,
  [PET_ASSET_PATHS.nudgeStare]: nudgeStareUrl,
  [PET_ASSET_PATHS.interventionWait]: interventionWaitUrl,
  [PET_ASSET_PATHS.forwardStretch]: idleForwardStretchUrl,
};

// Decode the local hover frames before the first reaction so a cold image load
// cannot leave a blank frame in a one-second action.
const hoverAssetsReady = Promise.allSettled(
  [
    PET_ASSET_PATHS.idleNeutral,
    PET_ASSET_PATHS.idleEarTurn,
    PET_ASSET_PATHS.idleEarTwitch,
    PET_ASSET_PATHS.idleSettle,
    PET_ASSET_PATHS.idleClose,
  ].map(async (asset) => {
    const preload = new Image();
    preload.decoding = "async";
    preload.src = petAssetUrls[asset];
    await preload.decode();
  }),
);

let currentPhase: SessionPhase | undefined;
let currentReducedMotion: boolean | undefined;
let stopAnimation: (() => void) | undefined;
let currentHoverAction: PetHoverAction | undefined;
let previousHoverActionId: PetHoverAction["id"] | undefined;
let pointerInsideAvatar = false;

function showPetAsset(asset: PetAssetPath): void {
  if (petImage) petImage.src = petAssetUrls[asset];
}

function renderCurrentPhasePresentation(): void {
  const phase = currentPhase ?? "idle";
  const reducedMotion = currentReducedMotion ?? reducedMotionQuery.matches;
  const presentation = getPetPresentation(phase, reducedMotion);

  if (petShell) {
    petShell.dataset.petPhase = phase;
    petShell.dataset.petMotion = presentation.mode;
    petShell.dataset.reducedMotion = String(reducedMotion);
    delete petShell.dataset.petAction;
  }
  if (petHint) petHint.textContent = presentation.statusText;

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
  // Runtime snapshots may update counters without changing presentation.
  // Preserve the current animation position when the visual inputs are equal.
  if (phase === currentPhase && reducedMotion === currentReducedMotion) return;

  currentPhase = phase;
  currentReducedMotion = reducedMotion;
  renderCurrentPhasePresentation();
}

function stopPetAnimation(): void {
  stopAnimation?.();
  stopAnimation = undefined;
}

async function playRandomHoverAction(): Promise<void> {
  await hoverAssetsReady;
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
      renderCurrentPhasePresentation();
    },
  });
}

settingsButton?.addEventListener("click", () => {
  void window.focusFamiliar.requestWindowAction("show-settings");
});

petAvatar?.addEventListener("mouseenter", () => {
  pointerInsideAvatar = true;
  void playRandomHoverAction();
});
petAvatar?.addEventListener("mouseleave", () => {
  pointerInsideAvatar = false;
});

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
  unsubscribeFromSession = sessionApi.onSessionChanged(({ phase }) => {
    renderPetPhase(phase);
  });
  void sessionApi
    .getSessionSnapshot()
    .then(({ phase }) => renderPetPhase(phase))
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
});
