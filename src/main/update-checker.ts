import {
  parseReleaseVersion,
  selectNewerRelease,
  type ReleaseCandidate,
} from "../core";
import type { UpdateStatus } from "../shared/ipc";

export const GITHUB_RELEASES_API_URL =
  "https://api.github.com/repos/chiyanz/focus-familiar/releases?per_page=20";
export const GITHUB_RELEASE_PAGE_BASE_URL =
  "https://github.com/chiyanz/focus-familiar/releases/tag/";
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;
export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1_000;

const MAX_RELEASE_RESPONSE_BYTES = 256 * 1_024;

export interface ReleaseSource {
  readonly listReleases: () => Promise<readonly ReleaseCandidate[]>;
}

export type FetchResponse = Pick<Response, "body" | "ok" | "status">;

export type FetchReleases = (
  url: string,
  init: {
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
) => Promise<FetchResponse>;

export interface TimeoutScheduler {
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

const defaultTimeoutScheduler: TimeoutScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Fetches only public release metadata from one fixed GitHub endpoint. The
 * response is bounded before parsing and reduced to version-selection fields.
 */
export class GitHubReleaseSource implements ReleaseSource {
  constructor(
    private readonly fetchReleases: FetchReleases,
    private readonly currentVersion: string,
    private readonly timeoutScheduler: TimeoutScheduler = defaultTimeoutScheduler,
  ) {}

  async listReleases(): Promise<readonly ReleaseCandidate[]> {
    const controller = new AbortController();
    const timeout = this.timeoutScheduler.schedule(
      () => controller.abort(),
      UPDATE_CHECK_TIMEOUT_MS,
    );

    try {
      const response = await this.fetchReleases(GITHUB_RELEASES_API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": `Focus-Familiar/${this.currentVersion}`,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `GitHub release check returned HTTP ${response.status}.`,
        );
      }

      const text = await readBoundedResponse(response);
      return parseGitHubReleases(JSON.parse(text) as unknown);
    } finally {
      this.timeoutScheduler.cancel(timeout);
    }
  }
}

async function readBoundedResponse(response: FetchResponse): Promise<string> {
  if (!response.body) {
    throw new Error("GitHub release response did not include a body.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (!chunk.value) continue;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > MAX_RELEASE_RESPONSE_BYTES) {
      await reader.cancel("response-too-large").catch(() => undefined);
      throw new Error("GitHub release response exceeded the allowed size.");
    }
    chunks.push(chunk.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export class UpdateChecker {
  private status: UpdateStatus;
  private inFlight: Promise<UpdateStatus> | undefined;
  private readonly listeners = new Set<(status: UpdateStatus) => void>();

  constructor(
    private readonly currentVersion: string,
    private readonly releaseSource: ReleaseSource,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {
    this.status = createStatus("not-checked", currentVersion);
  }

  snapshot(): UpdateStatus {
    return { ...this.status };
  }

  subscribe(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  check(): Promise<UpdateStatus> {
    if (this.inFlight) return this.inFlight;

    this.publish(createStatus("checking", this.currentVersion));
    this.inFlight = this.performCheck().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  availableReleaseTag(): string | null {
    return this.status.phase === "available" ? this.status.releaseTag : null;
  }

  private async performCheck(): Promise<UpdateStatus> {
    try {
      if (!parseReleaseVersion(this.currentVersion)) {
        throw new Error("The current application version is invalid.");
      }
      const releases = await this.releaseSource.listReleases();
      const available = selectNewerRelease(this.currentVersion, releases);
      const status: UpdateStatus = available
        ? {
            phase: "available",
            currentVersion: this.currentVersion,
            latestVersion: available.version,
            releaseTag: available.tagName,
          }
        : createStatus("up-to-date", this.currentVersion);
      this.publish(status);
      return this.snapshot();
    } catch (error: unknown) {
      const normalizedError =
        error instanceof Error ? error : new Error("Unknown update error.");
      this.onError(normalizedError);
      this.publish(createStatus("error", this.currentVersion));
      return this.snapshot();
    }
  }

  private publish(status: UpdateStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch (error: unknown) {
        this.onError(
          error instanceof Error
            ? error
            : new Error("Unknown update listener error."),
        );
      }
    }
  }
}

export function parseGitHubReleases(
  value: unknown,
): readonly ReleaseCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub release response was not a list.");
  }

  const releases: ReleaseCandidate[] = [];
  for (const entry of value.slice(0, 20)) {
    if (!isRecord(entry)) continue;
    if (
      typeof entry.tag_name !== "string" ||
      typeof entry.draft !== "boolean" ||
      typeof entry.prerelease !== "boolean"
    ) {
      continue;
    }
    releases.push({
      tagName: entry.tag_name,
      draft: entry.draft,
      prerelease: entry.prerelease,
    });
  }
  return releases;
}

export function githubReleasePageUrl(tagName: string): string {
  if (!parseReleaseVersion(tagName)) {
    throw new Error("Cannot open an invalid release tag.");
  }
  return `${GITHUB_RELEASE_PAGE_BASE_URL}${encodeURIComponent(tagName)}`;
}

function createStatus(
  phase: Exclude<UpdateStatus["phase"], "available">,
  currentVersion: string,
): UpdateStatus {
  return {
    phase,
    currentVersion,
    latestVersion: null,
    releaseTag: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
