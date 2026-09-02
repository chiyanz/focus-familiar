import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
const child = spawn(
  electronBinary,
  [".", "--smoke-test", `--user-data-dir=${userDataDirectory}`],
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
await rm(userDataDirectory, { recursive: true, force: true });

if (exitCode !== 0 || !output.includes("FOCUS_FAMILIAR_SMOKE_READY")) {
  console.error(output);
  throw new Error(
    `Electron smoke test failed with exit code ${String(exitCode)}.`,
  );
}

console.log("Electron smoke test passed.");
