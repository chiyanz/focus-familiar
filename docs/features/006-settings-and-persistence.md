# 006: Settings and local persistence

Status: **In progress**

## Outcome

Users can configure sessions and pet behavior, and the app restores safe preferences after relaunch without collecting unnecessary activity history.

## Scope

- Task, duration, target application, intensity, and timing controls.
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

The settings form, privacy explanation, reset/delete controls, pet position updates, and launch-at-login integration remain pending with the user-interface work.
