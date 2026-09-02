# 001: Application shell and security baseline

Status: **Planned**

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

Not implemented.
