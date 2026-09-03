/**
 * Resolve the macOS distribution mode without ever reading secret values.
 * Notarization credentials live in a named Keychain profile; the repository
 * and process environment contain only that profile's non-secret name.
 */
export function resolveMacOSSigningMode({
  requireNotarization = false,
  identity,
  keychainProfile,
} = {}) {
  const normalizedIdentity = normalize(identity);
  const normalizedProfile = normalize(keychainProfile);

  if (!requireNotarization) {
    if (normalizedIdentity || normalizedProfile) {
      throw new Error(
        "Signing settings are accepted only by the explicit notarized release command.",
      );
    }
    return { mode: "ad-hoc" };
  }

  if (!normalizedIdentity && !normalizedProfile) {
    throw new Error(
      "A notarized release requires FOCUS_MACOS_SIGN_IDENTITY and FOCUS_NOTARY_KEYCHAIN_PROFILE.",
    );
  }

  if (!normalizedIdentity || !normalizedProfile) {
    throw new Error(
      "FOCUS_MACOS_SIGN_IDENTITY and FOCUS_NOTARY_KEYCHAIN_PROFILE must be provided together.",
    );
  }
  if (!normalizedIdentity.startsWith("Developer ID Application:")) {
    throw new Error(
      "FOCUS_MACOS_SIGN_IDENTITY must name a Developer ID Application certificate.",
    );
  }

  return {
    mode: "notarized",
    identity: normalizedIdentity,
    keychainProfile: normalizedProfile,
  };
}

function normalize(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}
