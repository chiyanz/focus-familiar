# 003: Foreground application awareness

Status: **Planned**

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

Not implemented. The native integration mechanism remains an explicit decision point.
