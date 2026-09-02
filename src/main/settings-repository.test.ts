import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultSettings, type SettingsDocument } from "../core";
import {
  resolveSettingsFilePath,
  SettingsRepository,
} from "./settings-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function repositoryFixture(): Promise<{
  readonly directory: string;
  readonly filePath: string;
  readonly repository: SettingsRepository;
}> {
  const directory = await mkdtemp(join(tmpdir(), "focus-familiar-settings-"));
  temporaryDirectories.push(directory);
  const filePath = resolveSettingsFilePath(directory);
  return {
    directory,
    filePath,
    repository: new SettingsRepository(filePath),
  };
}

function configuredSettings(): SettingsDocument {
  return {
    ...createDefaultSettings(),
    preferences: {
      ...createDefaultSettings().preferences,
      taskDraft: "Ship persistence",
      targetApplication: {
        bundleId: "com.example.Editor",
        name: "Editor",
      },
    },
  };
}

describe("settings repository path", () => {
  it("uses the exact Electron user-data directory", () => {
    expect(
      resolveSettingsFilePath("/Users/example/Library/App Support/App"),
    ).toBe("/Users/example/Library/App Support/App/focus-familiar.json");
    expect(resolveSettingsFilePath("  /tmp/focus-familiar  ")).toBe(
      "/tmp/focus-familiar/focus-familiar.json",
    );
    expect(() => resolveSettingsFilePath("relative/path")).toThrow(
      "absolute user-data",
    );
  });
});

describe("settings repository", () => {
  it("loads fresh defaults from a missing file", async () => {
    const { repository } = await repositoryFixture();

    await expect(repository.load()).resolves.toEqual({
      ok: true,
      settings: createDefaultSettings(),
      restoredRecovery: null,
      source: "defaults",
      issues: [],
    });
  });

  it("sanitizes unknown fields before saving and reloads the document", async () => {
    const { filePath, repository } = await repositoryFixture();
    const settings = configuredSettings();

    await expect(
      repository.save({
        ...settings,
        activityHistory: [{ bundleId: "com.example.Browser" }],
        preferences: { ...settings.preferences, secretWindowTitle: "private" },
      }),
    ).resolves.toMatchObject({ ok: true });

    const raw = JSON.parse(await readFile(filePath, "utf8")) as object;
    expect(raw).not.toHaveProperty("activityHistory");
    expect(raw).toHaveProperty("preferences.taskDraft", "Ship persistence");
    expect(raw).not.toHaveProperty("preferences.secretWindowTitle");
    await expect(repository.load()).resolves.toMatchObject({
      ok: true,
      settings,
      source: "file",
    });
  });

  it("rejects invalid writes without replacing the last valid document", async () => {
    const { filePath, repository } = await repositoryFixture();
    const settings = configuredSettings();
    await repository.save(settings);

    await expect(
      repository.save({
        ...settings,
        preferences: { ...settings.preferences, durationMs: 0 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "settings-validation-failed" },
    });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(settings);
  });

  it("loads migrations and returns recovery only as paused", async () => {
    const { filePath, repository } = await repositoryFixture();
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 0,
        task: "Legacy task",
        durationMinutes: 25,
        gracePeriodSeconds: 10,
        interventionAfterSeconds: 60,
        intensity: "strict",
        soundEnabled: true,
        motionPreference: "system",
        launchAtLogin: false,
        recovery: null,
      }),
      "utf8",
    );

    await expect(repository.load()).resolves.toMatchObject({
      ok: true,
      settings: {
        schemaVersion: 1,
        preferences: { taskDraft: "Legacy task", intensity: "strict" },
      },
      restoredRecovery: null,
      issues: [{ code: "migrated" }],
    });
  });

  it("falls back safely when the local file is malformed", async () => {
    const { filePath, repository } = await repositoryFixture();
    const malformed = "{bad-json";
    await writeFile(filePath, malformed, "utf8");

    await expect(repository.load()).resolves.toMatchObject({
      ok: false,
      settings: createDefaultSettings(),
      restoredRecovery: null,
      source: "defaults",
      error: { code: "invalid-json" },
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(malformed);
  });

  it("does not overwrite settings from a newer app version", async () => {
    const { filePath, repository } = await repositoryFixture();
    const future = JSON.stringify({
      schemaVersion: 99,
      preferences: { futurePreference: true },
    });
    await writeFile(filePath, future, "utf8");

    await expect(repository.load()).resolves.toMatchObject({
      ok: true,
      settings: createDefaultSettings(),
      source: "file",
      issues: [{ code: "unsupported-schema-version" }],
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(future);
  });

  it("resets and deletes local data without retaining stale values", async () => {
    const { repository } = await repositoryFixture();
    await repository.save(configuredSettings());

    await expect(repository.reset()).resolves.toEqual({ ok: true });
    await expect(repository.load()).resolves.toMatchObject({
      ok: true,
      settings: createDefaultSettings(),
      source: "file",
    });
    await expect(repository.delete()).resolves.toEqual({ ok: true });
    await expect(repository.delete()).resolves.toEqual({ ok: true });
    await expect(repository.load()).resolves.toMatchObject({
      ok: true,
      source: "defaults",
    });
  });
});
