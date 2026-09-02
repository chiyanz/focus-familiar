# ADR 0002: Limit version 0.1 to application-level awareness

Status: **Accepted**

Date: 2026-09-02

## Context

The core use case is knowing when the user leaves a chosen target application such as VS Code. Browser-domain and editor-workspace knowledge would require additional extensions, permissions, and maintenance.

## Decision

Version 0.1 will observe only which macOS application is in the foreground. It will not inspect browser pages, VS Code workspaces, window contents, or typed input.

## Consequences

- The standalone app can validate the core focus behavior with a small permission and privacy surface.
- Browser use cannot be classified as productive or distracting in version 0.1.
- Users should choose sessions whose target application is a meaningful proxy for the intended work.
- Browser and editor extensions remain optional future features rather than architectural requirements.
