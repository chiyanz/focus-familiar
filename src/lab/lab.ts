import idleForwardStretchUrl from "../renderer/assets/shokupan-cat/idle-actions/idle-05-forward-stretch.png";
import idleCloseUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-08-close.png";
import idleEarTwitchUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-06-ear-twitch.png";
import idleEarTurnUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-05-ear-turn.png";
import idleExhaleStartUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-04-exhale-start.png";
import idleInhalePeakUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-03-inhale-peak.png";
import idleInhaleStartUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-02-inhale-start.png";
import idleNeutralUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-01-neutral.png";
import idleSettleUrl from "../renderer/assets/shokupan-cat/idle-loop/loop-07-settle.png";
import graceGlanceUrl from "../renderer/assets/shokupan-cat/reactions/reaction-01-grace-glance.png";
import interventionWaitUrl from "../renderer/assets/shokupan-cat/reactions/reaction-06-polite-wait.png";
import nudgeStareUrl from "../renderer/assets/shokupan-cat/reactions/reaction-03-half-lens-stare.png";

import { SESSION_PHASES, type SessionPhase } from "../core";
import { startPetAnimation } from "../renderer/pet-animation";
import {
  getPetPresentation,
  PET_ASSET_PATHS,
  type PetAssetPath,
} from "../renderer/pet-presentation";

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
  [PET_ASSET_PATHS.idleEarTurn]: idleEarTurnUrl,
  [PET_ASSET_PATHS.idleEarTwitch]: idleEarTwitchUrl,
  [PET_ASSET_PATHS.idleSettle]: idleSettleUrl,
  [PET_ASSET_PATHS.idleClose]: idleCloseUrl,
  [PET_ASSET_PATHS.graceGlance]: graceGlanceUrl,
  [PET_ASSET_PATHS.nudgeStare]: nudgeStareUrl,
  [PET_ASSET_PATHS.interventionWait]: interventionWaitUrl,
  [PET_ASSET_PATHS.forwardStretch]: idleForwardStretchUrl,
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

let currentPhase: SessionPhase = "idle";
let stopAnimation: (() => void) | undefined;
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
  const presentation = getPetPresentation(phase, reducedMotion);
  const labels = PHASE_LABELS[phase];

  document.documentElement.dataset.reducedMotion = String(reducedMotion);
  stage.dataset.phase = phase;
  stage.setAttribute("aria-label", `${labels.title} pet presentation`);
  phaseBadge.dataset.phase = phase;
  phaseBadge.textContent = labels.short;
  phaseName.textContent = labels.title;
  statusMessage.textContent = presentation.statusText;
  image.alt = `Shokupan cat: ${labels.title.toLocaleLowerCase()}`;

  if (presentation.mode === "loop") {
    const loopDurationMs = presentation.timeline.reduce(
      (total, step) => total + (step.durationMs ?? 0),
      0,
    );
    modeSummary.textContent = `${presentation.timeline.length}-step sleep loop · ${(loopDurationMs / 1_000).toFixed(1)}s`;
  } else if (presentation.reducedMotion && PET_PRESENTATION_HAS_LOOP[phase]) {
    modeSummary.textContent = "Still frame · reduced motion";
  } else {
    modeSummary.textContent = "Still frame";
  }

  for (const button of phaseButtons) {
    const buttonPhase = button.dataset.phase;
    button.setAttribute("aria-pressed", String(buttonPhase === phase));
  }

  stopPetAnimation();
  stopAnimation = startPetAnimation(
    presentation.timeline,
    (asset) => {
      image.src = petAssetUrls[asset];
    },
    window,
  );
}

/** Whether a phase has a loop in the full-motion presentation. */
const PET_PRESENTATION_HAS_LOOP: Readonly<Record<SessionPhase, boolean>> = {
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

renderPhase("idle");

window.addEventListener("beforeunload", () => {
  stopPetAnimation();
  stopDemoTimer();
});
