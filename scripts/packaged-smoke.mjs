import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const appBundle = join(projectDirectory, "release", "Focus Familiar.app");
const appExecutable = join(appBundle, "Contents", "MacOS", "Focus Familiar");
const userDataDirectory = await mkdtemp(
  join(tmpdir(), "focus-familiar-packaged-smoke-"),
);

if (process.platform !== "darwin" || process.arch !== "arm64") {
  await rm(userDataDirectory, { recursive: true, force: true });
  throw new Error(
    "The packaged prototype smoke test requires an Apple Silicon Mac (darwin arm64).",
  );
}

const outputChunks = [];
let timedOut = false;
let spawnError;
let child;

try {
  child = spawn(
    appExecutable,
    ["--smoke-test", `--user-data-dir=${userDataDirectory}`],
    {
      cwd: projectDirectory,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => outputChunks.push(chunk));
  child.stderr.on("data", (chunk) => outputChunks.push(chunk));
  child.once("error", (error) => {
    spawnError = error;
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    child?.kill("SIGKILL");
  }, 45_000);
  const result = await new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);

  const output = Buffer.concat(outputChunks).toString("utf8");
  if (
    timedOut ||
    spawnError ||
    result.code !== 0 ||
    !output.includes("FOCUS_FAMILIAR_SMOKE_READY")
  ) {
    console.error(output);
    const detail = spawnError
      ? `spawn error: ${spawnError.message}`
      : timedOut
        ? "timed out after 45 seconds"
        : `exit ${String(result.code)}${result.signal ? ` (${result.signal})` : ""}`;
    throw new Error(`Packaged Electron smoke test failed: ${detail}.`);
  }
  console.log("Packaged Electron smoke test passed.");
} finally {
  if (child && !child.killed && child.exitCode === null) {
    child.kill("SIGKILL");
  }
  await rm(userDataDirectory, { recursive: true, force: true });
}
