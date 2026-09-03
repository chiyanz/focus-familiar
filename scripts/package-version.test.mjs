import { describe, expect, it } from "vitest";

import { resolvePackageVersionMetadata } from "./package-version.mjs";

describe("macOS package version metadata", () => {
  it("derives runtime and bundle versions from prototype metadata", () => {
    expect(
      resolvePackageVersionMetadata({
        version: "0.1.0-prototype.3",
        focusFamiliarBuildNumber: 3,
      }),
    ).toEqual({
      applicationVersion: "0.1.0-prototype.3",
      marketingVersion: "0.1.0",
      bundleBuildVersion: "3",
    });
  });

  it("accepts stable versions and valid build metadata", () => {
    expect(
      resolvePackageVersionMetadata({
        version: "1.2.3+build.004",
        focusFamiliarBuildNumber: 120_304,
      }),
    ).toEqual({
      applicationVersion: "1.2.3+build.004",
      marketingVersion: "1.2.3",
      bundleBuildVersion: "120304",
    });
  });

  it("rejects versions that the runtime SemVer parser cannot order", () => {
    for (const version of [
      "0.1",
      "01.0.0",
      "0.1.0-prototype..3",
      "0.1.0-prototype.03",
      "0.1.0+",
      `0.1.0-${"x".repeat(129)}`,
      "9007199254740992.0.0",
    ]) {
      expect(() =>
        resolvePackageVersionMetadata({
          version,
          focusFamiliarBuildNumber: 3,
        }),
      ).toThrow("valid version");
    }
  });

  it("requires a positive integer bundle build number", () => {
    for (const buildNumber of [undefined, 0, -1, 1.5, "3"]) {
      expect(() =>
        resolvePackageVersionMetadata({
          version: "0.1.0-prototype.3",
          focusFamiliarBuildNumber: buildNumber,
        }),
      ).toThrow("positive focusFamiliarBuildNumber");
    }
  });
});
