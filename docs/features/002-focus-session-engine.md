# 002: Focus session engine

Status: **Implemented**

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

- Added a pure, immutable reducer under `src/core` with no Electron, macOS, renderer, persistence, or wall-clock dependency.
- Session snapshots and events contain only JSON-safe values so a later persistence layer can replay or recover them.
- Only time while the target application's bundle ID is foreground counts toward the configured duration. Away and paused time do not count.
- Away thresholds are absolute within the current away episode: elapsed time below `gracePeriodMs` is `grace`, time at or above grace but below `interventionAfterMs` is `nudge`, and time at or above the intervention threshold is `intervention`.
- Returning to the target resets the current away episode without erasing focused or total-away time. Switching between non-target applications does not reset it.
- Pausing accrues time up to the pause event and then resets the away episode. Resuming while away begins a fresh grace period; paused wall time is excluded.
- Completion occurs at the exact timestamp accumulated target-foreground time reaches `durationMs`, including when a later event overshoots it. Completion wins over a simultaneous pause, stop, or application change.
- Event timestamps must be non-negative safe integers and nondecreasing. Equal timestamps are accepted. Repeated clock and foreground observations are idempotent; invalid transitions and stale events return stable errors while preserving the prior state.
- Completed and stopped sessions are terminal. A new session begins from a fresh idle snapshot in version 0.1.

## Verification

- Table-driven tests cover start states and every grace/nudge/intervention threshold boundary.
- Tests cover split focus intervals, direct time jumps, exact and overshot completion, away-time exclusion, return/reset behavior, and bundle-ID identity.
- Tests cover pause, resume, user stop, emergency stop, duplicates, malformed inputs, out-of-order timestamps, terminal states, JSON serialization, and repeatable output without wall-clock reads.
- Electron and macOS integration remain intentionally outside this feature.
