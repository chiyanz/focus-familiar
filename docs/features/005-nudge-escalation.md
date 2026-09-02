# 005: Nudge and intervention ladder

Status: **Planned**

## Outcome

Leaving the target application triggers predictable, progressively stronger, and always reversible interventions.

## Scope

- Add a configurable grace period.
- Add visual pet-state changes and concise reminder text.
- Add a stronger intervention with a return countdown.
- Provide a clear action to request activation of the target application.
- Provide pause, stop, and emergency-exit actions at every strong intervention.
- Briefly acknowledge a successful return.

## Non-goals

- Website blocking
- Closing or terminating another application
- Claiming that strict mode is impossible to bypass
- Shame-based streak loss

## Acceptance criteria

- Each intervention occurs at its configured threshold exactly once per away interval.
- Returning cancels pending intervention work immediately.
- An activation failure leaves the user with a clear manual action.
- Stop and emergency-exit actions always remain available.
- A distraction never erases previously accumulated focus time.

## Planned tests

- Fake-clock threshold tests.
- Cancellation and return-race tests.
- Pause and emergency-exit tests.
- Manual checks for notification and overlay behavior.

## Implementation notes

Not implemented.
