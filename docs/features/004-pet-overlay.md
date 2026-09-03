# 004: Floating pet overlay

Status: **In progress**

## Outcome

A small transparent pet window remains visually present without disrupting normal work and reflects focus-engine state.

## Scope

- Create a frameless, transparent, always-on-top pet window.
- Allow dragging the full avatar, remember its position, and offer a bounded
  size control.
- Render local Shokupan-cat stills and a calm focused-state animation for core
  focus states.
- Play a small random ambient reaction when the user hovers over the cat,
  without overriding focus nudges.
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
- The full avatar can be dragged without stealing keyboard focus, and size
  changes survive a relaunch.
- Reduced motion replaces looping movement with a calm still or minimal transition.
- Hover reactions play only in ready and focused states, and a focus-state
  change cancels them immediately.

## Planned tests

- Renderer state tests.
- Window configuration tests.
- Manual multi-display, Spaces, and full-screen checks.

## Implementation notes

The asset-driven renderer prototype is implemented. It bundles the approved
Shokupan-cat runtime frames locally, maps every `SessionPhase` exhaustively to
an accessible presentation, and gives both the ready and focused states a
low-arousal sleeping breath. The breath uses one stable, bottom-anchored sprite
with a subtle continuous transform, avoiding jumps between independently
generated keyframes. Hovering over the cat plays one of two short idle-only
reactions (an ear twitch or sleepy blink); the picker avoids an immediate
repeat, and any session phase change cancels the reaction before restoring the
authoritative presentation. Grace, nudge, intervention, and terminal art are
never used as hover actions. Reduced motion holds one still frame and suppresses
hover animation. The pet
avatar is the native drag surface; a separate status pill opens settings so
dragging does not compete with a click action. Its square window scales from
160 to 480 logical pixels through a settings slider. Size and display-aware
position are stored locally, resize around the current center, and clamp back
inside the selected display's work area on relaunch. The pet subscribes to a
sanitized live session projection from the main process. The projection contains only the focus
contract, phase, counters, and available controls; current non-target
application details remain inside the privileged runtime. Automated tests cover
every phase mapping, timeline timing and cancellation, and bundled asset path;
the Electron startup smoke test verifies that the pet follows a live session
through stop.

The Shokupan source poses and bundled runtime frames also have a reproducible
cocoa edge band. Four exterior pixels protect fractional scaling, while three
inset pixels replace the opaque pale antialias dashes present in the generated
source art. This removes the visible white halo on dark desktops without
flattening PNG transparency. Idle frames are translated to a shared center and
baseline without rescaling. The visual lab includes a dark-canvas toggle and
exercises the same hover actions as the app, while the macOS CI job validates
every source and runtime PNG with idempotent edge and alignment tools.

Automated coverage includes ambient and one-shot animation playback, injected
random hover selection, reduced-motion and phase guards, drag-region separation, bounded geometry,
off-screen recovery, settings validation, serialized position/size writes, and
the Electron resize path. Still pending before this feature can be verified:
manual multi-display, Spaces, and full-screen checks on a supported Mac, plus
final production sprite cleanup. The normal settings window provides keyboard-accessible pause,
stop, and quit paths once opened from the pet; a native application-menu route
remains pending. Intervention and
completion art are explicitly provisional.
