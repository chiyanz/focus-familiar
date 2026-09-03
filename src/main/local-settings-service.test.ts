import { describe, expect, it } from "vitest";

import {
  createDefaultSettings,
  createIdleSession,
  reduceSession,
  type FocusSessionConfig,
  type SettingsDocument,
} from "../core";
import {
  LocalSettingsService,
  type LocalSettingsRepository,
} from "./local-settings-service";
import type {
  SettingsRepositoryLoadResult,
  SettingsRepositorySaveResult,
} from "./settings-repository";

const editor = { bundleId: "com.example.Editor", name: "Editor" };
const config: FocusSessionConfig = {
  task: "Persist the prototype",
  targetApplication: editor,
  durationMs: 60_000,
  gracePeriodMs: 1_000,
  interventionAfterMs: 3_000,
  intensity: "balanced",
};

class FakeRepository implements LocalSettingsRepository {
  stored = createDefaultSettings();
  readonly writes: SettingsDocument[] = [];

  async load(): Promise<SettingsRepositoryLoadResult> {
    return {
      ok: true,
      settings: this.stored,
      restoredRecovery: null,
      source: "defaults",
      issues: [],
    };
  }

  async save(input: unknown): Promise<SettingsRepositorySaveResult> {
    const settings = structuredClone(input) as SettingsDocument;
    this.writes.push(settings);
    this.stored = settings;
    await Promise.resolve();
    return { ok: true, settings, restoredRecovery: null };
  }
}

describe("local settings service", () => {
  it("updates only session preferences and returns defensive target copies", async () => {
    const repository = new FakeRepository();
    const service = new LocalSettingsService(repository);
    await service.load();

    await service.updateSessionPreferences({
      taskDraft: "Write the release notes",
      targetApplication: editor,
      durationMs: 90_000,
      gracePeriodMs: 2_000,
      interventionAfterMs: 5_000,
      intensity: "strict",
    });

    expect(repository.stored.preferences).toMatchObject({
      taskDraft: "Write the release notes",
      targetApplication: editor,
      durationMs: 90_000,
      soundEnabled: true,
      motionPreference: "system",
    });
    const first = service.sessionPreferences();
    const second = service.sessionPreferences();
    expect(first).toEqual(second);
    expect(first.targetApplication).not.toBe(second.targetApplication);
  });

  it("serializes preference and recovery writes without losing either", async () => {
    const repository = new FakeRepository();
    const service = new LocalSettingsService(repository);
    await service.load();
    const started = reduceSession(createIdleSession(), {
      type: "session-started",
      atMs: 10,
      sessionId: "session-1",
      config,
      currentApplication: editor,
    });
    if (!started.ok) throw new Error(started.error.message);

    const preferenceWrite = service.updateSessionPreferences({
      taskDraft: config.task,
      targetApplication: editor,
      durationMs: config.durationMs,
      gracePeriodMs: config.gracePeriodMs,
      interventionAfterMs: config.interventionAfterMs,
      intensity: config.intensity,
    });
    const checkpointWrite = service.checkpointSession(started.state, 20);
    await Promise.all([preferenceWrite, checkpointWrite]);

    expect(repository.writes).toHaveLength(2);
    expect(repository.stored.preferences.taskDraft).toBe(config.task);
    expect(repository.stored.recovery).toMatchObject({
      sessionId: "session-1",
      focusedMs: 0,
      savedAtMs: 20,
    });
  });

  it("clears recovery after a terminal session and flushes queued writes", async () => {
    const repository = new FakeRepository();
    const service = new LocalSettingsService(repository);
    await service.load();
    const started = reduceSession(createIdleSession(), {
      type: "session-started",
      atMs: 10,
      sessionId: "session-1",
      config,
      currentApplication: editor,
    });
    if (!started.ok) throw new Error(started.error.message);
    await service.checkpointSession(started.state, 10);
    const stopped = reduceSession(started.state, {
      type: "session-stopped",
      atMs: 20,
      reason: "user",
    });
    if (!stopped.ok) throw new Error(stopped.error.message);

    void service.checkpointSession(stopped.state, 20);
    await service.flush();

    expect(repository.stored.recovery).toBeNull();
  });

  it("never overwrites settings created by a newer app version", async () => {
    const repository = new FakeRepository();
    repository.load = async () => ({
      ok: true,
      settings: createDefaultSettings(),
      restoredRecovery: null,
      source: "file",
      issues: [
        {
          code: "unsupported-schema-version",
          message: "A newer schema is present.",
        },
      ],
    });
    const service = new LocalSettingsService(repository);
    await service.load();

    const preferenceResult = await service.updateSessionPreferences({
      taskDraft: config.task,
      targetApplication: editor,
      durationMs: config.durationMs,
      gracePeriodMs: config.gracePeriodMs,
      interventionAfterMs: config.interventionAfterMs,
      intensity: config.intensity,
    });
    const checkpointResult = await service.checkpointSession(
      createIdleSession(),
      20,
    );

    expect(preferenceResult).toMatchObject({
      ok: false,
      error: { code: "settings-validation-failed" },
    });
    expect(checkpointResult).toMatchObject({
      ok: false,
      error: { code: "settings-validation-failed" },
    });
    expect(repository.writes).toHaveLength(0);
  });
});
