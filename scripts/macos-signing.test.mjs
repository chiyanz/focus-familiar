import { describe, expect, it } from "vitest";

import { resolveMacOSSigningMode } from "./macos-signing.mjs";

describe("macOS signing mode", () => {
  it("uses an explicit ad-hoc mode for local prototypes", () => {
    expect(resolveMacOSSigningMode()).toEqual({ mode: "ad-hoc" });
  });

  it("does not infer a public release from ambient environment settings", () => {
    expect(() =>
      resolveMacOSSigningMode({
        identity: "Developer ID Application: Example Team (TEAMID)",
        keychainProfile: "focus-familiar-notary",
      }),
    ).toThrow("only by the explicit notarized release command");
  });

  it("requires credentials when producing a public release", () => {
    expect(() =>
      resolveMacOSSigningMode({ requireNotarization: true }),
    ).toThrow("requires FOCUS_MACOS_SIGN_IDENTITY");
  });

  it("rejects partial and non-Developer-ID configuration", () => {
    expect(() =>
      resolveMacOSSigningMode({
        requireNotarization: true,
        identity: "Developer ID Application: Team",
      }),
    ).toThrow("must be provided together");
    expect(() =>
      resolveMacOSSigningMode({
        requireNotarization: true,
        identity: "Apple Development: Team",
        keychainProfile: "focus-familiar-notary",
      }),
    ).toThrow("must name a Developer ID Application certificate");
  });

  it("returns only the non-secret identity and Keychain profile name", () => {
    expect(
      resolveMacOSSigningMode({
        requireNotarization: true,
        identity: " Developer ID Application: Example Team (TEAMID) ",
        keychainProfile: " focus-familiar-notary ",
      }),
    ).toEqual({
      mode: "notarized",
      identity: "Developer ID Application: Example Team (TEAMID)",
      keychainProfile: "focus-familiar-notary",
    });
  });
});
