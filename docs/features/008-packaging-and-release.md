# 008: Packaging and first release

Status: **Planned**

## Outcome

Version 0.1 can be built reproducibly and distributed as a trustworthy macOS application.

## Scope

- Produce a macOS application bundle and DMG.
- Define application identifier, icon, versioning, and release metadata.
- Build for supported Apple Silicon and Intel configurations or document the chosen support boundary.
- Add automated release checks and artifact checksums.
- Document Developer ID signing and Apple notarization without committing credentials.
- Write install, update, and uninstall instructions.
- Publish a GitHub release after verification.

## Non-goals

- Mac App Store submission
- Automatic updates unless separately reviewed
- Windows or Linux packages

## Acceptance criteria

- A clean checkout produces the expected artifact using documented commands.
- The packaged app launches and retains the same security settings as development.
- No development secrets or personal data appear in the artifact.
- Signing and notarization status are accurately disclosed.
- Install and uninstall instructions work on a supported Mac.

## Planned tests

- Clean-build packaging check.
- Bundle-content and entitlement inspection.
- Manual install, launch, upgrade, and uninstall verification.

## Implementation notes

Not implemented.
