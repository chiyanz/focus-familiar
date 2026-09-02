# ADR 0001: Use Electron and TypeScript for version 0.1

Status: **Accepted**

Date: 2026-09-02

## Context

The product is a continuously available macOS desktop pet with a transparent overlay, local session logic, and limited foreground-application awareness. The initial maintainer has a full-stack Node.js background and wants the implementation to remain understandable while learning desktop concepts.

## Decision

Build version 0.1 with Electron and TypeScript. Keep product rules in pure TypeScript, privileged APIs in the main process, and macOS-specific behavior behind a platform interface. Use a sandboxed renderer and a narrow typed preload bridge.

## Consequences

### Positive

- Most of the code uses a familiar language and ecosystem.
- Web UI and testing knowledge transfer directly.
- The project is approachable to a broad contributor pool.
- A later Windows or Linux adaptation is possible without replacing all product logic.

### Negative

- Electron carries greater runtime and distribution overhead than a native Swift app.
- Fine-grained macOS integration may require a native dependency or small Swift helper.
- Transparent-window and always-on-top behavior need careful Mac-specific verification.
- Electron and Chromium security updates become an ongoing maintenance responsibility.

## Alternatives considered

### Swift, SwiftUI, and AppKit

This would provide the strongest native integration and efficiency but would impose a larger initial learning cost and narrow the immediate contributor pool.

### Tauri

This could reduce application size while retaining a web UI, but it would introduce Rust alongside TypeScript before the product behavior is validated.
