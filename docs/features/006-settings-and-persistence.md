# 006: Settings and local persistence

Status: **Planned**

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

Not implemented.
