import { describe, expect, it } from "vitest";

import {
  IPC_CHANNELS,
  WINDOW_ACTIONS,
  isWindowAction,
  parseAppInfo,
  parseWindowAction,
  toAppPlatform,
} from "./ipc";

describe("IPC contracts", () => {
  it("keeps the channel allow-list explicit", () => {
    expect(IPC_CHANNELS).toEqual({
      getAppInfo: "app:get-info",
      windowAction: "window:action",
    });
    expect(WINDOW_ACTIONS).toEqual([
      "show-settings",
      "hide-settings",
      "show-pet",
      "quit",
    ]);
  });

  it("accepts only documented window actions", () => {
    expect(isWindowAction("show-settings")).toBe(true);
    expect(isWindowAction("run-shell-command")).toBe(false);
    expect(isWindowAction({ action: "show-settings" })).toBe(false);
    expect(parseWindowAction("quit")).toBe("quit");
    expect(() => parseWindowAction("run-shell-command")).toThrow(
      "Unknown window action.",
    );
  });

  it("validates app information at the IPC boundary", () => {
    expect(
      parseAppInfo({
        name: "Focus Familiar",
        version: "0.1.0",
        platform: "darwin",
      }),
    ).toEqual({ name: "Focus Familiar", version: "0.1.0", platform: "darwin" });
    expect(() => parseAppInfo({ name: "Focus Familiar" })).toThrow(
      "Malformed app information.",
    );
    expect(() => parseAppInfo(null)).toThrow("Malformed app information.");
  });

  it("normalizes unsupported host platforms", () => {
    expect(toAppPlatform("darwin")).toBe("darwin");
    expect(toAppPlatform("freebsd")).toBe("other");
  });
});
