# 009: Update notices

Status: **Implemented**

## Outcome

Focus Familiar can notice when a newer GitHub release is available and guide
the user to the trusted release page without downloading or executing remote
content.

## Scope

- Give every prototype an explicit SemVer identity.
- Check the fixed Focus Familiar GitHub Releases endpoint shortly after a
  packaged app starts and every twelve hours while it remains open.
- Provide a manual **Check now** control in settings.
- Show update availability in settings and as a quiet badge on the pet's
  settings pill.
- Open only the locally constructed GitHub release URL after a user action.
- Keep focus sessions fully functional when offline or when GitHub fails.

## Non-goals

- Background update downloads
- Silent or unattended installation
- Rendering remote release notes inside the app
- A general-purpose network or browser API in a renderer
- Telemetry, accounts, device identifiers, or activity uploads

## Acceptance criteria

- A prototype release detects a strictly newer compatible SemVer release.
- Stable builds ignore prereleases; prototype builds may discover newer
  prototypes or a stable release.
- Draft, malformed, oversized, and contradictory release metadata is ignored
  or fails safely.
- Concurrent checks are coalesced, requests time out, and failures do not
  affect focus behavior.
- The renderer receives only current version, latest version, validated tag,
  and status—not release Markdown or remote URLs.
- The UI accurately discloses that update checks contact GitHub and downloads
  remain manual.

## Implementation notes

Prototype 3 changes the application identity from the ambiguous `0.1.0` to
`0.1.0-prototype.3`. Packaging derives its runtime version, marketing version,
bundle build number, and archive names from root package metadata rather than
duplicating a version literal.

The main process uses Electron's network stack to make a bounded GET request to
one fixed GitHub API endpoint. A pure SemVer module selects the highest valid
newer release according to an explicit stable/prerelease channel policy. The
preload exposes three narrow operations—read status, check now, and open the
currently available release—plus a sanitized status event. Renderers never
receive a caller-controlled URL or remote release content.

Automatic download and installation remain deferred until Developer ID
signing, notarization, and a generated update feed are available. See
[ADR 0007](../decisions/0007-github-update-notices.md).

## Tests

- Strict SemVer parsing and precedence, including prerelease and build metadata
- Release selection, draft filtering, and stable/prototype channel behavior
- Fixed endpoint, timeout, bounded response, HTTP failure, and request
  coalescing
- IPC and preload validation, event projection, and unavailable-service paths
- Electron smoke coverage for packaged version identity and the offline-safe
  initial update state
