import { describe, expect, it, vi } from "vitest";

import type { ReleaseCandidate } from "../core";
import {
  GITHUB_RELEASES_API_URL,
  GitHubReleaseSource,
  UPDATE_CHECK_TIMEOUT_MS,
  UpdateChecker,
  githubReleasePageUrl,
  parseGitHubReleases,
  type FetchReleases,
  type ReleaseSource,
  type TimeoutScheduler,
} from "./update-checker";

function response(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
}

describe("GitHub release source", () => {
  it("requests only the fixed endpoint and reduces the response", async () => {
    const fetchReleases = vi.fn<FetchReleases>(async () =>
      response([
        {
          tag_name: "v0.1.0-prototype.3",
          draft: false,
          prerelease: true,
          body: "remote Markdown must not cross the boundary",
          html_url: "https://example.com/untrusted",
        },
        { malformed: true },
      ]),
    );
    const source = new GitHubReleaseSource(fetchReleases, "0.1.0-prototype.2");

    await expect(source.listReleases()).resolves.toEqual([
      {
        tagName: "v0.1.0-prototype.3",
        draft: false,
        prerelease: true,
      },
    ]);
    expect(fetchReleases).toHaveBeenCalledWith(
      GITHUB_RELEASES_API_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          "User-Agent": "Focus-Familiar/0.1.0-prototype.2",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("fails visibly for HTTP errors, malformed JSON, and oversized bodies", async () => {
    const forbidden = new GitHubReleaseSource(
      async () => response([], 403),
      "0.1.0",
    );
    await expect(forbidden.listReleases()).rejects.toThrow("HTTP 403");

    const malformed = new GitHubReleaseSource(
      async () => response("not json"),
      "0.1.0",
    );
    await expect(malformed.listReleases()).rejects.toThrow();

    const oversized = new GitHubReleaseSource(
      async () => response("x".repeat(256 * 1_024 + 1)),
      "0.1.0",
    );
    await expect(oversized.listReleases()).rejects.toThrow("allowed size");
  });

  it("aborts a stalled request and clears the timeout after completion", async () => {
    let timeoutCallback: (() => void) | undefined;
    const timeoutHandle = {};
    const scheduler: TimeoutScheduler = {
      schedule: vi.fn((callback, delayMs) => {
        expect(delayMs).toBe(UPDATE_CHECK_TIMEOUT_MS);
        timeoutCallback = callback;
        return timeoutHandle;
      }),
      cancel: vi.fn(),
    };
    let requestSignal: AbortSignal | undefined;
    const fetchReleases: FetchReleases = async (_url, { signal }) => {
      requestSignal = signal;
      timeoutCallback?.();
      throw new Error("aborted");
    };
    const source = new GitHubReleaseSource(fetchReleases, "0.1.0", scheduler);

    await expect(source.listReleases()).rejects.toThrow("aborted");
    expect(requestSignal?.aborted).toBe(true);
    expect(scheduler.cancel).toHaveBeenCalledWith(timeoutHandle);
  });
});

describe("GitHub release response parsing", () => {
  it("rejects a non-list and ignores malformed entries", () => {
    expect(() => parseGitHubReleases({})).toThrow("not a list");
    expect(
      parseGitHubReleases([
        null,
        { tag_name: 42, draft: false, prerelease: false },
        { tag_name: "v1.0.0", draft: "no", prerelease: false },
        { tag_name: "v1.0.0", draft: false, prerelease: false },
      ]),
    ).toEqual([{ tagName: "v1.0.0", draft: false, prerelease: false }]);
  });

  it("constructs only a fixed release-page URL from a valid tag", () => {
    expect(githubReleasePageUrl("v0.1.0-prototype.3")).toBe(
      "https://github.com/chiyanz/focus-familiar/releases/tag/v0.1.0-prototype.3",
    );
    for (const tag of [
      "../settings",
      "https://example.com",
      "v0.1.0%2F..%2Fsettings",
      "v0.1.0 prototype.3",
    ]) {
      expect(() => githubReleasePageUrl(tag)).toThrow("invalid release tag");
    }
  });
});

describe("update checker", () => {
  it("publishes checking and available states without remote content", async () => {
    const source: ReleaseSource = {
      listReleases: async () => [
        {
          tagName: "v0.1.0-prototype.3",
          draft: false,
          prerelease: true,
        },
      ],
    };
    const checker = new UpdateChecker("0.1.0-prototype.2", source);
    const listener = vi.fn();
    checker.subscribe(listener);

    await expect(checker.check()).resolves.toEqual({
      phase: "available",
      currentVersion: "0.1.0-prototype.2",
      latestVersion: "0.1.0-prototype.3",
      releaseTag: "v0.1.0-prototype.3",
    });
    expect(listener).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ phase: "checking" }),
    );
    expect(listener).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ phase: "available" }),
    );
    expect(checker.availableReleaseTag()).toBe("v0.1.0-prototype.3");
  });

  it("reports up to date and coalesces concurrent checks", async () => {
    let resolveReleases:
      | ((
          releases: readonly {
            tagName: string;
            draft: boolean;
            prerelease: boolean;
          }[],
        ) => void)
      | undefined;
    const source: ReleaseSource = {
      listReleases: vi.fn<ReleaseSource["listReleases"]>(
        () =>
          new Promise<readonly ReleaseCandidate[]>((resolve) => {
            resolveReleases = resolve;
          }),
      ),
    };
    const checker = new UpdateChecker("0.1.0-prototype.3", source);
    const first = checker.check();
    const second = checker.check();
    expect(first).toBe(second);
    resolveReleases?.([
      {
        tagName: "v0.1.0-prototype.3",
        draft: false,
        prerelease: true,
      },
    ]);

    await expect(first).resolves.toMatchObject({ phase: "up-to-date" });
    expect(source.listReleases).toHaveBeenCalledOnce();
    expect(checker.availableReleaseTag()).toBeNull();
  });

  it("turns network and version errors into a sanitized non-fatal state", async () => {
    const onError = vi.fn();
    const checker = new UpdateChecker(
      "not-a-version",
      { listReleases: async () => [] },
      onError,
    );

    await expect(checker.check()).resolves.toEqual({
      phase: "error",
      currentVersion: "not-a-version",
      latestVersion: null,
      releaseTag: null,
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("contains a renderer publication failure without losing update state", async () => {
    const onError = vi.fn();
    const checker = new UpdateChecker(
      "0.1.0-prototype.2",
      {
        listReleases: async () => [
          {
            tagName: "v0.1.0-prototype.3",
            draft: false,
            prerelease: true,
          },
        ],
      },
      onError,
    );
    checker.subscribe(() => {
      throw new Error("renderer closed");
    });

    await expect(checker.check()).resolves.toMatchObject({
      phase: "available",
    });
    expect(checker.availableReleaseTag()).toBe("v0.1.0-prototype.3");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "renderer closed" }),
    );
  });
});
