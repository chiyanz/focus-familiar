import { describe, expect, it } from "vitest";

import { resolveMacOSActivityHelperPath } from "./native-helper";

describe("macOS activity helper path", () => {
  it("uses the local Swift build during development", () => {
    expect(
      resolveMacOSActivityHelperPath({
        appPath: "/repo",
        resourcesPath: "/resources",
        isPackaged: false,
        isDevelopment: true,
      }),
    ).toBe("/repo/native/macos/.build/focus-familiar-activity");
  });

  it("uses the Electron output for an unpackaged production build", () => {
    expect(
      resolveMacOSActivityHelperPath({
        appPath: "/repo",
        resourcesPath: "/resources",
        isPackaged: false,
        isDevelopment: false,
      }),
    ).toBe("/repo/out/native/focus-familiar-activity");
  });

  it("uses the signed resources directory after packaging", () => {
    expect(
      resolveMacOSActivityHelperPath({
        appPath: "/Applications/Focus Familiar.app/Contents/Resources/app.asar",
        resourcesPath: "/Applications/Focus Familiar.app/Contents/Resources",
        isPackaged: true,
        isDevelopment: false,
      }),
    ).toBe(
      "/Applications/Focus Familiar.app/Contents/Resources/native/focus-familiar-activity",
    );
  });
});
