import {
  IPC_CHANNELS,
  isWindowAction,
  parseAppInfo,
  type AppInfo,
  type FocusFamiliarApi,
  type IpcChannel,
  type WindowAction,
} from "../shared/ipc";

export interface PreloadInvoker {
  invoke(channel: IpcChannel, payload?: unknown): Promise<unknown>;
}

export function createPreloadApi(invoker: PreloadInvoker): FocusFamiliarApi {
  return {
    getAppInfo: async (): Promise<AppInfo> => {
      const response = await invoker.invoke(IPC_CHANNELS.getAppInfo);
      return parseAppInfo(response);
    },
    requestWindowAction: async (action: WindowAction): Promise<void> => {
      // Keep a validation guard here as well as in the main process. TypeScript
      // types do not protect a renderer at runtime, even with a narrow bridge.
      if (!isWindowAction(action)) {
        throw new Error("Unknown window action.");
      }

      await invoker.invoke(IPC_CHANNELS.windowAction, action);
    },
  };
}
