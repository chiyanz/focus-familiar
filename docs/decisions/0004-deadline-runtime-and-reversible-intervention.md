# ADR 0004: Schedule absolute session deadlines and keep intervention reversible

Status: **Accepted**

Date: 2026-09-02

## Context

Foreground-application changes are event-driven, but a session can cross its grace, intervention, or completion threshold while the foreground application stays unchanged. A frequent polling loop would waste work and make boundary behavior depend on polling cadence. Relative timers alone are also insufficient because the operating system may delay a callback while busy or suspended.

The product also needs a stronger strict mode without pretending it can or should trap the user. macOS application activation begins as a request, so the native boundary must verify the resulting foreground application before reporting success.

## Decision

The main process schedules one cancellable timer for the next absolute reducer
boundary. The boundary is derived from the authoritative session snapshot, and
both the clock and timer driver are injected. When a delayed callback runs, it
advances the reducer at the planned boundary; any already-due following
boundary is scheduled immediately. Long waits are split into safe timer-sized
chunks. Paused and terminal states have no deadline timer. Intervention uses a
15-second heartbeat so authoritative away time and progressively stronger
presentation can refresh without frequent polling.

Timer setup failures are explicit runtime failures and cause a running session to pause rather than silently continuing with inaccurate monitoring.

On a new entry into the intervention phase, strict mode schedules one
cancellable activation request seven seconds later for that away episode. The
delay gives the pet's final cropped-eye warning and expanded copy time to be
read. Returning to the target, pausing, stopping, disposal, or a newer episode
cancels the timer. If the user remains away, the platform helper unhides the
configured, already-running target, asks AppKit to raise all of its existing
windows, and reports success only after macOS identifies the target as
frontmost. Gentle and balanced modes never activate an application
automatically. Initial restoration into intervention is side-effect-free and
duplicate snapshots cannot retrigger the request.

The foreground observer remains the authority: an activation result never marks the session focused. The user can override the activation immediately, and pause, stop, and emergency exit remain available. Focus Familiar never closes, terminates, or blocks another application.

## Consequences

- Threshold transitions remain deterministic even when timer delivery is late.
- Runtime work is proportional to meaningful boundaries rather than a polling frequency.
- Prolonged intervention performs low-frequency deterministic work until the
  user returns, pauses, or stops.
- A strict intervention creates reversible friction but is not an unbreakable lock.
- Strict activation waits through a visible seven-second final-warning stage;
  this one presentation-aligned timer is owned by the intervention coordinator.
- An activation request already handed to macOS cannot be recalled, but stale completion callbacks have no effect.
- Presentation and manual controls can subscribe to authoritative state later without owning timing or platform policy.
