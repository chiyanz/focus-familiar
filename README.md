# Focus Familiar

Focus Familiar is a local-first desktop pet for macOS that helps you stay with the application you chose for a focus session. The pet remains calm while you work, notices when you drift, and escalates from a gentle reminder to deliberate friction when a distraction continues.

> [!NOTE]
> The project is in the planning and repository-foundation stage. No application feature is implemented yet.

## Version 0.1

The first version will be a standalone Electron application written in TypeScript. It will understand application-level activity only; browser and editor extensions are intentionally outside the v0.1 scope.

The initial experience will let someone:

1. Choose a task, focus duration, and target macOS application.
2. See a small, transparent pet above normal windows.
3. Receive progressively stronger nudges after leaving the target application.
4. Return to the target application from the intervention.
5. Stop or pause a session at any time through an obvious safety control.

## Product principles

- Reward returning to the task instead of punishing distraction.
- Keep activity processing and storage on the user's Mac.
- Request the minimum macOS permissions needed for the selected features.
- Never capture keystrokes, source code, screenshots, or browser contents.
- Keep the code approachable to a full-stack TypeScript developer.
- Make pet appearance and personality replaceable without application-code changes.

## Documentation

- [Product brief](docs/PRODUCT.md)
- [Proposed architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Feature plans and status](docs/features/README.md)
- [Architecture decisions](docs/decisions/0001-electron-and-typescript.md)
- [Contributor guide](CONTRIBUTING.md)

Feature plans are living documents. A feature is only marked **Implemented** after its code and automated checks exist, and **Verified** after its acceptance criteria have been exercised.

## Current status

| Area | Status |
| --- | --- |
| Product direction | Documented |
| Architecture direction | Proposed |
| Electron application | Planned |
| Focus features | Planned |
| GitHub release | Planned |

## License

The application code and documentation are available under the [MIT License](LICENSE). Pet artwork and sound packs may use separate licenses declared by each pack.
