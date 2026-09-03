import {
  createDefaultSettings,
  createInterruptedSessionRecovery,
  parseSettings,
  restorePausedRecovery,
  type PetWindowPlacement,
  type FocusSessionState,
  type SettingsDocument,
  type SettingsPreferences,
} from "../core";
import type {
  SettingsRepositoryLoadResult,
  SettingsRepositorySaveResult,
} from "./settings-repository";

export type SessionPreferenceUpdate = Pick<
  SettingsPreferences,
  | "taskDraft"
  | "targetApplication"
  | "durationMs"
  | "gracePeriodMs"
  | "interventionAfterMs"
  | "intensity"
>;

/** The pet-window preferences needed by the main-process window manager. */
export interface PetWindowPreferences {
  readonly petWindowSize: number;
  readonly petWindowPlacement: PetWindowPlacement | null;
}

export interface LocalSettingsRepository {
  readonly load: () => Promise<SettingsRepositoryLoadResult>;
  readonly save: (input: unknown) => Promise<SettingsRepositorySaveResult>;
}

/**
 * Owns the in-memory settings snapshot and serializes every disk mutation.
 *
 * Session preferences and recovery checkpoints may arrive close together. By
 * deriving each write from the latest successful snapshot inside one queue,
 * neither path can accidentally overwrite a newer value from the other.
 */
export class LocalSettingsService {
  private settings: SettingsDocument = createDefaultSettings();
  private mutationQueue: Promise<void> = Promise.resolve();
  private writable = true;

  constructor(private readonly repository: LocalSettingsRepository) {}

  async load(): Promise<SettingsRepositoryLoadResult> {
    const loaded = await this.repository.load();
    this.settings = loaded.settings;
    this.writable = !loaded.issues.some(
      ({ code }) => code === "unsupported-schema-version",
    );
    return loaded;
  }

  sessionPreferences(): SessionPreferenceUpdate {
    const preferences = this.settings.preferences;
    return {
      taskDraft: preferences.taskDraft,
      targetApplication: preferences.targetApplication
        ? { ...preferences.targetApplication }
        : null,
      durationMs: preferences.durationMs,
      gracePeriodMs: preferences.gracePeriodMs,
      interventionAfterMs: preferences.interventionAfterMs,
      intensity: preferences.intensity,
    };
  }

  /** Return a defensive snapshot of the persisted pet-window preferences. */
  petWindowPreferences(): PetWindowPreferences {
    const preferences = this.settings.preferences;
    return {
      petWindowSize: preferences.petWindowSize,
      petWindowPlacement: preferences.petWindowPlacement
        ? { ...preferences.petWindowPlacement }
        : null,
    };
  }

  updateSessionPreferences(
    update: SessionPreferenceUpdate,
  ): Promise<SettingsRepositorySaveResult> {
    if (!this.writable) return Promise.resolve(this.readOnlyResult());
    return this.enqueue(async () => {
      const next: SettingsDocument = {
        ...this.settings,
        preferences: {
          ...this.settings.preferences,
          taskDraft: update.taskDraft,
          targetApplication: update.targetApplication
            ? { ...update.targetApplication }
            : null,
          durationMs: update.durationMs,
          gracePeriodMs: update.gracePeriodMs,
          interventionAfterMs: update.interventionAfterMs,
          intensity: update.intensity,
        },
      };
      return this.save(next);
    });
  }

  updatePetWindowSize(
    petWindowSize: number,
  ): Promise<SettingsRepositorySaveResult> {
    if (!this.writable) return Promise.resolve(this.readOnlyResult());
    return this.enqueue(async () => {
      const next: SettingsDocument = {
        ...this.settings,
        preferences: {
          ...this.settings.preferences,
          petWindowSize,
        },
      };
      return this.save(next);
    });
  }

  updatePetWindowPlacement(
    petWindowPlacement: PetWindowPlacement | null,
  ): Promise<SettingsRepositorySaveResult> {
    if (!this.writable) return Promise.resolve(this.readOnlyResult());
    const requestedPlacement = petWindowPlacement
      ? { ...petWindowPlacement }
      : null;
    return this.enqueue(async () => {
      const next: SettingsDocument = {
        ...this.settings,
        preferences: {
          ...this.settings.preferences,
          petWindowPlacement: requestedPlacement
            ? { ...requestedPlacement }
            : null,
        },
      };
      return this.save(next);
    });
  }

  checkpointSession(
    state: FocusSessionState,
    savedAtMs: number,
  ): Promise<SettingsRepositorySaveResult> {
    if (!this.writable) return Promise.resolve(this.readOnlyResult());
    return this.enqueue(async () => {
      const next: SettingsDocument = {
        ...this.settings,
        recovery: createInterruptedSessionRecovery(state, savedAtMs),
      };
      return this.save(next);
    });
  }

  /** Wait until all writes requested before this call have settled. */
  async flush(): Promise<void> {
    await this.mutationQueue;
  }

  private async save(
    next: SettingsDocument,
  ): Promise<SettingsRepositorySaveResult> {
    // Re-validate before calling the repository so an injected repository (or
    // a future implementation) cannot persist an invalid pet-window value.
    // The repository repeats this boundary check before writing to disk.
    const parsed = parseSettings(next);
    if (parsed.issues.length > 0) {
      return {
        ok: false,
        settings: this.settings,
        restoredRecovery: restorePausedRecovery(this.settings.recovery),
        issues: parsed.issues,
        error: {
          code: "settings-validation-failed",
          message: "Settings were not saved because validation failed.",
        },
      };
    }

    const result = await this.repository.save(parsed.settings);
    if (result.ok) this.settings = result.settings;
    return result;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private readOnlyResult(): SettingsRepositorySaveResult {
    return {
      ok: false,
      settings: this.settings,
      restoredRecovery: restorePausedRecovery(this.settings.recovery),
      issues: [
        {
          code: "unsupported-schema-version",
          message:
            "Settings were created by a newer Focus Familiar version and were left unchanged.",
          path: "schemaVersion",
        },
      ],
      error: {
        code: "settings-validation-failed",
        message:
          "Local settings are read-only because they belong to a newer Focus Familiar version.",
      },
    };
  }
}
