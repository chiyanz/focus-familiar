import { join } from "node:path";

export interface NativeHelperPaths {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly isDevelopment: boolean;
}

export function resolveMacOSActivityHelperPath(
  paths: NativeHelperPaths,
): string {
  if (paths.isPackaged) {
    return join(paths.resourcesPath, "native", "focus-familiar-activity");
  }
  if (paths.isDevelopment) {
    return join(
      paths.appPath,
      "native",
      "macos",
      ".build",
      "focus-familiar-activity",
    );
  }
  return join(paths.appPath, "out", "native", "focus-familiar-activity");
}
