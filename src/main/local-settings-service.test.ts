import { describe, expect, it } from "vitest";

import {
  createDefaultSettings,
  createIdleSession,
  PET_WINDOW_SIZE_DEFAULT,
  PET_WINDOW_SIZE_MAX,
  PET_WINDOW_SIZE_MIN,
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
  it("reads pet preferences with a defensive placement copy", async () => {
    const repository = new FakeRepository();
    repository.stored = {
      ...repository.stored,
      preferences: {
        ...repository.stored.preferences,
        petWindowSize: 320,
        petWindowPlacement: { displayId: "main", x: 40, y: 80 },
      },
    };
    const service = new LocalSettingsService(repository);
    await service.load();

    const first = service.petWindowPreferences();
    const second = service.petWindowPreferences();

    expect(first).toEqual({
      petWindowSize: 320,
      petWindowPlacement: { displayId: "main", x: 40, y: 80 },
    });
    expect(first).not.toBe(second);
    expect(first.petWindowPlacement).not.toBe(second.petWindowPlacement);
    if (!first.petWindowPlacement) throw new Error("expected placement");
    (first.petWindowPlacement as { x: number }).x = 999;
    expect(service.petWindowPreferences().petWindowPlacement?.x).toBe(40);
  });

  it.each([PET_WINDOW_SIZE_MIN, PET_WINDOW_SIZE_DEFAULT, PET_WINDOW_SIZE_MAX])(
    "persists supported pet size %d",
    async (petWindowSize) => {
      const repository = new FakeRepository();
      const service = new LocalSettingsService(repository);
      await service.load();

      const result = await service.updatePetWindowSize(petWindowSize);

      expect(result).toMatchObject({ ok: true });
      expect(service.petWindowPreferences().petWindowSize).toBe(petWindowSize);
      expect(repository.stored.preferences.petWindowSize).toBe(petWindowSize);
    },
  );

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    PET_WINDOW_SIZE_MIN - 1,
    PET_WINDOW_SIZE_MAX + 1,
    248.5,
    "320",
    null,
  ])("rejects invalid pet size %j without writing", async (petWindowSize) => {
    const repository = new FakeRepository();
    const service = new LocalSettingsService(repository);
    await service.load();

    const result = await service.updatePetWindowSize(petWindowSize as number);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "settings-validation-failed" },
    });
    expect(repository.writes).toHaveLength(0);
    expect(service.petWindowPreferences().petWindowSize).toBe(
      PET_WINDOW_SIZE_DEFAULT,
    );
  });

  it("serializes size and placement writes while preserving both updates", async () => {
    const repository = new FakeRepository();
    const service = new LocalSettingsService(repository);
    await service.load();
    const placement = { displayId: "main", x: 40, y: 80 };

    const sizeWrite = service.updatePetWindowSize(360);
    const placementWrite = service.updatePetWindowPlacement(placement);
    placement.x = 999;
    placement.y = 999;
    await Promise.all([sizeWrite, placementWrite]);

    expect(repository.writes).toHaveLength(2);
    expect(repository.stored.preferences.petWindowSize).toBe(360);
    expect(repository.stored.preferences.petWindowPlacement).toEqual({
      displayId: "main",
      x: 40,
      y: 80,
    });
    expect(service.petWindowPreferences()).toEqual({
      petWindowSize: 360,
      petWindowPlacement: { displayId: "main", x: 40, y: 80 },
    });
  });

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
