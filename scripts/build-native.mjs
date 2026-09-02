import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

if (process.platform !== "darwin") {
  console.log("Skipping the macOS native helper build on this platform.");
  process.exit(0);
}

const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);
const outputPath = resolve(
  outputArgument?.slice("--output=".length) ??
    "native/macos/.build/focus-familiar-activity",
);
const sourcePath = resolve("native/macos/FocusFamiliarActivity/main.swift");
const targetArchitecture =
  process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : null;
if (!targetArchitecture) {
  throw new Error(`Unsupported macOS build architecture: ${process.arch}.`);
}

await mkdir(dirname(outputPath), { recursive: true });

const compiler = spawn(
  "xcrun",
  [
    "swiftc",
    "-swift-version",
    "6",
    "-target",
    `${targetArchitecture}-apple-macosx13.0`,
    "-O",
    "-parse-as-library",
    sourcePath,
    "-o",
    outputPath,
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
  },
);

const exitCode = await new Promise((resolveExit) =>
  compiler.once("exit", resolveExit),
);
if (exitCode !== 0) {
  throw new Error(
    `Swift helper compilation failed with exit code ${String(exitCode)}.`,
  );
}

console.log(`Built macOS activity helper at ${outputPath}.`);
