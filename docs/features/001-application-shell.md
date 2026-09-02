# 001: Application shell and security baseline

Status: **Implemented**

## Outcome

A development build launches as a macOS Electron application with secure main, preload, pet-renderer, and settings-renderer boundaries.

## Scope

- Establish TypeScript, formatting, linting, type checking, and tests.
- Create Electron main and preload entry points.
- Create placeholder pet and settings windows.
- Enable context isolation and renderer sandboxing.
- Disable renderer Node.js integration.
- Add typed IPC contracts with payload validation.
- Add local development and production-build commands.

## Non-goals

- Foreground application monitoring
- Focus session behavior
- Finished character art
- Signing or notarization

## Acceptance criteria

- The development app launches on macOS.
- Pet and settings renderers have no unrestricted Node.js access.
- Only documented IPC channels are callable.
- The application closes cleanly without orphaned processes.
- Format, lint, type-check, unit-test, and production-build commands pass.

## Planned tests

- Validate security-sensitive BrowserWindow options.
- Validate preload API shape.
- Smoke-test application startup and shutdown.

## Implementation notes

- Added separate Electron main, sandboxed preload, pet renderer, and settings renderer entry points.
- Added a narrow typed IPC bridge. The main process validates both payloads and the sending renderer before handling a request.
- Added navigation and pop-up guards, explicit secure window options, a single-instance lifecycle, and a temporary `file://` production renderer target constrained to fixed application-owned files. A custom application protocol remains release-hardening work.
- Added a small CSS-drawn placeholder pet and opaque settings window. Both honor the operating system's reduced-motion preference.
- Added automated boundary tests, an Electron startup/security/shutdown smoke test, and CI on Ubuntu and macOS.
- Version 0.1 now requires macOS 13 or newer because Electron 44 no longer supports macOS 12.

## Verification

- Automated format, lint, type-check, unit-test, production-build, and package checks: implemented in CI.
- Electron runtime boundary and clean shutdown: covered by `npm run test:electron-smoke` on macOS.
- Visual behavior across multiple displays, Spaces, and full-screen applications remains to be manually verified before this feature can move to **Verified**.
