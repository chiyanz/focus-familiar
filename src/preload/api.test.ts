import { describe, expect, it, vi } from "vitest";

import { createPreloadApi, type PreloadInvoker } from "./api";

describe("preload API", () => {
  it("exposes only the documented renderer operations", async () => {
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async (channel) => {
      if (channel === "app:get-info") {
        return { name: "Focus Familiar", version: "0.1.0", platform: "darwin" };
      }

      return undefined;
    });
    const api = createPreloadApi({ invoke });

    expect(Object.keys(api)).toEqual(["getAppInfo", "requestWindowAction"]);
    await expect(api.getAppInfo()).resolves.toEqual({
      name: "Focus Familiar",
      version: "0.1.0",
      platform: "darwin",
    });
    await api.requestWindowAction("show-settings");
    expect(invoke).toHaveBeenNthCalledWith(1, "app:get-info");
    expect(invoke).toHaveBeenNthCalledWith(2, "window:action", "show-settings");
  });

  it("rejects runtime values that are outside the action contract", async () => {
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async () => undefined);
    const api = createPreloadApi({ invoke });

    await expect(
      api.requestWindowAction("run-shell-command" as never),
    ).rejects.toThrow("Unknown window action.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed responses from the privileged process", async () => {
    const invoke = vi.fn<PreloadInvoker["invoke"]>(async () => ({
      name: "Focus Familiar",
    }));
    const api = createPreloadApi({ invoke });

    await expect(api.getAppInfo()).rejects.toThrow(
      "Malformed app information.",
    );
  });
});
