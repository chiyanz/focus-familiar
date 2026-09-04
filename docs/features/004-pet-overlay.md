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
- Ready and focused use the four-frame sleeping-breath loop; away phases must
  never fall back to an idle-loop frame.
- Grace, nudge, and intervention each use a distinct full-body reaction pose.
- Every runtime pose shares the same center and floor anchor so state changes
  read as pose changes rather than window jumps.
- A persistent intervention adds the close-up side-eye after 30 seconds; it is
  an intentional composition change, not a replacement for earlier poses.

## Presentation behavior contract

This table is the source of truth for the default Shokupan pet pack. Changes to
it require matching presentation tests and a visual-lab spot check.

| Trigger or phase                                | Required visual                                                        | Motion and text behavior                                                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready (`idle`)                                  | `loop-01` → `loop-02` → `loop-03` → `loop-04`                          | Loop the four bottom-anchored sleeping-breath frames. Text stays collapsed until hover.                                                                       |
| In target app (`focused`)                       | Same four-frame sleeping-breath loop                                   | Continue calm looping; returning from an away phase restarts the loop.                                                                                        |
| Left target, before grace threshold (`grace`)   | `reaction-01-grace-glance`                                             | Hold the one-eye-open loaf. Do not play a hover action.                                                                                                       |
| Grace threshold reached (`nudge`)               | `reaction-05-paw-tap`                                                  | Hold the reaching-paw pose and reveal “Let’s head back” briefly.                                                                                              |
| Intervention threshold reached (`intervention`) | `reaction-06-polite-wait`                                              | Hold the upright waiting pose. Increase the wrapper scale and briefly reveal rotating return copy every 15 seconds; never take focus or activate another app. |
| Still away 30 seconds after intervention        | `reaction-03-half-lens-stare`                                          | Slide in the close-up side-eye as the final presentation stage. Keep the core phase as `intervention` and continue the 15-second reminders.                   |
| Paused (`paused`)                               | `loop-01-neutral`                                                      | Hold neutral with no ambient or hover animation.                                                                                                              |
| Completed (`completed`)                         | `idle-05-forward-stretch`                                              | Hold the stretch as a quiet completion pose.                                                                                                                  |
| Stopped (`stopped`)                             | `loop-01-neutral`                                                      | Hold neutral with no ambient or hover animation.                                                                                                              |
| Pointer enters during ready/focused             | Random `idle-05-forward-stretch` or `idle-06-paw-groom`                | Play one obvious one-shot pose, avoid an immediate repeat, then resume the authoritative breathing loop.                                                      |
| Reduced motion enabled                          | Neutral still for ready/focused; phase-specific still for other phases | Do not loop, wiggle, pop, or play hover actions.                                                                                                              |

Presentation priority is deterministic: a focus-phase change cancels any hover
action immediately, then displays the phase pose. Hover can never replace
grace, nudge, intervention, pause, completion, or stop feedback.

All default runtime PNGs use a transparent 384×512 canvas. Full-body visible
silhouettes must be centered at x=192 ± 1 pixel, rest on y=460 ± 1 pixel, and
remain within a 240–360 pixel width and 240–410 pixel height envelope. The
alignment command checks these invariants. The final half-lens stare is the
documented exception: it deliberately touches the left canvas edge as a
close-up, while the edge validator still protects its transparent background
and cocoa outline.

## Planned tests

- Renderer state tests.
- Window configuration tests.
- Manual multi-display, Spaces, and full-screen checks.

## Implementation notes

The asset-driven renderer prototype is implemented. It bundles the approved
Shokupan-cat runtime frames locally, maps every `SessionPhase` exhaustively to
an accessible presentation, and gives both the ready and focused states a
four-frame, low-arousal sleeping breath. Grace, nudge, and intervention use
distinct one-eye glance, paw-tap, and upright-wait poses. Hovering over the
cat plays one of two unmistakable idle-only poses (a forward stretch or paw groom).
After 30 seconds of continued intervention, the close-up half-lens stare
becomes the final presentation stage without adding a second policy phase;
the picker avoids an immediate repeat, and any session phase change cancels the
reaction before restoring the authoritative presentation. Reduced motion holds
one still frame and suppresses hover animation.

Electron native drag regions suppress the pointer events required for hover,
so the avatar now uses a typed, validated renderer-to-main drag bridge. The
main process accepts coordinates only from the trusted pet renderer, moves only
that BrowserWindow, and clamps the result to a display work area. The pet stays
non-focusable. A separate collapsed status pill opens settings; its text appears
on avatar or pill hover and briefly expands for active reminders. Its square window scales from
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
flattening PNG transparency. Idle, reaction, completion, and hover frames are
translated to a shared center and baseline without rescaling. The visual lab
includes a dark-canvas toggle and exercises the same phase mappings and hover
actions as the app, while the macOS CI job validates every source and runtime
PNG with idempotent edge and alignment tools.

Automated coverage includes the exact state-to-sprite table, all four ambient
frames, obvious one-shot hover assets, injected random hover selection,
reduced-motion and phase guards, the validated manual-drag boundary, bounded geometry,
off-screen recovery, settings validation, serialized position/size writes, and
the Electron resize path. The Electron smoke test also walks a deliberately
away session through grace, nudge, and intervention and checks the logical
runtime asset displayed at each phase. Still pending before this feature can be verified:
manual multi-display, Spaces, and full-screen checks on a supported Mac, plus
final production sprite cleanup. The normal settings window provides keyboard-accessible pause,
stop, and quit paths once opened from the pet; a native application-menu route
remains pending.
