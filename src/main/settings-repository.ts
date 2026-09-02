import { isAbsolute, join } from "node:path";

import {
  createDefaultSettings,
  parseSettings,
  restorePausedRecovery,
  type PausedSessionRecovery,
  type SettingsDocument,
  type SettingsIssue,
} from "../core";
import {
  AtomicJsonStore,
  type AtomicJsonIssue,
  type AtomicJsonMutationResult,
  type AtomicJsonStoreError,
} from "./atomic-json-store";

export const SETTINGS_FILE_NAME = "focus-familiar.json";

export type SettingsRepositoryIssue = SettingsIssue | AtomicJsonIssue;

export interface SettingsRepositorySnapshot {
  readonly settings: SettingsDocument;
  readonly restoredRecovery: PausedSessionRecovery | null;
  readonly source: "file" | "defaults" | "unavailable";
  readonly issues: readonly SettingsRepositoryIssue[];
}

export type SettingsRepositoryLoadResult =
  | ({ readonly ok: true } & SettingsRepositorySnapshot)
  | ({
      readonly ok: false;
      readonly error: AtomicJsonStoreError;
    } & SettingsRepositorySnapshot);

export type SettingsRepositorySaveResult =
  | {
      readonly ok: true;
      readonly settings: SettingsDocument;
      readonly restoredRecovery: PausedSessionRecovery | null;
    }
  | {
      readonly ok: false;
      readonly settings: SettingsDocument;
      readonly restoredRecovery: PausedSessionRecovery | null;
      readonly issues: readonly SettingsIssue[];
      readonly error:
        | AtomicJsonStoreError
        | {
            readonly code: "settings-validation-failed";
            readonly message: string;
          };
    };

/** Resolve settings only beneath Electron's absolute per-user data directory. */
export function resolveSettingsFilePath(userDataDirectory: string): string {
  if (typeof userDataDirectory !== "string") {
    throw new TypeError("An absolute user-data directory is required.");
  }
  const normalized = userDataDirectory.trim();
  if (!isAbsolute(normalized)) {
    throw new TypeError("An absolute user-data directory is required.");
  }
  return join(normalized, SETTINGS_FILE_NAME);
}

/**
 * Composes the pure settings schema with the generic atomic file store.
 * Untrusted writes are sanitized and rejected on validation issues before any
 * existing document can be replaced.
 */
export class SettingsRepository {
  private readonly store: AtomicJsonStore<SettingsDocument>;

  constructor(filePath: string) {
    this.store = new AtomicJsonStore(filePath, {
      defaults: createDefaultSettings,
      parse: (input) => {
        const parsed = parseSettings(input);
        return { value: parsed.settings, issues: parsed.issues };
      },
    });
  }

  async load(): Promise<SettingsRepositoryLoadResult> {
    const loaded = await this.store.load();
    if (loaded.source === "unavailable") {
      return {
        ok: false,
        settings: createDefaultSettings(),
        restoredRecovery: null,
        source: "unavailable",
        issues: loaded.issues,
        error: loaded.error,
      };
    }

    const snapshot: SettingsRepositorySnapshot = {
      settings: loaded.value,
      restoredRecovery: restorePausedRecovery(loaded.value.recovery),
      source: loaded.source,
      issues: loaded.issues,
    };
    return loaded.ok
      ? { ok: true, ...snapshot }
      : { ok: false, ...snapshot, error: loaded.error };
  }

  async save(input: unknown): Promise<SettingsRepositorySaveResult> {
    const parsed = parseSettings(input);
    if (parsed.issues.length > 0) {
      return {
        ok: false,
        settings: parsed.settings,
        restoredRecovery: parsed.restoredRecovery,
        issues: parsed.issues,
        error: {
          code: "settings-validation-failed",
          message: "Settings were not saved because validation failed.",
        },
      };
    }

    const saved = await this.store.save(parsed.settings);
    return saved.ok
      ? {
          ok: true,
          settings: parsed.settings,
          restoredRecovery: parsed.restoredRecovery,
        }
      : {
          ok: false,
          settings: parsed.settings,
          restoredRecovery: parsed.restoredRecovery,
          issues: [],
          error: saved.error,
        };
  }

  reset(): Promise<AtomicJsonMutationResult> {
    return this.store.reset();
  }

  delete(): Promise<AtomicJsonMutationResult> {
    return this.store.delete();
  }
}
