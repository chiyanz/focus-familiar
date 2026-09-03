# 004: Floating pet overlay

Status: **In progress**

## Outcome

A small transparent pet window remains visually present without disrupting normal work and reflects focus-engine state.

## Scope

- Create a frameless, transparent, always-on-top pet window.
- Allow dragging and remember the position.
- Render local Shokupan-cat stills and a calm focused-state animation for core
  focus states.
- Support click-through behavior when appropriate.
- Respect reduced motion.
- Handle display changes, Spaces, full-screen applications, and visible screen bounds.

## Non-goals

- Final art direction
- Community pet packs
- Complex physics or mouse stealing

## Acceptance criteria

- The pet has no rectangular background or standard window chrome.
- Animation remains smooth during ordinary development work.
- The overlay does not steal keyboard focus during passive states.
- The pet remains reachable after display arrangement or resolution changes.
- Reduced motion replaces looping movement with a calm still or minimal transition.

## Planned tests

- Renderer state tests.
- Window configuration tests.
- Manual multi-display, Spaces, and full-screen checks.

## Implementation notes

The asset-driven renderer prototype is implemented. It bundles the approved
Shokupan-cat runtime frames locally, maps every `SessionPhase` exhaustively to
an accessible presentation, and gives both the ready and focused states a
low-arousal sleeping loop: two slow breaths, an occasional ear twitch, and a
settle. The data-driven timeline uses per-frame timing instead of a fixed-rate
slideshow so future pet packs can replace the cadence cleanly. Reduced motion
collapses the loop to one still frame and does not schedule a timer. The pet
remains a button that opens settings and subscribes to a sanitized live session
projection from the main process. The projection contains only the focus
contract, phase, counters, and available controls; current non-target
application details remain inside the privileged runtime. Automated tests cover
every phase mapping, timeline timing and cancellation, and bundled asset path;
the Electron startup smoke test verifies that the pet follows a live session
through stop.

Still pending before this feature can be implemented or verified: persisting
drag position, recovering the pet after display changes, manual
multi-display/Spaces/full-screen checks on a supported Mac, and final production
sprite cleanup. The normal settings window provides keyboard-accessible pause,
stop, and quit paths once opened from the pet; a native application-menu route
remains pending. Intervention and
completion art are explicitly provisional.
