/**
 * The maximum length accepted for an application version or release tag.
 *
 * Release metadata comes from a remote service, so keeping the parser bounded
 * prevents an unexpectedly large tag from becoming an unbounded parsing or
 * rendering input. Normal GitHub release tags are substantially shorter than
 * this limit.
 */
export const MAX_RELEASE_VERSION_LENGTH = 128;

/** A release candidate as returned by a release provider. */
export interface ReleaseCandidate {
  readonly tagName: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
}

/** The only release data that may cross the update boundary into the app. */
export interface AvailableRelease {
  readonly tagName: string;
  /** Canonical SemVer without an optional leading `v`. */
  readonly version: string;
}

type PrereleaseIdentifier = number | string;

/**
 * Parsed SemVer data used for precedence. Build metadata is retained only for
 * canonical output; it deliberately does not participate in comparison.
 */
export interface ParsedReleaseVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly PrereleaseIdentifier[];
  readonly build: readonly string[];
  readonly normalized: string;
}

const VERSION_PATTERN =
  /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Parse a strict SemVer release version.
 *
 * This accepts the normal `major.minor.patch` form, an optional lowercase
 * leading `v`, dot-separated prerelease identifiers, and build metadata. The
 * returned value is null for malformed, unsafe, or oversized input.
 */
export function parseReleaseVersion(
  input: unknown,
): ParsedReleaseVersion | null {
  if (typeof input !== "string" || input.length > MAX_RELEASE_VERSION_LENGTH) {
    return null;
  }

  const match = VERSION_PATTERN.exec(input);
  if (!match) return null;

  const major = parseCoreNumber(match[1]);
  const minor = parseCoreNumber(match[2]);
  const patch = parseCoreNumber(match[3]);
  if (major === null || minor === null || patch === null) return null;

  const prerelease = parsePrerelease(match[4]);
  if (!prerelease) return null;

  const build = parseBuild(match[5]);
  if (!build) return null;

  const normalized = [major, minor, patch].join(".");
  const normalizedPrerelease = prerelease.length
    ? `-${prerelease.map(String).join(".")}`
    : "";
  const normalizedBuild = build.length ? `+${build.join(".")}` : "";

  return {
    major,
    minor,
    patch,
    prerelease,
    build,
    normalized: `${normalized}${normalizedPrerelease}${normalizedBuild}`,
  };
}

/** Compare two parsed release versions using SemVer precedence rules. */
export function compareReleaseVersions(
  left: ParsedReleaseVersion,
  right: ParsedReleaseVersion,
): number {
  const coreComparison = compareCore(left, right);
  if (coreComparison !== 0) return coreComparison;

  const leftPrerelease = left.prerelease;
  const rightPrerelease = right.prerelease;

  // A version without prerelease identifiers has higher precedence than one
  // with prerelease identifiers when their major/minor/patch are equal.
  if (!leftPrerelease.length || !rightPrerelease.length) {
    if (!leftPrerelease.length && !rightPrerelease.length) return 0;
    return leftPrerelease.length ? -1 : 1;
  }

  const length = Math.min(leftPrerelease.length, rightPrerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return 0;
    }

    const identifierComparison = comparePrereleaseIdentifiers(
      leftIdentifier,
      rightIdentifier,
    );
    if (identifierComparison !== 0) return identifierComparison;
  }

  if (leftPrerelease.length === rightPrerelease.length) return 0;
  return leftPrerelease.length < rightPrerelease.length ? -1 : 1;
}

/**
 * Select the highest valid release strictly newer than the current version.
 *
 * Stable installations do not move to prerelease candidates. A prerelease
 * installation may move to a newer prerelease or to a stable release. Drafts,
 * malformed tags, and provider metadata that disagrees with the tag are
 * ignored. The result intentionally contains only a validated tag and its
 * canonical version; URLs, names, and other provider fields never cross this
 * boundary.
 */
export function selectNewerRelease(
  currentVersion: string,
  candidates: readonly ReleaseCandidate[],
): AvailableRelease | null {
  const current = parseReleaseVersion(currentVersion);
  if (!current || !Array.isArray(candidates)) return null;

  let selected: {
    readonly parsed: ParsedReleaseVersion;
    readonly release: AvailableRelease;
  } | null = null;

  for (const candidate of candidates) {
    if (!isReleaseCandidate(candidate) || candidate.draft) continue;

    const parsed = parseReleaseVersion(candidate.tagName);
    if (!parsed) continue;

    const hasPrerelease = parsed.prerelease.length > 0;
    if (candidate.prerelease !== hasPrerelease) continue;
    if (!current.prerelease.length && hasPrerelease) continue;
    if (compareReleaseVersions(parsed, current) <= 0) continue;

    if (selected && compareReleaseVersions(parsed, selected.parsed) <= 0) {
      continue;
    }

    selected = {
      parsed,
      release: {
        tagName: candidate.tagName,
        version: parsed.normalized,
      },
    };
  }

  return selected?.release ?? null;
}

function parseCoreNumber(value: string | undefined): number | null {
  if (value === undefined) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePrerelease(
  value: string | undefined,
): readonly PrereleaseIdentifier[] | null {
  if (value === undefined) return [];

  const identifiers = value.split(".");
  const parsed: PrereleaseIdentifier[] = [];
  for (const identifier of identifiers) {
    if (isNumericIdentifier(identifier)) {
      if (identifier.length > 1 && identifier.startsWith("0")) {
        return null;
      }

      const numeric = Number(identifier);
      if (!Number.isSafeInteger(numeric)) return null;
      parsed.push(numeric);
    } else {
      parsed.push(identifier);
    }
  }

  return parsed;
}

function parseBuild(value: string | undefined): readonly string[] | null {
  return value === undefined ? [] : value.split(".");
}

function isNumericIdentifier(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

function compareCore(
  left: ParsedReleaseVersion,
  right: ParsedReleaseVersion,
): number {
  for (const [leftValue, rightValue] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ] as const) {
    if (leftValue === rightValue) continue;
    return leftValue < rightValue ? -1 : 1;
  }

  return 0;
}

function comparePrereleaseIdentifiers(
  left: PrereleaseIdentifier,
  right: PrereleaseIdentifier,
): number {
  if (typeof left === "number" && typeof right === "number") {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  if (typeof left === "number") return -1;
  if (typeof right === "number") return 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isReleaseCandidate(value: unknown): value is ReleaseCandidate {
  if (!isRecord(value)) return false;

  return (
    typeof value.tagName === "string" &&
    typeof value.draft === "boolean" &&
    typeof value.prerelease === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
