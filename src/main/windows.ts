import { pathToFileURL } from "node:url";

import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

import {
  PET_WINDOW_SIZE_DEFAULT,
  PET_WINDOW_SIZE_MAX,
  PET_WINDOW_SIZE_MIN,
} from "../core/settings";

export type WindowKind = "pet" | "settings";

export interface RendererPaths {
  readonly rendererDirectory: string;
  readonly devServerUrl?: string;
}

export interface WindowRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type RendererTarget =
  | {
      readonly kind: "dev";
      readonly url: string;
      readonly origin: string;
    }
  | {
      readonly kind: "file";
      readonly filePath: string;
      readonly url: string;
    };

const PET_RENDERER_FILE = "pet.html";
const SETTINGS_RENDERER_FILE = "settings.html";
const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getWindowOptions(
  kind: WindowKind,
  preloadPath: string,
  petWindowSize = PET_WINDOW_SIZE_DEFAULT,
): BrowserWindowConstructorOptions {
  const secureWebPreferences = {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    allowRunningInsecureContent: false,
    devTools: !process.env.CI,
  };

  if (kind === "pet") {
    const size = normalizePetWindowSize(petWindowSize);
    return {
      width: size,
      height: size,
      minWidth: PET_WINDOW_SIZE_MIN,
      minHeight: PET_WINDOW_SIZE_MIN,
      maxWidth: PET_WINDOW_SIZE_MAX,
      maxHeight: PET_WINDOW_SIZE_MAX,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      focusable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: secureWebPreferences,
    };
  }

  return {
    width: 520,
    height: 720,
    minWidth: 400,
    minHeight: 560,
    show: false,
    frame: true,
    title: "Focus Familiar settings",
    backgroundColor: "#fffaf5",
    resizable: true,
    webPreferences: secureWebPreferences,
  };
}

/** Keep a square pet window fully reachable inside one display work area. */
export function clampPetWindowBounds(
  x: number,
  y: number,
  size: number,
  workArea: WindowRectangle,
): WindowRectangle {
  const safeSize = normalizePetWindowSize(size);
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - safeSize);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - safeSize);

  return {
    x: clampInteger(x, workArea.x, maxX),
    y: clampInteger(y, workArea.y, maxY),
    width: safeSize,
    height: safeSize,
  };
}

/** Resize around the pet's current center, then recover it onto the display. */
export function resizePetWindowBounds(
  currentBounds: WindowRectangle,
  size: number,
  workArea: WindowRectangle,
): WindowRectangle {
  const safeSize = normalizePetWindowSize(size);
  const centeredX =
    currentBounds.x + Math.round((currentBounds.width - safeSize) / 2);
  const centeredY =
    currentBounds.y + Math.round((currentBounds.height - safeSize) / 2);
  return clampPetWindowBounds(centeredX, centeredY, safeSize, workArea);
}

/** Translate a pet window from a pointer-drag origin, then keep it reachable. */
export function dragPetWindowBounds(
  initialBounds: WindowRectangle,
  pointerStart: ScreenPoint,
  pointerCurrent: ScreenPoint,
  workArea: WindowRectangle,
): WindowRectangle {
  return clampPetWindowBounds(
    initialBounds.x + pointerCurrent.x - pointerStart.x,
    initialBounds.y + pointerCurrent.y - pointerStart.y,
    initialBounds.width,
    workArea,
  );
}

function normalizePetWindowSize(size: number): number {
  return Number.isSafeInteger(size) &&
    size >= PET_WINDOW_SIZE_MIN &&
    size <= PET_WINDOW_SIZE_MAX
    ? size
    : PET_WINDOW_SIZE_DEFAULT;
}

function clampInteger(value: number, min: number, max: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, rounded));
}

export function resolveRendererTarget(
  kind: WindowKind,
  paths: RendererPaths,
): RendererTarget {
  const rendererFile =
    kind === "pet" ? PET_RENDERER_FILE : SETTINGS_RENDERER_FILE;

  if (paths.devServerUrl) {
    const serverUrl = parseLocalDevelopmentUrl(paths.devServerUrl);
    const basePath = serverUrl.pathname.endsWith("/")
      ? serverUrl.pathname
      : `${serverUrl.pathname}/`;
    const url = new URL(rendererFile, `${serverUrl.origin}${basePath}`);
    return { kind: "dev", url: url.href, origin: serverUrl.origin };
  }

  const filePath = joinRendererPath(paths.rendererDirectory, rendererFile);
  return { kind: "file", filePath, url: pathToFileURL(filePath).href };
}

export function joinRendererPath(
  rendererDirectory: string,
  rendererFile: string,
): string {
  // Renderer entry points are fixed by the application. Keeping this function
  // strict prevents a future caller from turning the load path into a generic
  // filesystem escape hatch.
  if (
    rendererFile !== PET_RENDERER_FILE &&
    rendererFile !== SETTINGS_RENDERER_FILE
  ) {
    throw new Error("Unknown renderer entry point.");
  }

  return `${rendererDirectory.replace(/\/$/, "")}/${rendererFile}`;
}

export function isTrustedRendererUrl(
  url: string,
  target: RendererTarget,
): boolean {
  if (target.kind === "dev") {
    try {
      return new URL(url).origin === target.origin;
    } catch {
      return false;
    }
  }

  return url === target.url;
}

export function parseLocalDevelopmentUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The renderer development URL is invalid.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOCAL_DEVELOPMENT_HOSTS.has(url.hostname) ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("The renderer development URL must point to localhost.");
  }

  return url;
}

export async function loadRendererWindow(
  window: BrowserWindow,
  target: RendererTarget,
): Promise<void> {
  installNavigationGuards(window, target);

  if (target.kind === "dev") {
    await window.loadURL(target.url);
  } else {
    await window.loadFile(target.filePath);
  }
}

function installNavigationGuards(
  window: BrowserWindow,
  target: RendererTarget,
): void {
  const preventUntrustedNavigation = (
    event: { preventDefault: () => void },
    url: string,
  ) => {
    if (!isTrustedRendererUrl(url, target)) {
      event.preventDefault();
    }
  };

  window.webContents.on("will-navigate", preventUntrustedNavigation);
  window.webContents.on("will-redirect", preventUntrustedNavigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}
