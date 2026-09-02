import { readFile } from "node:fs/promises";
import process from "node:process";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const requiredScripts = [
  "dev",
  "build",
  "format:check",
  "lint",
  "typecheck",
  "test",
  "verify",
];

const missingScripts = requiredScripts.filter(
  (script) => !packageJson.scripts?.[script],
);
const errors = [];

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

if (errors.length > 0) {
  console.error("Package validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Package validation passed.");
}
