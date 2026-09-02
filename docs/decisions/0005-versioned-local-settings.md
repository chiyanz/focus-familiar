# ADR 0005: Store versioned settings and paused recovery locally

Status: **Accepted**

Date: 2026-09-02

## Context

Focus Familiar needs to remember ordinary preferences and enough session progress to recover safely from an app restart. The data is small, local, and read infrequently. Adding a database or state-management dependency would increase the maintenance and privacy surface without improving the version 0.1 use case.

Recovery data also needs a deliberately narrower shape than live runtime state. Persisting foreground-application events or the application that distracted the user is unnecessary for recovery and would create an activity history.

## Decision

Store one versioned JSON document under Electron's per-user application-data directory. Validate every field at the read and write boundary, remove unknown fields, support explicit migrations, and fall back to documented defaults without crashing when data is malformed or from an unsupported future schema.

Writes use a uniquely named sibling temporary file, restrictive file permissions, and atomic rename. Concurrent mutations are serialized in invocation order. Reset replaces the document with defaults; delete is idempotent. Expected filesystem failures are returned as typed errors and never include document contents.

Interrupted-session recovery stores only the session identity, validated focus contract, accumulated focus/away totals, and save timestamp. It never stores a foreground event stream or the current non-target application. Restored sessions are always presented as paused and require an explicit user action before timers or strict intervention can resume.

## Consequences

- Settings work without an account, network connection, or native database module.
- Corruption and unknown schema versions degrade to safe defaults instead of preventing startup.
- The file is human-readable, but callers must use the validated store rather than editing it in place.
- Atomic rename protects against partial writes; a sudden failure before rename may leave an inert temporary file that contains only the same local settings payload.
- Future schema changes require a migration and fixtures before release.
