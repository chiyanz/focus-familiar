export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  windowAction: "window:action",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const WINDOW_ACTIONS = [
  "show-settings",
  "hide-settings",
  "show-pet",
  "quit",
] as const;

export type WindowAction = (typeof WINDOW_ACTIONS)[number];

export type AppPlatform = "darwin" | "win32" | "linux" | "other";

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly platform: AppPlatform;
}

export interface FocusFamiliarApi {
  readonly getAppInfo: () => Promise<AppInfo>;
  readonly requestWindowAction: (action: WindowAction) => Promise<void>;
}

export function isWindowAction(value: unknown): value is WindowAction {
  return (
    typeof value === "string" &&
    (WINDOW_ACTIONS as readonly string[]).includes(value)
  );
}

export function parseWindowAction(value: unknown): WindowAction {
  if (!isWindowAction(value)) {
    throw new Error("Unknown window action.");
  }

  return value;
}

export function parseAppInfo(value: unknown): AppInfo {
  if (!isRecord(value)) {
    throw new Error("Malformed app information.");
  }

  const { name, version, platform } = value;
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    !isAppPlatform(platform)
  ) {
    throw new Error("Malformed app information.");
  }

  return { name, version, platform };
}

export function toAppPlatform(platform: string): AppPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }

  return "other";
}

function isAppPlatform(value: unknown): value is AppPlatform {
  return (
    value === "darwin" ||
    value === "win32" ||
    value === "linux" ||
    value === "other"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
