import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const electronBinary = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);
const userDataDirectory = await mkdtemp(
  join(tmpdir(), "focus-familiar-smoke-"),
);
if (process.platform === "darwin") {
  const recoveryConfig = {
    task: "Recover the smoke session",
    targetApplication: {
      bundleId: "com.example.RecoveredEditor",
      name: "Recovered Editor",
    },
    durationMs: 60_000,
    gracePeriodMs: 1_000,
    interventionAfterMs: 3_000,
    intensity: "balanced",
  };
  await writeFile(
    join(userDataDirectory, "focus-familiar.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      preferences: {
        taskDraft: "Recovered smoke draft",
        targetApplication: recoveryConfig.targetApplication,
        durationMs: recoveryConfig.durationMs,
        gracePeriodMs: recoveryConfig.gracePeriodMs,
        interventionAfterMs: recoveryConfig.interventionAfterMs,
        intensity: recoveryConfig.intensity,
        soundEnabled: true,
        motionPreference: "system",
        launchAtLogin: false,
        petWindowPlacement: null,
      },
      recovery: {
        sessionId: "recovered-smoke-session",
        config: recoveryConfig,
        focusedMs: 1_234,
        awayMs: 500,
        savedAtMs: Date.now(),
      },
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}
const child = spawn(
  electronBinary,
  [
    ".",
    "--smoke-test",
    ...(process.platform === "darwin" ? ["--expect-recovery"] : []),
    `--user-data-dir=${userDataDirectory}`,
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
clearTimeout(timeout);
let quitFlushedPreferences = true;
if (process.platform === "darwin") {
  const stored = JSON.parse(
    await readFile(join(userDataDirectory, "focus-familiar.json"), "utf8"),
  );
  quitFlushedPreferences =
    stored?.preferences?.taskDraft === "Flushed during quit";
}
await rm(userDataDirectory, { recursive: true, force: true });

if (
  exitCode !== 0 ||
  !output.includes("FOCUS_FAMILIAR_SMOKE_READY") ||
  !quitFlushedPreferences
) {
  console.error(output);
  throw new Error(
    `Electron smoke test failed with exit code ${String(exitCode)}.`,
  );
}

console.log("Electron smoke test passed.");
