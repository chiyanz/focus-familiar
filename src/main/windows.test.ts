import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  clampPetWindowBounds,
  getWindowOptions,
  isTrustedRendererUrl,
  joinRendererPath,
  parseLocalDevelopmentUrl,
  resizePetWindowBounds,
  resolveRendererTarget,
} from "./windows";

describe("BrowserWindow security baseline", () => {
  it.each(["pet", "settings"] as const)(
    "%s disables renderer privileges",
    (kind) => {
      const options = getWindowOptions(kind, "/app/out/preload/index.cjs");

      expect(options.webPreferences).toMatchObject({
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
        preload: "/app/out/preload/index.cjs",
      });
    },
  );

  it("keeps the pet presentation window unobtrusive and above work windows", () => {
    const options = getWindowOptions("pet", "/app/preload.js");

    expect(options).toMatchObject({
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      resizable: false,
      focusable: false,
      movable: true,
    });
  });

  it("uses a validated persisted square size for the pet window", () => {
    expect(getWindowOptions("pet", "/app/preload.js", 320)).toMatchObject({
      width: 320,
      height: 320,
      minWidth: 160,
      minHeight: 160,
      maxWidth: 480,
      maxHeight: 480,
    });
    expect(getWindowOptions("pet", "/app/preload.js", 999)).toMatchObject({
      width: 248,
      height: 248,
    });
  });

  it("keeps settings as a separate, normal-size window", () => {
    const options = getWindowOptions("settings", "/app/preload.js");

    expect(options).toMatchObject({
      frame: true,
      width: 520,
      height: 720,
    });
    expect(options).not.toHaveProperty("alwaysOnTop");
    expect(options).not.toHaveProperty("skipTaskbar");
  });
});

describe("pet window geometry", () => {
  const workArea = { x: 0, y: 24, width: 1_440, height: 876 };

  it("clamps a restored position so the whole pet remains reachable", () => {
    expect(clampPetWindowBounds(-500, 2_000, 248, workArea)).toEqual({
      x: 0,
      y: 652,
      width: 248,
      height: 248,
    });
  });

  it("resizes around the current center and stays inside the work area", () => {
    expect(
      resizePetWindowBounds(
        { x: 1_152, y: 612, width: 248, height: 248 },
        400,
        workArea,
      ),
    ).toEqual({ x: 1_040, y: 500, width: 400, height: 400 });
    expect(
      resizePetWindowBounds(
        { x: 200, y: 200, width: 248, height: 248 },
        320,
        workArea,
      ),
    ).toEqual({ x: 164, y: 164, width: 320, height: 320 });
  });
});

describe("renderer target loading", () => {
  it("uses fixed local entry points in production", () => {
    const target = resolveRendererTarget("pet", {
      rendererDirectory: "/app/out/renderer",
    });

    expect(target).toEqual({
      kind: "file",
      filePath: "/app/out/renderer/pet.html",
      url: "file:///app/out/renderer/pet.html",
    });
    expect(isTrustedRendererUrl(target.url, target)).toBe(true);
    expect(isTrustedRendererUrl("https://example.com", target)).toBe(false);
  });

  it("allows only a localhost Vite server for development", () => {
    const target = resolveRendererTarget("settings", {
      rendererDirectory: "/app/out/renderer",
      devServerUrl: "http://localhost:5173/",
    });

    expect(target).toEqual({
      kind: "dev",
      url: "http://localhost:5173/settings.html",
      origin: "http://localhost:5173",
    });
    expect(isTrustedRendererUrl("http://localhost:5173/other", target)).toBe(
      true,
    );
    expect(isTrustedRendererUrl("https://localhost:5173/other", target)).toBe(
      false,
    );
    expect(isTrustedRendererUrl("http://localhost:5174/other", target)).toBe(
      false,
    );
  });

  it("rejects non-local development URLs", () => {
    expect(() => parseLocalDevelopmentUrl("https://example.com")).toThrow(
      "must point to localhost",
    );
    expect(() => parseLocalDevelopmentUrl("file:///tmp/renderer")).toThrow(
      "must point to localhost",
    );
    expect(() => parseLocalDevelopmentUrl("not-a-url")).toThrow("invalid");
  });

  it("does not accept arbitrary renderer paths", () => {
    expect(joinRendererPath("/app/out/renderer", "pet.html")).toBe(
      "/app/out/renderer/pet.html",
    );
    expect(() =>
      joinRendererPath("/app/out/renderer", "../secret.html"),
    ).toThrow("Unknown renderer entry point");
    expect(resolve("/app/out/renderer", "pet.html")).toBe(
      "/app/out/renderer/pet.html",
    );
  });
});
