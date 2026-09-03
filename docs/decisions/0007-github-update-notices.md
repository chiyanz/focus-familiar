# ADR 0007: Detect releases without installing them

Status: **Accepted**

## Context

Early prototype users replace the application manually from GitHub Releases.
Without an in-app notice they cannot tell that a newer prototype exists. The
current artifacts are ad-hoc signed and not notarized, so silently downloading
or replacing an application would create a misleading and brittle security
experience.

An update check introduces the first runtime network request. Focus Familiar's
local-first promise therefore requires a deliberately narrow boundary and an
honest disclosure.

## Decision

Packaged builds check the fixed public Focus Familiar releases endpoint shortly
after launch and at a twelve-hour interval. The main process sends only normal
HTTP metadata and an app-version user agent; it sends no task, session,
foreground-application, installation, or device identifier. GitHub still sees
the request's IP address and user agent as it does for any web request.

The response is time- and size-bounded, parsed as untrusted data, and reduced
to validated SemVer tags. Stable builds ignore prereleases. Prototype builds
may move to a newer prototype or stable release. Drafts and contradictory or
malformed metadata are ignored.

The sandboxed UI receives only a status, current version, latest version, and
validated release tag. It never renders remote Markdown or accepts a remote
URL. When the user chooses **View release**, the main process constructs the
URL for the fixed repository and validated tag.

The app does not download, verify, unpack, execute, or install an update.
Those behaviors require a separate review after Developer ID signing,
notarization, and a generated update feed exist.

## Consequences

- Users can discover new prototypes without repeatedly visiting GitHub.
- Focus sessions remain entirely usable offline; update failure is non-fatal.
- The product and privacy documentation must disclose the GitHub request.
- Each build needs an accurate, monotonically maintained version and bundle
  build number.
- Installation remains manual and downloaded ad-hoc prototypes continue to
  require the documented Gatekeeper flow.
