import process from "node:process";

import { resolveMacOSSigningMode } from "./macos-signing.mjs";

resolveMacOSSigningMode({
  requireNotarization: true,
  identity: process.env.FOCUS_MACOS_SIGN_IDENTITY,
  keychainProfile: process.env.FOCUS_NOTARY_KEYCHAIN_PROFILE,
});

console.log("Developer ID and notarization settings are configured.");
