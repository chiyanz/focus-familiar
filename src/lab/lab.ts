import idleForwardStretchUrl from "../renderer/assets/shokupan-cat/idle-actions/idle-05-forward-stretch.png";
import idlePawGroomUrl from "../renderer/assets/shokupan-cat/idle-actions/idle-06-paw-groom.png";
import idleExhaleStartUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-04-exhale-start.png";
import idleInhalePeakUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-03-inhale-peak.png";
import idleInhaleStartUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-02-inhale-start.png";
import idleNeutralUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-01-neutral.png";
import graceGlanceUrl from "../renderer/assets/shokupan-cat/reactions/reaction-01-grace-glance.png";
import finalEyeUrl from "../renderer/assets/shokupan-cat/reactions/reaction-03-half-lens-stare.png";
import interventionWaitUrl from "../renderer/assets/shokupan-cat/reactions/reaction-06-polite-wait.png";
import nudgePawTapUrl from "../renderer/assets/shokupan-cat/reactions/reaction-05-paw-tap.png";

import { SESSION_PHASES, type SessionPhase } from "../core";
import { startPetAnimation } from "../renderer/pet-animation";
import {
  canPlayPetHoverAction,
  choosePetHoverAction,
  getPetPresentation,
  getPetSnapshotPresentation,
  getPetSnapshotStatus,
  PET_ASSET_PATHS,
  PET_FINAL_EYE_AFTER_MS,
  type PetAssetPath,
  type PetHoverAction,
} from "../renderer/pet-presentation";
import type { SessionSnapshot } from "../shared/ipc";

import "./lab.css";

const DEMO_INTERVAL_MS = 1_800;
const phaseSet = new Set<string>(SESSION_PHASES);

const PHASE_LABELS: Readonly<
  Record<SessionPhase, { readonly title: string; readonly short: string }>
> = {
  idle: { title: "Ready to focus", short: "Ready" },
  focused: { title: "Focused with you", short: "Focused" },
  grace: { title: "A gentle reminder", short: "Gentle glance" },
  nudge: { title: "A small nudge", short: "Small nudge" },
  intervention: { title: "Time to return", short: "Return" },
  paused: { title: "Focus session paused", short: "Paused" },
  completed: { title: "Focus session complete", short: "Complete" },
  stopped: { title: "Session stopped", short: "Stopped" },
};

/**
 * Keep this map local to the lab so Vite resolves the same checked-in PNGs as
 * the Electron renderer. The presentation module remains the source of truth
 * for which asset belongs to each phase.
 */
const petAssetUrls: Readonly<Record<PetAssetPath, string>> = {
  [PET_ASSET_PATHS.idleNeutral]: idleNeutralUrl,
  [PET_ASSET_PATHS.idleInhaleStart]: idleInhaleStartUrl,
  [PET_ASSET_PATHS.idleInhalePeak]: idleInhalePeakUrl,
  [PET_ASSET_PATHS.idleExhaleStart]: idleExhaleStartUrl,
  [PET_ASSET_PATHS.graceGlance]: graceGlanceUrl,
  [PET_ASSET_PATHS.finalEye]: finalEyeUrl,
  [PET_ASSET_PATHS.nudgePawTap]: nudgePawTapUrl,
  [PET_ASSET_PATHS.interventionWait]: interventionWaitUrl,
  [PET_ASSET_PATHS.forwardStretch]: idleForwardStretchUrl,
  [PET_ASSET_PATHS.pawGroom]: idlePawGroomUrl,
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Lab element not found: ${selector}`);
  return element;
}

const stage = requireElement<HTMLElement>("#pet-stage");
const image = requireElement<HTMLImageElement>("#pet-image");
const phaseBadge = requireElement<HTMLElement>("#phase-badge");
const phaseName = requireElement<HTMLElement>("#phase-name");
const modeSummary = requireElement<HTMLElement>("#mode-summary");
const statusMessage = requireElement<HTMLElement>("#status-message");
const phaseButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-phase]"),
);
const reduceMotionInput = requireElement<HTMLInputElement>("#reduce-motion");
const darkCanvasInput = requireElement<HTMLInputElement>("#dark-canvas");
const autoDemoInput = requireElement<HTMLInputElement>("#auto-demo");
const finalEyeInput = requireElement<HTMLInputElement>("#final-eye");

const FINAL_EYE_PREVIEW = {
  schemaVersion: 1,
  sessionId: "presentation-lab",
  phase: "intervention",
  task: "Preview",
  targetApplication: { bundleId: "com.example.Editor", name: "Editor" },
  durationMs: 60_000,
  gracePeriodMs: 1_000,
  interventionAfterMs: 5_000,
  intensity: "balanced",
  focusedMs: 0,
  awayMs: 5_000 + PET_FINAL_EYE_AFTER_MS,
  currentAwayMs: 5_000 + PET_FINAL_EYE_AFTER_MS,
  capabilities: {
    canStart: false,
    canPause: true,
    canResume: false,
    canStop: true,
  },
} as const satisfies SessionSnapshot;

let currentPhase: SessionPhase = "idle";
let stopAnimation: (() => void) | undefined;
let currentHoverAction: PetHoverAction | undefined;
let previousHoverActionId: PetHoverAction["id"] | undefined;
let demoTimer: number | undefined;
let demoIndex = 0;

function isSessionPhase(value: string): value is SessionPhase {
  return phaseSet.has(value);
}

function stopPetAnimation(): void {
  stopAnimation?.();
  stopAnimation = undefined;
}

function stopDemoTimer(): void {
  if (demoTimer === undefined) return;
  window.clearInterval(demoTimer);
  demoTimer = undefined;
}

function renderPhase(phase: SessionPhase): void {
  currentPhase = phase;
  demoIndex = Math.max(0, SESSION_PHASES.indexOf(phase));

  const reducedMotion = reduceMotionInput.checked;
  const showFinalEye = phase === "intervention" && finalEyeInput.checked;
  const presentation = showFinalEye
    ? getPetSnapshotPresentation(FINAL_EYE_PREVIEW, reducedMotion)
    : getPetPresentation(phase, reducedMotion);
  const presentationStage = showFinalEye
    ? getPetSnapshotStatus(FINAL_EYE_PREVIEW).presentationStage
    : "base";
  const labels = PHASE_LABELS[phase];

  document.documentElement.dataset.reducedMotion = String(reducedMotion);
  stage.dataset.phase = phase;
  stage.dataset.motion = presentation.mode;
  stage.dataset.presentationStage = presentationStage;
  delete stage.dataset.action;
  stage.setAttribute("aria-label", `${labels.title} pet presentation`);
  phaseBadge.dataset.phase = phase;
  phaseBadge.textContent = labels.short;
  phaseName.textContent = labels.title;
  statusMessage.textContent = presentation.statusText;
  image.alt = `Shokupan cat: ${labels.title.toLocaleLowerCase()}`;

  if (showFinalEye) {
    modeSummary.textContent = "Final dramatic eye · 7s before strict return";
  } else if (presentation.mode === "ambient") {
    modeSummary.textContent = "Four-frame sleeping breath · 3.5s";
  } else if (
    presentation.reducedMotion &&
    PET_PRESENTATION_HAS_AMBIENT_MOTION[phase]
  ) {
    modeSummary.textContent = "Still frame · reduced motion";
  } else {
    modeSummary.textContent = "Still frame";
  }

  for (const button of phaseButtons) {
    const buttonPhase = button.dataset.phase;
    button.setAttribute("aria-pressed", String(buttonPhase === phase));
  }
  finalEyeInput.disabled = phase !== "intervention";

  stopPetAnimation();
  currentHoverAction = undefined;
  stopAnimation = startPetAnimation(
    presentation.timeline,
    (asset) => {
      image.src = petAssetUrls[asset];
    },
    window,
  );
}

function playRandomHoverAction(): void {
  const reducedMotion = reduceMotionInput.checked;
  if (
    currentHoverAction ||
    !canPlayPetHoverAction(currentPhase, reducedMotion)
  ) {
    return;
  }

  const action = choosePetHoverAction(Math.random(), previousHoverActionId);
  currentHoverAction = action;
  previousHoverActionId = action.id;
  stage.dataset.motion = "hover-action";
  stage.dataset.action = action.id;
  stopPetAnimation();
  stopAnimation = startPetAnimation(
    action.timeline,
    (asset) => {
      image.src = petAssetUrls[asset];
    },
    window,
    {
      loop: false,
      onComplete: () => {
        if (currentHoverAction === action) renderPhase(currentPhase);
      },
    },
  );
}

/** Whether a phase moves in the full-motion presentation. */
const PET_PRESENTATION_HAS_AMBIENT_MOTION: Readonly<
  Record<SessionPhase, boolean>
> = {
  idle: true,
  focused: true,
  grace: false,
  nudge: false,
  intervention: false,
  paused: false,
  completed: false,
  stopped: false,
};

function startDemo(): void {
  stopDemoTimer();
  demoIndex = Math.max(0, SESSION_PHASES.indexOf(currentPhase));
  demoTimer = window.setInterval(() => {
    demoIndex = (demoIndex + 1) % SESSION_PHASES.length;
    const nextPhase = SESSION_PHASES[demoIndex];
    if (nextPhase) renderPhase(nextPhase);
  }, DEMO_INTERVAL_MS);
}

function selectPhase(phase: SessionPhase): void {
  renderPhase(phase);
  if (autoDemoInput.checked) startDemo();
}

for (const button of phaseButtons) {
  button.addEventListener("click", () => {
    const phase = button.dataset.phase;
    if (phase && isSessionPhase(phase)) selectPhase(phase);
  });
}

image.addEventListener("mouseenter", playRandomHoverAction);

reduceMotionInput.checked = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
reduceMotionInput.addEventListener("change", () => renderPhase(currentPhase));

darkCanvasInput.addEventListener("change", () => {
  stage.dataset.darkCanvas = String(darkCanvasInput.checked);
});

autoDemoInput.addEventListener("change", () => {
  if (autoDemoInput.checked) startDemo();
  else stopDemoTimer();
});

finalEyeInput.addEventListener("change", () => {
  renderPhase(currentPhase);
});

renderPhase("idle");

window.addEventListener("beforeunload", () => {
  stopPetAnimation();
  stopDemoTimer();
});
