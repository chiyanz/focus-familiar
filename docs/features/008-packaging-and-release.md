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

The first Apple Silicon prototype workflow is implemented without adding a
packaging dependency. It copies the pinned Electron runtime with macOS symlinks
preserved, installs only the compiled application and native helper, removes
irrelevant template permission declarations, applies the documented bundle
metadata, and ad-hoc signs the result. It produces a ZIP and SHA-256 sidecar in
`release/`.

The packaged smoke test launches the generated application with isolated local
data and drives the same security, asset, session, persistence, and clean-quit
checks used by the development build. `npm run prototype` performs the complete
build, package, checksum, signature verification, and launch check.

This prototype is Apple Silicon-only, ad-hoc signed, and not notarized. A
Developer ID signature, notarization, final icon, DMG, Intel support decision,
and manual install/upgrade/uninstall verification remain before this feature
can be marked Implemented or Verified.
