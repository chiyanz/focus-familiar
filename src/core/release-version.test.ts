import { describe, expect, it } from "vitest";

import {
  MAX_RELEASE_VERSION_LENGTH,
  compareReleaseVersions,
  parseReleaseVersion,
  selectNewerRelease,
  type ReleaseCandidate,
} from "./release-version";

function candidate(
  tagName: string,
  options: Partial<Pick<ReleaseCandidate, "draft" | "prerelease">> = {},
): ReleaseCandidate {
  return {
    tagName,
    draft: options.draft ?? false,
    prerelease:
      options.prerelease ??
      Boolean(parseReleaseVersion(tagName)?.prerelease.length),
  };
}

describe("parseReleaseVersion", () => {
  it("accepts canonical versions and an optional leading v", () => {
    expect(parseReleaseVersion("1.2.3")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: [],
      normalized: "1.2.3",
    });
    expect(parseReleaseVersion("v1.2.3")).toMatchObject({
      normalized: "1.2.3",
    });
  });

  it("parses dot-separated prerelease identifiers and build metadata", () => {
    const parsed = parseReleaseVersion("v1.2.3-alpha.1.x+build.42");

    expect(parsed).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["alpha", 1, "x"],
      build: ["build", "42"],
      normalized: "1.2.3-alpha.1.x+build.42",
    });
  });

  it.each([
    "",
    "1",
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-",
    "1.2.3+",
    "1.2.3-alpha..1",
    "1.2.3-alpha_1",
    "1.2.3-alpha+build+more",
    "V1.2.3",
    " v1.2.3",
    "v1.2.3 ",
  ])("rejects malformed version %j", (version) => {
    expect(parseReleaseVersion(version)).toBeNull();
  });

  it.each(["1.2.3-01", "1.2.3-001", "1.2.3-0.00"])(
    "rejects a leading zero in numeric prerelease identifier %j",
    (version) => {
      expect(parseReleaseVersion(version)).toBeNull();
    },
  );

  it("allows zero but rejects unsafe core and prerelease numbers", () => {
    expect(parseReleaseVersion("0.0.0-0")).not.toBeNull();
    expect(parseReleaseVersion("9007199254740992.0.0")).toBeNull();
    expect(parseReleaseVersion("1.0.0-9007199254740992")).toBeNull();
  });

  it("rejects oversized input before parsing it", () => {
    expect(
      parseReleaseVersion(`1.2.3-${"a".repeat(MAX_RELEASE_VERSION_LENGTH)}`),
    ).toBeNull();
  });
});

describe("compareReleaseVersions", () => {
  function compare(left: string, right: string): number {
    const parsedLeft = parseReleaseVersion(left);
    const parsedRight = parseReleaseVersion(right);
    if (!parsedLeft || !parsedRight) throw new Error("Invalid test version");
    return compareReleaseVersions(parsedLeft, parsedRight);
  }

  it.each([
    ["1.0.0", "2.0.0"],
    ["1.2.0", "1.10.0"],
    ["1.2.3", "1.2.4"],
    ["1.0.0-alpha", "1.0.0"],
    ["1.0.0-alpha", "1.0.0-alpha.1"],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta"],
    ["1.0.0-alpha.beta", "1.0.0-beta"],
    ["1.0.0-beta", "1.0.0-beta.2"],
    ["1.0.0-beta.2", "1.0.0-beta.11"],
    ["1.0.0-beta.11", "1.0.0-rc.1"],
  ])("orders %s before %s", (left, right) => {
    expect(compare(left, right)).toBeLessThan(0);
  });

  it("sorts numeric prerelease identifiers below nonnumeric identifiers", () => {
    expect(compare("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
    expect(compare("1.0.0-alpha", "1.0.0-1")).toBeGreaterThan(0);
  });

  it("ignores build metadata in precedence", () => {
    expect(compare("1.0.0+one", "1.0.0+two")).toBe(0);
    expect(compare("1.0.0-alpha+one", "1.0.0-alpha+two")).toBe(0);
  });
});

describe("selectNewerRelease", () => {
  it("returns the highest stable release newer than the current version", () => {
    expect(
      selectNewerRelease("0.1.0", [
        candidate("v0.1.1"),
        candidate("v0.2.0"),
        candidate("v0.1.2"),
      ]),
    ).toEqual({ tagName: "v0.2.0", version: "0.2.0" });
  });

  it("accepts a leading v on the current version and normalizes output", () => {
    expect(selectNewerRelease("v1.0.0", [candidate("v1.0.1")])).toEqual({
      tagName: "v1.0.1",
      version: "1.0.1",
    });
  });

  it("does not offer prereleases to a stable installation", () => {
    expect(
      selectNewerRelease("1.0.0", [candidate("v1.1.0-beta.1")]),
    ).toBeNull();
  });

  it("allows newer prereleases and stable releases for a prerelease installation", () => {
    expect(
      selectNewerRelease("1.1.0-beta.1", [
        candidate("v1.1.0-alpha.9"),
        candidate("v1.1.0-beta.2"),
        candidate("v1.0.0"),
        candidate("v1.1.0"),
      ]),
    ).toEqual({ tagName: "v1.1.0", version: "1.1.0" });
  });

  it("ignores drafts and metadata that conflicts with the tag", () => {
    expect(
      selectNewerRelease("1.0.0-rc.1", [
        candidate("v2.0.0", { draft: true }),
        candidate("v2.0.0-beta.1", { prerelease: false }),
        candidate("v2.0.0", { prerelease: true }),
        candidate("v2.0.0-rc.1", { prerelease: false }),
        candidate("v2.0.0-rc.2"),
      ]),
    ).toEqual({ tagName: "v2.0.0-rc.2", version: "2.0.0-rc.2" });
  });

  it("ignores malformed candidates and returns only sanitized tag/version", () => {
    const malicious = {
      tagName: "https://example.test/download?name=evil",
      draft: false,
      prerelease: false,
      name: "Do not return this",
      htmlUrl: "https://example.test/evil",
    } as unknown as ReleaseCandidate;

    expect(
      selectNewerRelease("1.0.0", [
        malicious,
        candidate("v1.0.1", { draft: false }),
      ]),
    ).toEqual({ tagName: "v1.0.1", version: "1.0.1" });
  });

  it("requires a strictly newer version and ignores build-only changes", () => {
    expect(
      selectNewerRelease("1.0.0+current", [
        candidate("v1.0.0+release"),
        candidate("v0.9.9"),
      ]),
    ).toBeNull();
  });

  it("returns null for an invalid current version", () => {
    expect(selectNewerRelease("1.0", [candidate("v2.0.0")])).toBeNull();
  });

  it("keeps the first candidate when releases have equal SemVer precedence", () => {
    expect(
      selectNewerRelease("1.0.0", [
        candidate("v1.1.0+build-one"),
        candidate("1.1.0+build-two"),
      ]),
    ).toEqual({ tagName: "v1.1.0+build-one", version: "1.1.0+build-one" });
  });
});
