# 005: Nudge and intervention ladder

Status: **In progress**

## Outcome

Leaving the target application triggers predictable, progressively stronger, and always reversible interventions.

## Scope

- Add a configurable grace period.
- Add visual pet-state changes and concise reminder text.
- Add a stronger intervention with a return countdown.
- Provide a clear action to request activation of the target application.
- In strict mode, request activation once when prolonged distraction reaches the intervention threshold.
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

The nonvisual runtime foundation is in progress. It schedules one-shot callbacks
for the next focus, grace, or intervention boundary rather than polling, and it
keeps timing behind injected interfaces for deterministic tests. Once a session
is in intervention, a low-frequency 15-second heartbeat advances authoritative
away time and refreshes presentation. Only one heartbeat timer exists at once;
returning, pausing, stopping, or disposal cancels it.

Strict mode treats entry into the intervention phase as a reversible request for macOS to activate the configured target application. Gentle and balanced modes never activate an application automatically. Repeated state delivery cannot issue repeated requests, returning to focus rearms the next away interval, and restoration into an already-intervening state has no side effect. This is intentionally friction rather than an unbreakable lock: macOS or the user may decline or immediately override activation.

Automated tests cover every schedulable phase, exact and delayed boundaries, long-timer chunking, stale callback cancellation, timer failure, sleep, duplicate intervention states, activation failure, disposal, and late asynchronous results after return, pause, stop, completion, or a newer away episode.

The approved Shokupan-cat presentation is now connected to live focus phases.
Grace and nudge copy is concise. Intervention reminders briefly reveal the
otherwise collapsed pet text, repeat on the heartbeat, and grow through three
bounded visual attention levels without changing the window or sprite bounds.
Reduced-motion mode suppresses the pop and growth. The settings window shows concise state-specific copy and focused-time progress,
including a display-only clock between authoritative runtime events. Pause,
resume, stop, and quit remain visible and never close another application. The
typed preload projection deliberately excludes the current non-target app and
all raw operating-system events.

The settings control now states the actual difference between visual reminders
and strict mode's one-time activation request. Still pending are a manual
“return now” button, transient returned-to-focus acknowledgement, and
supported-Mac manual checks of the full escalation experience.
