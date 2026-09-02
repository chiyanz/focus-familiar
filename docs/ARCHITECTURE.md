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

The first implementation may use a maintained native dependency or a bundled Swift helper. That choice requires a focused security and maintenance review before adoption.

## Persistence

Persist only what the product needs:

- Versioned user preferences
- Pet selection and position
- Current session recovery data
- Minimal session summaries

Do not persist a raw stream of foreground-application changes by default. Any future history feature needs an explicit product and privacy decision.

## Security posture

- Renderer sandboxing and context isolation are mandatory.
- Node integration in renderers is prohibited.
- IPC channels are allow-listed and payloads are validated.
- Pet pack paths cannot escape the pack directory.
- Remote content is not rendered in privileged windows.
- Network access is absent in version 0.1 except when deliberately added for packaging or update checks in a later reviewed milestone.
- Signing and notarization credentials remain outside the repository.

## Test strategy

- Unit tests cover all focus-engine transitions with an injected clock.
- Contract tests cover preload and platform boundaries.
- Renderer tests cover meaningful controls and state presentation.
- Integration tests cover session recovery and persistence migrations.
- Manual Mac verification covers window levels, multiple displays, Spaces, reduced motion, sleep/wake, and permission-denied behavior.
