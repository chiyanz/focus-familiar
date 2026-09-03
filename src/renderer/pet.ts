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
  getPetPresentation,
  PET_ASSET_PATHS,
  type PetAssetPath,
} from "./pet-presentation";
import "./pet.css";

const sessionApi = window.focusFamiliar;

const petShell = document.querySelector<HTMLElement>(".pet-shell");
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

let currentPhase: SessionPhase | undefined;
let currentReducedMotion: boolean | undefined;
let stopAnimation: (() => void) | undefined;

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
  const presentation = getPetPresentation(phase, reducedMotion);

  if (petShell) petShell.dataset.petPhase = phase;
  if (petShell) petShell.dataset.reducedMotion = String(reducedMotion);
  if (petHint) petHint.textContent = presentation.statusText;

  stopPetAnimation();

  if (petImage) {
    stopAnimation = startPetAnimation(
      presentation.timeline,
      (asset) => {
        petImage.src = petAssetUrls[asset];
      },
      window,
    );
  }
}

function stopPetAnimation(): void {
  stopAnimation?.();
  stopAnimation = undefined;
}

settingsButton?.addEventListener("click", () => {
  void window.focusFamiliar.requestWindowAction("show-settings");
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
      if (petHint) petHint.textContent = "Ready when you are.";
    });
} catch {
  // A renderer opened against an older development preload can still show
  // the idle pet; the settings action remains available for recovery.
}

window.addEventListener("beforeunload", () => {
  unsubscribeFromSession?.();
  stopPetAnimation();
});
