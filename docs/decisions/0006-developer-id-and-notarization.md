# ADR 0006: Developer ID and notarization for public macOS builds

Status: **Accepted**

## Context

An ad-hoc signature proves that a local bundle has not changed since packaging,
but macOS Gatekeeper does not treat it as an identified-developer signature.
When a browser adds the quarantine attribute, users receive a warning that
Apple cannot check the app for malicious software.

Bypassing quarantine cannot provide publisher identity or Apple's malware
assessment. Distributing an override script as the default install path would
weaken the platform protection the product should respect.

## Decision

Public macOS artifacts must be signed with a Developer ID Application
certificate, Hardened Runtime, and a secure timestamp, then accepted and
stapled by Apple's notarization service before archiving.

Use the official Electron ecosystem signing and notarization libraries. Keep
notarization secrets in a named macOS Keychain profile and require the release
command to fail when its identity or profile configuration is missing. Keep the
ad-hoc path for local testing, but give its archive a visibly different
`local-adhoc` name.

The app uses only the JIT runtime entitlement needed by Electron. Specialized
Chromium helpers retain the scoped defaults maintained by Electron's signing
tool, while the Swift foreground-app helper receives no entitlements.

## Consequences

- Downloaded public releases can pass Gatekeeper without asking users to bypass
  quarantine after an Apple Developer identity is configured.
- Producing a trusted release requires a paid Apple Developer membership,
  certificate management, Xcode tooling, and access to Apple's notary service.
- Local contributors can still build and smoke-test without credentials, but
  those artifacts are clearly unsuitable for trusted public distribution.
- Signing credentials and certificates remain outside source control.
