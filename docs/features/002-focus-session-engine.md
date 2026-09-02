# 002: Focus session engine

Status: **Planned**

## Outcome

A deterministic TypeScript state machine models a complete focus session independently of Electron and macOS.

## Scope

- Define task, duration, target application, thresholds, and intensity models.
- Implement idle, focused, grace-period, nudge, intervention, paused, completed, and stopped states.
- Inject time rather than reading the wall clock directly.
- Define explicit events and transition results.
- Preserve accumulated focus time across short distractions and pauses.

## Non-goals

- Rendering the pet
- Observing macOS applications
- Persisting session history

## Acceptance criteria

- Identical event sequences always produce identical states.
- Paused time does not count as focus or distraction.
- Returning to the target application resets the away escalation.
- Completion is based on configured focus-session semantics documented by tests.
- Invalid event sequences fail safely and visibly.

## Planned tests

- Table-driven coverage of every valid transition.
- Threshold boundary tests.
- Pause, resume, stop, and completion tests.
- Out-of-order and duplicate event tests.

## Implementation notes

Not implemented.
