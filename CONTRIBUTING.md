# Contributing

Thanks for helping build Focus Familiar. The project is intentionally structured so a TypeScript developer can understand one behavior at a time.

## Before implementation

1. Read `AGENTS.md`, `docs/PRODUCT.md`, and `docs/ARCHITECTURE.md`.
2. Find the relevant plan under `docs/features/`.
3. Move the plan from `Planned` to `In progress` when implementation begins.
4. If the approach changes a durable architectural decision, add or update an ADR under `docs/decisions/`.

## Definition of done

A feature is not complete until:

- Its acceptance criteria are satisfied.
- Behavior is covered by appropriate automated tests.
- Format, lint, type-check, test, and packaging checks pass.
- Privacy and permission effects are documented.
- The feature plan contains concise implementation notes.
- User-facing documentation is updated when behavior changes.

## Feedback loops

Use the smallest loop that exercises your change:

- `npm run lab` for the real pet assets and presentation states in a browser.
- `npm run dev` for the live Electron app with renderer hot reload.
- `npm run test:watch` for focus rules and typed contracts.
- `npm run prototype` for the packaged Apple Silicon app and launch smoke test.

See the [development workflow](docs/DEVELOPMENT.md) for the layer map and full
pre-share checklist.

## Scope discipline

Version 0.1 intentionally excludes browser extensions, editor extensions, accounts, cloud synchronization, analytics, and generative AI. Please discuss scope expansions before implementing them.

## Pet assets

Contributed pet packs must include authorship and license metadata. Do not submit copyrighted characters or assets without clear redistribution rights.
