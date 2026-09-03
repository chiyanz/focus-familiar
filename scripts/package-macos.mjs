import { createHash } from "node:crypto";
import { spawn, execFile as execFileCallback } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import { promisify } from "node:util";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { notarize } from "@electron/notarize";
import { sign } from "@electron/osx-sign";

import { resolveMacOSSigningMode } from "./macos-signing.mjs";

const execFile = promisify(execFileCallback);
const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDirectory = join(projectDirectory, "release");
const electronTemplate = join(
  projectDirectory,
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
);
const packagedExecutableName = "Focus Familiar";
const compiledOutput = join(projectDirectory, "out");
const nativeHelperSource = join(
  compiledOutput,
  "native",
  "focus-familiar-activity",
);
const appBundle = join(releaseDirectory, "Focus Familiar.app");
const resourcesDirectory = join(appBundle, "Contents", "Resources");
const runtimeAppDirectory = join(resourcesDirectory, "app");
const runtimeOutputDirectory = join(runtimeAppDirectory, "out");
const runtimeNativeDirectory = join(resourcesDirectory, "native");
const nativeHelperTarget = join(
  runtimeNativeDirectory,
  "focus-familiar-activity",
);
const defaultAppAsar = join(resourcesDirectory, "default_app.asar");
const mainEntitlements = join(
  projectDirectory,
  "scripts",
  "entitlements",
  "main.plist",
);
const nativeHelperEntitlements = join(
  projectDirectory,
  "scripts",
  "entitlements",
  "native-helper.plist",
);
const signingMode = resolveMacOSSigningMode({
  requireNotarization: process.argv.includes("--require-notarization"),
  identity: process.env.FOCUS_MACOS_SIGN_IDENTITY,
  keychainProfile: process.env.FOCUS_NOTARY_KEYCHAIN_PROFILE,
});
const archiveName =
  signingMode.mode === "notarized"
    ? "focus-familiar-0.1.0-macos-arm64.zip"
    : "focus-familiar-0.1.0-macos-arm64-local-adhoc.zip";
const archivePath = join(releaseDirectory, archiveName);
const checksumPath = `${archivePath}.sha256`;

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error(
    "The macOS prototype package must be built on an Apple Silicon Mac (darwin arm64).",
  );
}

await assertDirectory(electronTemplate, "the installed Electron.app template");
await assertDirectory(compiledOutput, "the compiled out directory");
await assertExecutable(
  nativeHelperSource,
  "the compiled macOS activity helper",
);
await assertArm64Binary(
  join(electronTemplate, "Contents", "MacOS", "Electron"),
  "the installed Electron runtime",
);
await assertArm64Binary(
  nativeHelperSource,
  "the compiled macOS activity helper",
);
await runCommand("/usr/bin/plutil", ["-lint", mainEntitlements], {
  stdio: "ignore",
});
await runCommand("/usr/bin/plutil", ["-lint", nativeHelperEntitlements], {
  stdio: "ignore",
});

await mkdir(releaseDirectory, { recursive: true });

// These are the only existing release paths this script replaces. The source
// Electron.app and build output are never modified.
await rm(appBundle, { recursive: true, force: true });
await rm(archivePath, { force: true });
await rm(checksumPath, { force: true });

console.log("Copying the installed Electron runtime…");
// ditto preserves the relative framework symlinks inside Electron.app. A
// generic recursive copy may rewrite those links as absolute paths back into
// node_modules, which leaves an invalid macOS bundle.
await runCommand("/usr/bin/ditto", [electronTemplate, appBundle]);

// Electron uses the executable name to distinguish an installed app from
// the development Electron binary. Rename the outer executable so
// app.isPackaged is true and the main process selects Resources/native.
await rename(
  join(appBundle, "Contents", "MacOS", "Electron"),
  join(appBundle, "Contents", "MacOS", packagedExecutableName),
);

await rm(defaultAppAsar, { force: true });
await mkdir(runtimeAppDirectory, { recursive: true });
await mkdir(runtimeOutputDirectory, { recursive: true });

// Keep the package layout expected by package.json (app/out/main/index.js),
// while keeping the helper out of the JS payload. The packaged main process
// resolves its helper from Resources/native when app.isPackaged is true.
for (const entry of await readdir(compiledOutput, { withFileTypes: true })) {
  if (entry.name === "native") continue;
  await cp(
    join(compiledOutput, entry.name),
    join(runtimeOutputDirectory, entry.name),
    { recursive: true },
  );
}

await writeFile(
  join(runtimeAppDirectory, "package.json"),
  `${JSON.stringify(
    {
      name: "focus-familiar",
      productName: "Focus Familiar",
      version: "0.1.0",
      private: true,
      type: "module",
      main: "out/main/index.js",
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o644 },
);

await mkdir(runtimeNativeDirectory, { recursive: true });
await cp(nativeHelperSource, nativeHelperTarget);
await chmod(nativeHelperTarget, 0o755);

await patchInfoPlist(join(appBundle, "Contents", "Info.plist"));
await assertPackageLayout();

if (signingMode.mode === "notarized") {
  console.log("Applying a hardened Developer ID signature…");
  await sign({
    app: appBundle,
    identity: signingMode.identity,
    platform: "darwin",
    identityValidation: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    optionsForFile: (filePath) => {
      if (filePath === nativeHelperTarget) {
        return { entitlements: nativeHelperEntitlements };
      }
      if (
        filePath.includes("(Plugin).app") ||
        filePath.includes("(GPU).app") ||
        filePath.includes("(Renderer).app")
      ) {
        // These Chromium helpers need @electron/osx-sign's narrowly scoped
        // built-in runtime entitlements.
        return null;
      }
      return { entitlements: mainEntitlements };
    },
  });

  console.log("Submitting to Apple notarization and stapling the ticket…");
  await notarize({
    appPath: appBundle,
    keychainProfile: signingMode.keychainProfile,
  });
  await runCommand("/usr/bin/xcrun", ["stapler", "validate", appBundle]);
  await runCommand("/usr/sbin/spctl", [
    "--assess",
    "--type",
    "execute",
    "--verbose=4",
    appBundle,
  ]);
} else {
  // Re-sign the helper before signing the containing app. This path is only
  // for local prototype testing; downloaded builds will trigger Gatekeeper.
  console.warn(
    "Applying an ad-hoc signature. Do not publish this archive as a trusted macOS release.",
  );
  await runCommand("/usr/bin/codesign", [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    nativeHelperTarget,
  ]);
  await runCommand("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--timestamp=none",
    appBundle,
  ]);
}

await runCommand("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  appBundle,
]);

console.log("Creating the distributable archive…");
await runCommand("/usr/bin/ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  appBundle,
  archivePath,
]);

const checksum = await sha256(archivePath);
await writeFile(
  checksumPath,
  `${checksum}  ${basename(archivePath)}\n`,
  "utf8",
);

console.log(`Packaged ${appBundle}`);
console.log(`Archive: ${archivePath}`);
console.log(`SHA-256: ${checksumPath}`);

async function assertDirectory(path, description) {
  try {
    if (!(await lstat(path)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch (error) {
    throw new Error(`Missing ${description} at ${path}.`, { cause: error });
  }
}

async function assertExecutable(path, description) {
  try {
    const stats = await lstat(path);
    if (!stats.isFile()) throw new Error("not a regular file");
    await access(path, constants.X_OK);
  } catch (error) {
    throw new Error(`Missing or non-executable ${description} at ${path}.`, {
      cause: error,
    });
  }
}

async function assertArm64Binary(path, description) {
  let stdout;
  try {
    ({ stdout } = await execFile("/usr/bin/file", [path]));
  } catch (error) {
    throw new Error(`Could not inspect ${description} at ${path}.`, {
      cause: error,
    });
  }
  if (!/\barm64\b/.test(stdout)) {
    throw new Error(`${description} is not an arm64 Mach-O binary: ${stdout}`);
  }
}

async function patchInfoPlist(path) {
  const replacements = [
    ["CFBundleExecutable", packagedExecutableName],
    ["CFBundleDisplayName", "Focus Familiar"],
    ["CFBundleName", "Focus Familiar"],
    ["CFBundleIdentifier", "com.chiyanz.focusfamiliar"],
    ["CFBundleShortVersionString", "0.1.0"],
    ["CFBundleVersion", "0.1.0"],
    ["LSApplicationCategoryType", "public.app-category.productivity"],
    ["LSMinimumSystemVersion", "13.0"],
  ];
  for (const [key, value] of replacements) {
    await runCommand("/usr/bin/plutil", [
      "-replace",
      key,
      "-string",
      value,
      path,
    ]);
  }

  // Electron's template advertises capabilities this app does not use. It
  // also has an asar-integrity entry for default_app.asar, which is removed
  // above because this package loads its own Resources/app directory.
  for (const key of [
    "ElectronAsarIntegrity",
    "NSAppTransportSecurity",
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    await removePlistKeyIfPresent(key, path);
  }
}

async function removePlistKeyIfPresent(key, path) {
  try {
    await runCommand("/usr/bin/plutil", ["-remove", key, path]);
  } catch {
    // plutil returns non-zero when a key is absent. Confirm the plist still
    // parses before treating that expected case as harmless.
    try {
      await runCommand("/usr/bin/plutil", ["-lint", path], { stdio: "ignore" });
    } catch (lintError) {
      throw new Error(`Could not update Info.plist at ${path}.`, {
        cause: lintError,
      });
    }
  }
}

async function assertPackageLayout() {
  await assertDirectory(appBundle, "the generated Focus Familiar.app");
  await assertExecutable(
    join(appBundle, "Contents", "MacOS", packagedExecutableName),
    "the packaged Electron executable",
  );
  await assertDirectory(runtimeAppDirectory, "the packaged app directory");
  await assertFile(
    join(runtimeAppDirectory, "out", "main", "index.js"),
    "the packaged main entrypoint",
  );
  await assertFile(
    join(runtimeAppDirectory, "out", "preload", "index.cjs"),
    "the packaged preload entrypoint",
  );
  await assertExecutable(nativeHelperTarget, "the packaged activity helper");
  try {
    await access(defaultAppAsar);
  } catch {
    return;
  }
  throw new Error(
    `The default Electron app archive was not removed: ${defaultAppAsar}`,
  );
}

async function assertFile(path, description) {
  try {
    if (!(await lstat(path)).isFile()) throw new Error("not a regular file");
  } catch (error) {
    throw new Error(`Missing ${description} at ${path}.`, { cause: error });
  }
}

async function runCommand(command, arguments_, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectDirectory,
      stdio: options.stdio ?? "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${arguments_.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${String(code)}`
          }.`,
        ),
      );
    });
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}
