# Install the macOS prototype

The current prototype supports Apple Silicon Macs running macOS 13 or newer.
It is a standalone app: no browser or editor extension is required.

## Download and verify

Download both the macOS ARM64 ZIP and its `.sha256` file from the matching
GitHub release. With both files in Downloads, open Terminal and run:

```bash
cd ~/Downloads
shasum -a 256 -c focus-familiar-0.1.0-macos-arm64.zip.sha256
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

## Uninstall

Move **Focus Familiar** from Applications to the Trash. To also remove its local
preferences and paused-session recovery, delete:

```text
~/Library/Application Support/Focus Familiar/focus-familiar.json
```

There is no account, cloud copy, background updater, or browser/editor extension
to remove.
