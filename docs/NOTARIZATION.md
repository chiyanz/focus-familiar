# macOS signing and notarization

Downloaded macOS applications avoid the “Apple cannot check it for malicious
software” warning only when they are signed with a Developer ID Application
certificate and accepted by Apple's notarization service. Ad-hoc signatures
are useful for local integrity checks but are not trusted distribution
signatures.

Apple requires an Apple Developer Program membership, a Developer ID
Application certificate, Hardened Runtime, a secure timestamp, and successful
notarization for software distributed outside the Mac App Store.

## One-time setup

1. Install Xcode and sign in to the Apple Developer account.
2. Create and install a **Developer ID Application** certificate through Xcode
   or the Apple Developer portal.
3. Confirm the identity name:

   ```bash
   security find-identity -v -p codesigning
   ```

4. Store notarization credentials in the macOS Keychain. Apple's `notarytool`
   securely prompts for an app-specific password when `--password` is omitted,
   so the password is not placed in shell history:

   ```bash
   xcrun notarytool store-credentials focus-familiar-notary \
     --apple-id "APPLE_ID" \
     --team-id "TEAM_ID"
   ```

The Keychain profile contains the secret. Only its non-secret profile name is
passed to the build.

## Produce a trusted release

```bash
FOCUS_MACOS_SIGN_IDENTITY="Developer ID Application: NAME (TEAM_ID)" \
FOCUS_NOTARY_KEYCHAIN_PROFILE="focus-familiar-notary" \
npm run release:macos
```

The command:

1. signs Electron's nested code from the inside out with Hardened Runtime and
   secure timestamps;
2. uses a minimal JIT entitlement for the app, Electron's scoped Chromium
   helper entitlements, and no entitlements for the foreground-app helper;
3. submits the app using `notarytool`, waits for acceptance, and staples the
   ticket;
4. validates the ticket, Gatekeeper assessment, sealed signature, archive, and
   SHA-256 checksum.

The command fails closed if either required setting is absent or the identity
is not a Developer ID Application certificate. Credentials, certificates, and
Keychain files must never be committed.

## Local-only prototype builds

`npm run prototype` remains available without an Apple account. Its archive is
explicitly named `focus-familiar-0.1.0-prototype.9-macos-arm64-local-adhoc.zip` so it cannot
be mistaken for a notarized public release. A downloaded ad-hoc build will
still trigger Gatekeeper; use the verified fallback in the install guide only
for a build you trust.

## Continuous integration

A future release workflow may import a certificate into a temporary Keychain
and create the notary profile from protected CI secrets. It must delete that
Keychain after the job and upload artifacts only after `release:macos` succeeds.
The current repository intentionally does not contain signing credentials or a
workflow that claims an unnotarized artifact is trusted.
