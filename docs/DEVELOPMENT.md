# Development workflow

Focus Familiar keeps product rules, macOS access, and presentation separate so
each layer has a short feedback loop. The development baseline is an Apple
Silicon Mac running macOS 13 or newer and Node.js 22.

## First setup

```bash
npm install
```

No account, API key, cloud service, or separately installed browser/editor
extension is needed.

## Pick the fastest loop for the change

### Pet presentation: `npm run lab`

Opens a browser-only visual lab with the real mascot assets and presentation
rules. Use it to switch among focus phases and inspect motion without launching
Electron or the macOS helper. Vite updates the page as files change.

### Live application: `npm run dev`

Builds the tiny native foreground-app helper, starts Electron, and enables the
renderer hot-reload loop. Use this for settings, window behavior, foreground
application changes, persistence, and end-to-end interaction.

### Rules and contracts: `npm run test:watch`

Runs the fast TypeScript suite after relevant file changes. The pure session
engine under `src/core` never reads the wall clock or imports Electron, so most
focus behavior can be developed here without launching the app.

## Before sharing a change

```bash
npm run verify
npm run test:electron-smoke
```

The first command checks formatting, lint, types, 250+ deterministic tests,
the production build, and package contents. The macOS smoke test launches the
actual Electron build with isolated local data and exercises renderer
sandboxing, assets, live controls, recovery, persistence, and clean shutdown.

## Build the installable prototype

```bash
npm run prototype
```

This builds, ad-hoc signs, archives, checksums, and launches the packaged Apple
Silicon app. Outputs are written beneath the ignored `release/` directory:

- `Focus Familiar.app`
- `focus-familiar-0.1.0-macos-arm64-local-adhoc.zip`
- `focus-familiar-0.1.0-macos-arm64-local-adhoc.zip.sha256`

The prototype signature is for local integrity testing, not an Apple Developer
ID signature or notarization. Release notes must state that distinction until
the signing pipeline is configured.

`npm run release:macos` is the fail-closed public distribution path. It requires
a Developer ID identity and notarization credentials stored in Keychain; see
the [signing and notarization guide](NOTARIZATION.md).

## Where to start reading

- `src/core/focus-session.ts`: deterministic focus-session rules
- `src/main/session-runtime.ts`: schedules the next rule boundary
- `src/platform/macos/`: observes and activates apps through a narrow helper
- `src/shared/ipc.ts`: validated contract between privileged and visual code
- `src/renderer/`: settings and pet presentation
- `src/main/local-settings-service.ts`: serialized local preferences/recovery

Each user-visible behavior also has a living plan under `docs/features/`.
