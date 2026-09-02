# Feature plans

These files are both implementation plans and the durable status record for user-visible features.

## Status meanings

- **Planned:** scope and acceptance criteria exist; implementation has not begun.
- **In progress:** code is actively being implemented.
- **Implemented:** code and relevant automated tests exist.
- **Verified:** acceptance criteria have been exercised on a supported Mac.
- **Deferred:** intentionally removed from the active sequence.

The application shell, deterministic focus engine, and macOS application awareness are implemented; later version 0.1 product features remain planned.

| Feature                                                     | Status      |
| ----------------------------------------------------------- | ----------- |
| [Application shell](001-application-shell.md)               | Implemented |
| [Focus session engine](002-focus-session-engine.md)         | Implemented |
| [Application awareness](003-application-awareness.md)       | Implemented |
| [Pet overlay](004-pet-overlay.md)                           | Planned     |
| [Nudge escalation](005-nudge-escalation.md)                 | Planned     |
| [Settings and persistence](006-settings-and-persistence.md) | Planned     |
| [Custom pet packs](007-custom-pet-packs.md)                 | Planned     |
| [Packaging and release](008-packaging-and-release.md)       | Planned     |

When a feature is implemented, update its status, implementation notes, tests, and any deviations from the original design in the same commit or pull request.
