import { describe, expect, it, vi } from "vitest";

import { createPreloadApi, type PreloadInvoker } from "./api";
import type { SessionSnapshot } from "../shared/ipc";

const validSnapshot: SessionSnapshot = {
  schemaVersion: 1,
  sessionId: null,
  phase: "idle",
  task: null,
  targetApplication: null,
  durationMs: null,
  gracePeriodMs: null,
  interventionAfterMs: null,
  intensity: null,
  focusedMs: 0,
  awayMs: 0,
  currentAwayMs: 0,
  capabilities: {
    canStart: true,
    canPause: false,
    canResume: false,
    canStop: false,
  },
};

describe("preload API", () => {
  it("exposes only the documented renderer operations", async () => {
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async (channel) => {
      if (channel === "app:get-info") {
        return { name: "Focus Familiar", version: "0.1.0", platform: "darwin" };
      }
      if (channel === "applications:list") {
        return [
          { bundleId: "com.microsoft.VSCode", name: "Visual Studio Code" },
        ];
      }

      return validSnapshot;
    });
    const on = vi.fn<PreloadInvoker["on"]>(() => () => undefined);
    const api = createPreloadApi({ invoke, on });

    expect(Object.keys(api)).toEqual([
      "getAppInfo",
      "requestWindowAction",
      "listApplications",
      "getSessionSnapshot",
      "startSession",
      "requestSessionAction",
      "onSessionChanged",
    ]);
    await expect(api.getAppInfo()).resolves.toEqual({
      name: "Focus Familiar",
      version: "0.1.0",
      platform: "darwin",
    });
    await api.requestWindowAction("show-settings");
    await expect(api.listApplications()).resolves.toEqual([
      { bundleId: "com.microsoft.VSCode", name: "Visual Studio Code" },
    ]);
    await expect(api.getSessionSnapshot()).resolves.toEqual(validSnapshot);
    await expect(
      api.startSession({
        task: "Build the prototype",
        targetApplication: {
          bundleId: "com.microsoft.VSCode",
          name: "Visual Studio Code",
        },
        durationMs: 25 * 60 * 1000,
        gracePeriodMs: 20 * 1000,
        interventionAfterMs: 90 * 1000,
        intensity: "balanced",
      }),
    ).resolves.toEqual(validSnapshot);
    await expect(api.requestSessionAction("pause")).resolves.toEqual(
      validSnapshot,
    );
    expect(invoke).toHaveBeenNthCalledWith(1, "app:get-info");
    expect(invoke).toHaveBeenNthCalledWith(2, "window:action", "show-settings");
    expect(invoke).toHaveBeenNthCalledWith(3, "applications:list");
    expect(invoke).toHaveBeenNthCalledWith(4, "session:get");
    expect(invoke).toHaveBeenNthCalledWith(5, "session:start", {
      task: "Build the prototype",
      targetApplication: {
        bundleId: "com.microsoft.VSCode",
        name: "Visual Studio Code",
      },
      durationMs: 25 * 60 * 1000,
      gracePeriodMs: 20 * 1000,
      interventionAfterMs: 90 * 1000,
      intensity: "balanced",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "session:action", "pause");
    expect(on).not.toHaveBeenCalled();
  });

  it("rejects runtime values that are outside the action contract", async () => {
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async () => undefined);
    const on = vi.fn<PreloadInvoker["on"]>(() => () => undefined);
    const api = createPreloadApi({ invoke, on });

    await expect(
      api.requestWindowAction("run-shell-command" as never),
    ).rejects.toThrow("Unknown window action.");
    await expect(
      api.requestSessionAction("run-shell-command" as never),
    ).rejects.toThrow("Unknown session action.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed responses from the privileged process", async () => {
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async () => ({
      name: "Focus Familiar",
    }));
    const on = vi.fn<PreloadInvoker["on"]>(() => () => undefined);
    const api = createPreloadApi({ invoke, on });

    await expect(api.getAppInfo()).rejects.toThrow(
      "Malformed app information.",
    );
    await expect(api.listApplications()).rejects.toThrow(
      "Malformed application list.",
    );
    await expect(api.getSessionSnapshot()).rejects.toThrow(
      "Malformed session snapshot.",
    );
  });

  it("validates start configuration before crossing the bridge", async () => {
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async () => validSnapshot);
    const on = vi.fn<PreloadInvoker["on"]>(() => () => undefined);
    const api = createPreloadApi({ invoke, on });

    await expect(
      api.startSession({
        task: " ",
        targetApplication: {
          bundleId: "com.app",
          name: "App",
        },
        durationMs: 1,
        gracePeriodMs: 0,
        interventionAfterMs: 1,
        intensity: "gentle",
      }),
    ).rejects.toThrow("Task must be a non-empty string.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("parses session change events and returns an unsubscribe function", () => {
    let callback: ((payload: unknown) => void) | undefined;
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async () => validSnapshot);
    const on = vi.fn<PreloadInvoker["on"]>((channel, listener) => {
      expect(channel).toBe("session:changed");
      callback = listener;
      return () => undefined;
    });
    const api = createPreloadApi({ invoke, on });
    const listener = vi.fn<(snapshot: SessionSnapshot) => void>();

    const unsubscribe = api.onSessionChanged(listener);
    expect(on).toHaveBeenCalledOnce();
    callback?.({
      ...validSnapshot,
      sessionId: "session-1",
      phase: "focused",
      task: "Build the prototype",
      targetApplication: {
        bundleId: "com.microsoft.VSCode",
        name: "Visual Studio Code",
      },
      durationMs: 1000,
      gracePeriodMs: 100,
      interventionAfterMs: 500,
      intensity: "balanced",
      capabilities: {
        canStart: false,
        canPause: true,
        canResume: false,
        canStop: true,
      },
    });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "focused" }),
    );
    expect(typeof unsubscribe).toBe("function");
  });

  it("rejects malformed session change events", () => {
    let callback: ((payload: unknown) => void) | undefined;
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async () => validSnapshot);
    const on = vi.fn<PreloadInvoker["on"]>((_channel, listener) => {
      callback = listener;
      return () => undefined;
    });
    const api = createPreloadApi({ invoke, on });
    const listener = vi.fn<(snapshot: SessionSnapshot) => void>();

    api.onSessionChanged(listener);
    expect(() => callback?.({ phase: "unknown" })).toThrow(
      "Malformed session snapshot.",
    );
    expect(listener).not.toHaveBeenCalled();
  });
});
