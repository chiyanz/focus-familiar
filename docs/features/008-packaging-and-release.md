# 008: Packaging and first release

Status: **In progress**

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
- Automatic download or installation; availability notices are reviewed in
  [Feature 009](009-update-notices.md)
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

The first Apple Silicon prototype workflow copies the pinned Electron runtime
with macOS symlinks preserved, installs only the compiled application and
native helper, removes irrelevant template permission declarations, and
applies the documented bundle metadata. The official Electron signing and
notarization libraries are development-only dependencies because they handle
Electron's nested signing order and Apple's `notarytool` workflow.

The packaged smoke test launches the generated application with isolated local
data and drives the same security, asset, session, persistence, and clean-quit
checks used by the development build. `npm run prototype` performs the complete
build, package, checksum, signature verification, and launch check.

Package metadata now gives each prototype an explicit SemVer prerelease
identity and a numeric macOS bundle build number. The packaging script derives
the runtime package and bundle metadata from that central source. Update
availability notices are implemented separately in
[Feature 009](009-update-notices.md); installation remains manual.

Local builds remain Apple Silicon-only and ad-hoc signed, with `local-adhoc` in
their archive name. The public `release:macos` command instead fails closed
without a Developer ID Application identity and Keychain notarization profile;
ambient signing settings cannot silently switch a local package into release
mode. When explicitly configured, the release command enables Hardened Runtime
and secure timestamps, submits and staples the ticket, and requires Gatekeeper
assessment to pass before creating the standard archive.

Provisioning the Apple Developer identity, producing the first notarized
artifact, final icon, DMG, Intel support decision, and manual
install/upgrade/uninstall verification remain before this feature can be marked
Implemented or Verified.
