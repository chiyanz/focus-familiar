import {
  IPC_CHANNELS,
  IPC_EVENTS,
  isWindowAction,
  parseAppInfo,
  parseApplicationList,
  parseSessionAction,
  parseSessionSnapshot,
  parseSessionStartConfig,
  type AppInfo,
  type ApplicationSummary,
  type FocusFamiliarApi,
  type IpcChannel,
  type IpcEvent,
  type SessionAction,
  type SessionSnapshot,
  type SessionStartConfig,
  type WindowAction,
} from "../shared/ipc";

export interface PreloadInvoker {
  invoke(channel: IpcChannel, payload?: unknown): Promise<unknown>;
  on(channel: IpcEvent, listener: (payload: unknown) => void): () => void;
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
    listApplications: async (): Promise<readonly ApplicationSummary[]> => {
      const response = await invoker.invoke(IPC_CHANNELS.listApplications);
      return parseApplicationList(response);
    },
    getSessionSnapshot: async (): Promise<SessionSnapshot> => {
      const response = await invoker.invoke(IPC_CHANNELS.getSessionSnapshot);
      return parseSessionSnapshot(response);
    },
    startSession: async (
      config: SessionStartConfig,
    ): Promise<SessionSnapshot> => {
      const normalizedConfig = parseSessionStartConfig(config);
      const response = await invoker.invoke(
        IPC_CHANNELS.startSession,
        normalizedConfig,
      );
      return parseSessionSnapshot(response);
    },
    requestSessionAction: async (
      action: SessionAction,
    ): Promise<SessionSnapshot> => {
      const normalizedAction = parseSessionAction(action);
      const response = await invoker.invoke(
        IPC_CHANNELS.sessionAction,
        normalizedAction,
      );
      return parseSessionSnapshot(response);
    },
    onSessionChanged: (listener) => {
      return invoker.on(IPC_EVENTS.sessionChanged, (payload) => {
        listener(parseSessionSnapshot(payload));
      });
    },
  };
}
