# 004: Floating pet overlay

Status: **Planned**

## Outcome

A small transparent pet window remains visually present without disrupting normal work and reflects focus-engine state.

## Scope

- Create a frameless, transparent, always-on-top pet window.
- Allow dragging and remember the position.
- Render placeholder animations for core focus states.
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

Not implemented.
