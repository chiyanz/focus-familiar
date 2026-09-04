# Install the macOS prototype

The current prototype supports Apple Silicon Macs running macOS 13 or newer.
It is a standalone app: no browser or editor extension is required.

## Download and verify

Download both the macOS ARM64 ZIP and its `.sha256` file from the matching
GitHub release. With both files in Downloads, open Terminal and run:

```bash
cd ~/Downloads
shasum -a 256 -c focus-familiar-0.1.0-prototype.8-macos-arm64-local-adhoc.zip.sha256
```

The result should say `OK`. This confirms that the download matches the file
published with the release.

## Install and open

1. Double-click the ZIP.
2. Drag **Focus Familiar** into Applications.
3. Control-click the app and choose **Open** for its first launch.
4. If macOS still blocks it, open **System Settings → Privacy & Security** and
   choose **Open Anyway** for Focus Familiar.

The prototype is ad-hoc signed but not Apple Developer ID signed or notarized,
so this warning is expected. Never disable Gatekeeper globally.

### If Open Anyway still does not work

First confirm that the ZIP reports `OK` using the checksum step above. Then you
may remove Chrome's quarantine attribute from this exact app and open it:

```bash
xattr -dr com.apple.quarantine "/Applications/Focus Familiar.app"
open "/Applications/Focus Familiar.app"
```

This does not disable Gatekeeper globally. It removes the download marker only
from the verified Focus Familiar copy. Do not run it for an archive with a
missing or mismatched checksum.

Future public builds should use the repository's Developer ID and notarization
workflow and will not require this fallback.

## Try a focus session

1. Open the application you want to focus in first.
2. In Focus Familiar, enter a task and choose that running app.
3. Start a short session. The pet remains calm while the target app is active,
   glances during the grace period, nudges after that, and can ask macOS to
   return to the target after the intervention threshold.
4. Pause or stop at any time. **Quit Focus Familiar** is always visible.

Focus Familiar observes only foreground application identity. It does not read
keystrokes, source code, screenshots, browser content, clipboard data, or
document contents. Settings and safe paused-session recovery remain on the Mac.

## Update notices

Packaged builds check GitHub Releases shortly after launch and every twelve
hours while open. When a newer version exists, the pet's settings pill shows a
small badge and the settings window offers **View release**. There is also a
manual **Check now** button.

The request includes the current app version, never tasks, session timing, or
foreground-application data. GitHub receives the normal request IP address and
user agent. Focus sessions continue to work offline.

Updates are not downloaded or installed automatically in the prototype. Verify
the new checksum, quit Focus Familiar, and replace the old app in Applications
using the same steps above. Existing local settings are preserved.

## Uninstall

Move **Focus Familiar** from Applications to the Trash. To also remove its local
preferences and paused-session recovery, delete:

```text
~/Library/Application Support/Focus Familiar/focus-familiar.json
```

There is no account, cloud copy, background updater, or browser/editor extension
to remove.
