# 006: Settings and local persistence

Status: **In progress**

## Outcome

Users can configure sessions and pet behavior, and the app restores safe preferences after relaunch without collecting unnecessary activity history.

## Scope

- Optional focus note, duration, target application, away behavior, and timing
  controls.
- Pet position, reduced-motion override, sound, and launch behavior.
- Versioned settings schema and migrations.
- Safe recovery of an interrupted active session.
- Clear privacy and observed-data explanation.
- Reset and delete-local-data actions.

## Non-goals

- Accounts or synchronization
- Detailed application-usage history
- Analytics or crash-upload services

## Acceptance criteria

- Valid settings survive a normal restart.
- Invalid or older data migrates or falls back without crashing.
- Reset removes product data documented as removable.
- Users can see what information is stored.
- Active-session recovery never resumes strict intervention unexpectedly.

## Planned tests

- Schema validation and migration tests.
- Corrupt-data recovery tests.
- Session recovery safety tests.

## Implementation notes

The nonvisual persistence foundation is in progress. It defines a versioned, runtime-validated local schema with documented defaults and migration behavior, plus an atomic JSON store under the app's per-user data directory.

Recovery intentionally excludes raw foreground-application events and the current non-target application. It retains only the focus contract, accumulated focus/away totals, session identity, and save time, and it always restores as paused so relaunch cannot trigger strict intervention.

The first functional settings form now lists running macOS applications and
starts validated sessions with task, duration, target app, intensity, grace,
and intervention timing controls. It shows live progress and state, exposes
pause/resume/stop plus a visible quit path, and explains the exact local-only
foreground-app privacy boundary. The sandboxed renderer communicates through a
runtime-validated, allow-listed preload API and never receives the current
non-target application.

The session form now loads and saves its task draft, selected target,
duration, intensity, grace period, and intervention threshold through the
validated preload boundary. Writes are debounced while editing and serialized
with recovery writes so simultaneous changes cannot overwrite one another.

The focus note is optional in the settings UI. The core still receives a
deterministic task such as `Focus in Visual Studio Code` when the note is blank,
while local preferences retain the raw blank draft. This preserves the core's
non-empty task contract without making users invent a label. The former
three-way mood selector is presented as an explicit away behavior: balanced
strengthens visual reminders, while strict additionally asks macOS to bring the
selected focus app forward once. Legacy persisted `gentle` values are shown and
saved as balanced.

The settings window also exposes an always-available pet-size slider. The
bounded size and display-aware drag position use the same validated local
document and serialized write queue. Older version 1 files safely receive the
default size, while malformed or off-screen values fall back or clamp without
making the pet unreachable.

Active sessions are checkpointed after state changes and immediately before a
normal quit. Relaunch rebuilds only the minimal session contract and counters,
always in the paused state with no remembered foreground application. The user
must explicitly resume before monitoring or intervention continues. The
Electron smoke test seeds an interrupted session, verifies this paused restore,
changes and reloads preferences, drives the live controls, and confirms a clean
shutdown.

Reset/delete controls, motion/sound preferences, and launch-at-login
integration remain pending.
