import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import process from "node:process";

import { resolvePackageVersionMetadata } from "./package-version.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const requiredScripts = [
  "dev",
  "build",
  "build:native",
  "format:check",
  "lint",
  "typecheck",
  "test",
  "test:sprite-edges",
  "verify",
  "prototype",
  "release:macos",
  "test:packaged-smoke",
];

const missingScripts = requiredScripts.filter(
  (script) => !packageJson.scripts?.[script],
);
const errors = [];

try {
  resolvePackageVersionMetadata(packageJson);
} catch (error) {
  errors.push(
    error instanceof Error ? error.message : "invalid version metadata",
  );
}

if (missingScripts.length > 0) {
  errors.push(`missing scripts: ${missingScripts.join(", ")}`);
}

if (packageJson.main !== "out/main/index.js") {
  errors.push("main must point to out/main/index.js");
}

if (packageJson.type !== "module") {
  errors.push("package must use ESM modules");
}

if (Object.keys(packageJson.dependencies ?? {}).length > 0) {
  errors.push(
    "runtime dependencies are not permitted in the application shell",
  );
}

if (process.platform === "darwin") {
  try {
    await access(
      new URL("../out/native/focus-familiar-activity", import.meta.url),
      constants.X_OK,
    );
  } catch {
    errors.push("the built macOS activity helper is missing or not executable");
  }
}

if (errors.length > 0) {
  console.error("Package validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Package validation passed.");
}
