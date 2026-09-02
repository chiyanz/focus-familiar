# ADR 0003: Use a narrow bundled macOS workspace helper

Status: **Accepted**

Date: 2026-09-02

## Context

Focus Familiar needs the frontmost application's stable bundle identifier, a list of running applications for target selection, system sleep/wake signals, and a reversible request to activate the chosen application. General-purpose active-window packages expose substantially more information, such as window titles, browser URLs, bounds, or accessibility-derived content, than version 0.1 needs.

Electron does not expose `NSWorkspace` notifications directly. Polling shell commands would add delay and unnecessary repeated work, while a native Node module would couple the project to Electron's native-module ABI.

## Decision

Bundle a small open-source Swift command-line helper that uses Apple's AppKit and Foundation frameworks. It communicates with the Electron main process through a versioned JSON protocol over standard input/output and supports only:

- reading the current foreground application's bundle identifier and localized name;
- listing running user applications by bundle identifier and localized name;
- emitting application-activation and system sleep/wake events;
- requesting activation of one running application by bundle identifier.

The helper must not read or emit window titles, URLs, keystrokes, screen images, accessibility trees, document data, or application contents. Observation must not request Accessibility or Screen Recording permission.

The TypeScript side owns protocol validation, process lifecycle, normalization, deduplication, and failure reporting behind replaceable `ActivityProvider` and `ApplicationActivator` interfaces.

## Consequences

- Foreground observation is event-driven and uses stable bundle identity.
- The privacy surface is small enough to describe precisely in the UI and source.
- Unit tests can replace the helper process with a test double.
- macOS builds require the Swift toolchain, and release packaging must compile, bundle, sign, and notarize the helper with the Electron application.
- The helper protocol and state restoration behavior must tolerate process exit, malformed output, sleep, and wake without silently inventing focus activity.
- Windows and Linux will need different adapters if those platforms are supported later.
