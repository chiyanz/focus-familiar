# Proposed architecture

Status: **Proposed**

This document describes the intended version 0.1 design. It should be updated when implementation reveals a better boundary.

## Technology

- Electron
- TypeScript with strict mode
- A lightweight web renderer for the pet and settings
- Node.js APIs only in the Electron main process
- A narrow, typed preload bridge
- A small, isolated macOS activity adapter

The frontend library, test runner, packaging tool, and local storage library will be selected during the application-shell feature. Choices should favor readability, maintenance, and low dependency weight.

## Process boundaries

```text
macOS foreground-app events
            |
            v
Electron main process ---- local persistence
      |                   fixed GitHub release check
            |
            v
Pure TypeScript focus engine
       |                 |
       v                 v
typed preload API   intervention coordinator
       |
       v
sandboxed renderers
  - pet window
  - settings window
```

### Main process

Owns application lifecycle, windows, menu-bar controls, foreground-app observation, persistence, and requests to activate another application.

### Focus core

A pure state machine that accepts timestamped activity and session events. It must not import Electron, operating-system APIs, wall-clock time, or renderer code.

Example inputs:

- `sessionStarted`
- `foregroundApplicationChanged`
- `timeAdvanced`
- `sessionPaused`
- `sessionStopped`

Example outputs:

- `focused`
- `gracePeriod`
- `nudge`
- `intervention`
- `completed`

### Preload bridge

Exposes a minimal, versioned API to renderers. Renderer code must not receive direct filesystem, process, shell, or unrestricted IPC access.

### Pet renderer

Owns transparent presentation and animation only. It renders the state supplied by the main process and sends a small set of declared user actions back through the preload bridge.

### Settings renderer

Edits validated preferences and session configuration. The main process remains authoritative for persistence and session state.

### Update boundary

Packaged builds ask one fixed GitHub API endpoint for public release metadata
after launch and every twelve hours. The main process bounds and validates the
response, applies pure SemVer selection, and sends only sanitized status fields
through preload. A renderer cannot fetch updates or choose an external URL.
Opening the validated release page requires an explicit user action. No remote
content is rendered and update failure never weakens focus behavior. See
[ADR 0007](decisions/0007-github-update-notices.md).

## Platform boundary

Operating-system behavior will sit behind interfaces such as:

```ts
interface ActivityProvider {
  currentApplication(): Promise<ForegroundApplication>;
  onApplicationChanged(
    listener: (app: ForegroundApplication) => void,
  ): Disposable;
}

interface ApplicationActivator {
  activate(bundleId: string): Promise<ActivationResult>;
}
```

The first implementation uses a bundled Swift helper built on `NSWorkspace`. It communicates through a versioned, validated NDJSON protocol and emits only bundle identifiers, localized application names, and lifecycle or error fields. See [ADR 0003](decisions/0003-bundled-macos-workspace-helper.md).

## Runtime deadlines and intervention

The main process schedules only the next absolute focus-session boundary. Injected clock and timer interfaces keep deadline behavior deterministic, and delayed callbacks advance through planned boundaries without converting event-loop delay into product timing. Strict intervention may request activation of the already-running target once per away episode, but only observed foreground changes can return the engine to focused state. See [ADR 0004](decisions/0004-deadline-runtime-and-reversible-intervention.md).

## Persistence

The main process stores one runtime-validated, versioned JSON document beneath
Electron's per-user application-data directory. A schema-specific repository
sanitizes untrusted reads and writes, while a generic atomic store provides a
1 MiB read limit, restrictive permissions, uniquely named sibling temporary
files, atomic replacement, and serialized mutations.

Persist only what the product needs:

- Versioned user preferences
- Pet selection and position
- Current session recovery data

Recovery projects live runtime state down to the focus contract, accumulated
focus/away totals, session identity, and save time. Relaunch reconstructs a
paused session at a fresh runtime timestamp with no current application, so it
cannot accrue closed-app time or trigger strict intervention until the user
explicitly resumes. Raw foreground-application changes and current distraction
details are not persisted. Any future history feature needs an explicit product
and privacy decision. See [ADR 0005](decisions/0005-versioned-local-settings.md).

## Security posture

- Renderer sandboxing and context isolation are mandatory.
- Node integration in renderers is prohibited.
- IPC channels are allow-listed and payloads are validated.
- Pet pack paths cannot escape the pack directory.
- Remote content is not rendered in privileged windows.
- Runtime network access is limited to the reviewed GitHub release-availability
  check; focus data and activity never enter the request.
- Signing and notarization credentials remain outside the repository.
- Public macOS packaging fails closed unless Developer ID signing and Apple
  notarization complete; ad-hoc local artifacts are named separately. See
  [ADR 0006](decisions/0006-developer-id-and-notarization.md).

## Test strategy

- Unit tests cover all focus-engine transitions with an injected clock.
- Contract tests cover preload and platform boundaries.
- Renderer tests cover meaningful controls and state presentation.
- Integration tests cover session recovery and persistence migrations.
- Manual Mac verification covers window levels, multiple displays, Spaces, reduced motion, sleep/wake, and permission-denied behavior.
