const MAX_VERSION_LENGTH = 128;
const prereleaseIdentifier =
  "(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const versionPattern = new RegExp(
  `^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-(${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`,
);

/** Resolve the version forms required by npm and the macOS bundle. */
export function resolvePackageVersionMetadata(packageMetadata) {
  const applicationVersion = packageMetadata?.version;
  const buildNumber = packageMetadata?.focusFamiliarBuildNumber;
  if (
    typeof applicationVersion !== "string" ||
    applicationVersion.length > MAX_VERSION_LENGTH ||
    !Number.isSafeInteger(buildNumber) ||
    buildNumber <= 0
  ) {
    throw invalidVersionError();
  }

  const match = versionPattern.exec(applicationVersion);
  if (!match) throw invalidVersionError();
  const core = match.slice(1, 4).map(Number);
  if (!core.every(Number.isSafeInteger)) throw invalidVersionError();

  return {
    applicationVersion,
    marketingVersion: core.join("."),
    bundleBuildVersion: String(buildNumber),
  };
}

function invalidVersionError() {
  return new Error(
    "package.json must provide a valid version and positive focusFamiliarBuildNumber.",
  );
}
