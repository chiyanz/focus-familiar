# 003: Foreground application awareness

Status: **Implemented**

## Outcome

The main process receives reliable, timestamped changes to the frontmost macOS application and forwards only the required information to the focus engine.

## Scope

- Enumerate running applications for target selection.
- Identify applications by bundle identifier rather than display name alone.
- Observe foreground-application changes through an event-driven macOS adapter.
- Handle startup, sleep, wake, application termination, and permission failure.
- Request activation of the chosen target application.

## Non-goals

- Window-title inspection
- Browser URL inspection
- Keystroke or document-content monitoring
- Force-quitting applications

## Acceptance criteria

- Switching between common Mac applications produces one normalized event per observed change.
- The app can distinguish itself from the user's target and other applications.
- Sleep and wake do not create false distraction intervals.
- Failure to observe or activate is reported without crashing or claiming success.
- The adapter can be replaced with a test double.

## Planned tests

- Adapter contract tests using recorded normalized events.
- Focus-engine integration tests.
- Manual checks across VS Code, Terminal, Finder, and a browser.

## Implementation notes

- Added a small Swift helper built directly against AppKit and Foundation for macOS 13+. It compiles in Swift 5 language mode for compatibility with GitHub's macOS 14 build image and newer Swift toolchains. It uses `NSWorkspace` to read the current application, list regular user-facing applications, observe activation/termination/sleep/wake, and request activation of an already-running application.
- The helper emits a versioned newline-delimited JSON protocol containing only bundle identifiers, localized application names, lifecycle fields, and explicit errors. It never reads window titles, URLs, process IDs, accessibility trees, keystrokes, screenshots, or application content.
- Observation uses workspace notifications and reconciles against `frontmostApplication` on the next main-loop turn. Wake and application termination trigger fresh foreground snapshots.
- Added a TypeScript platform boundary with replaceable `ActivityProvider` and `ApplicationActivator` interfaces, injected clocks, runtime protocol validation, bounded output, request and observation-readiness timeouts, duplicate activation suppression, and idempotent disposal.
- Added a main-process session bridge that forwards normalized activation facts to the pure focus engine. Sleep and observation failure safely pause a running session; wake does not auto-resume, so suspended time cannot become a false distraction interval.
- Development and production builds compile the helper for the host architecture with a macOS 13 deployment target. Linux CI deliberately skips this platform-specific build; macOS CI compiles it and the Electron smoke test verifies that the helper can report the current application.
- The helper requires no Accessibility, Screen Recording, Input Monitoring, Full Disk Access, or Automation permission. Activation is a best-effort macOS request and failures remain explicit.

## Verification

- Unit and contract tests cover protocol validation, split UTF-8 frames, bounded output, list completeness/deduplication, current application, activation success/failure, lifecycle deduplication, process failure, and cleanup.
- Focus-engine integration tests cover foreground transitions plus fail-safe pause across sleep and observation failure.
- The Swift helper compiles with Swift 5 language compatibility on a Swift 6 toolchain, and its current/list/invalid-activation command paths have been exercised on macOS.
- Manual switching across VS Code, Terminal, Finder, a browser, Spaces, and sleep/wake remains required before this feature can move to **Verified**.
