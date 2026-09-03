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
an accessible presentation, holds calm states on a neutral frame, and runs the
focused breathing loop at 600ms per frame. Reduced motion collapses the loop to
one still frame and does not schedule a timer. The pet remains a button that
opens settings, while the live session-state bridge is intentionally deferred.
Automated tests cover every phase mapping and bundled asset path, and the
Electron startup smoke test verifies that the initial pet image decodes.

Still pending before this feature can be implemented or verified: wiring live
session state into the renderer, persisting drag position, recovering the pet
after display changes, manual multi-display/Spaces/full-screen checks on a
supported Mac, a keyboard-accessible application-menu route to settings, and
final production sprite cleanup. Intervention and completion art are
explicitly provisional.
