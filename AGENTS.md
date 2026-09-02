# AGENTS.md

## Purpose

Focus Familiar is a local-first macOS productivity pet. It helps a user remain in a chosen target application during a focus session through calm feedback and a reversible escalation ladder.

Codex reads this file as repository-level working guidance. Keep durable product facts in the repository documentation rather than relying on chat memory.

## Version 0.1 boundaries

- Build a standalone Electron application using TypeScript.
- Target macOS first.
- Observe foreground-application changes only.
- Do not add a browser extension or VS Code extension in v0.1.
- Do not add cloud accounts, analytics, advertising, or an AI API dependency.
- Do not read keystrokes, source code, screenshots, browser content, clipboard data, or document contents.
- Do not force-quit another application or risk unsaved user work.
- Always provide a visible pause, stop, and emergency-exit path.

## Architecture expectations

- Keep session rules and escalation behavior in a pure TypeScript `core` module.
- Keep Electron lifecycle and privileged operating-system access in the main process.
- Keep renderer processes sandboxed and expose the smallest practical typed preload API.
- Do not enable Node.js integration in a renderer.
- Isolate macOS-specific behavior behind typed interfaces in `src/platform`.
- Prefer event-driven application monitoring over frequent polling.
- Keep pet presentation independent from focus policy.
- Treat pet packs as untrusted data: validate manifests and constrain asset paths.
- Store settings and session data locally with an explicit, versioned schema.

## Engineering agreements

- Use TypeScript in strict mode.
- Prefer small modules with explicit inputs and outputs over implicit global state.
- Inject clocks and platform services into time-dependent logic so tests are deterministic.
- Add or update automated tests with every behavior change.
- Keep production dependencies minimal and document why each is needed.
- Handle expected failures visibly; do not silently weaken focus or privacy behavior.
- Respect macOS reduced-motion and accessibility preferences.
- Avoid premature abstractions for unsupported platforms, but preserve clean platform boundaries.

Once the application scaffold provides the scripts, run the repository's format, lint, type-check, test, and package-validation commands before considering a change complete.

## Documentation and feature status

- Every user-visible feature must have a plan under `docs/features/`.
- Use these statuses exactly: `Planned`, `In progress`, `Implemented`, `Verified`, `Deferred`.
- Mark a feature `Implemented` only after working code and relevant automated tests exist.
- Mark it `Verified` only after its acceptance criteria have been checked on a supported Mac.
- Update the feature plan's implementation notes in the same change as the implementation.
- Record durable architectural choices under `docs/decisions/`.
- Update `docs/ROADMAP.md` when scope or sequencing changes.

## Pull request and review rules

- Keep pull requests focused on one feature plan or one clearly related maintenance concern.
- Describe behavior changes, privacy or permission impact, checks run, and remaining risks.
- Treat renderer privilege expansion, new permissions, native helpers, update mechanisms, and persistence migrations as security-sensitive.
- Reject telemetry or network access unless the product direction is explicitly changed and documented.
- Never commit secrets, signing identities, notarization credentials, or personal activity data.
