import {
  IPC_CHANNELS,
  IPC_EVENTS,
  isWindowAction,
  parseAppInfo,
  parseApplicationList,
  parsePetWindowPreferences,
  parsePetWindowSize,
  parseSessionAction,
  parseSessionPreferences,
  parsePreferencesFlushRequestId,
  parseSessionSnapshot,
  parseSessionStartConfig,
  parseUpdateStatus,
  type AppInfo,
  type ApplicationSummary,
  type FocusFamiliarApi,
  type IpcChannel,
  type IpcEvent,
  type PetWindowPreferences,
  type SessionAction,
  type SessionSnapshot,
  type SessionPreferences,
  type SessionStartConfig,
  type UpdateStatus,
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
    getUpdateStatus: async (): Promise<UpdateStatus> => {
      const response = await invoker.invoke(IPC_CHANNELS.getUpdateStatus);
      return parseUpdateStatus(response);
    },
    checkForUpdates: async (): Promise<UpdateStatus> => {
      const response = await invoker.invoke(IPC_CHANNELS.checkForUpdates);
      return parseUpdateStatus(response);
    },
    openUpdateRelease: async (): Promise<void> => {
      await invoker.invoke(IPC_CHANNELS.openUpdateRelease);
    },
    onUpdateStatusChanged: (listener) => {
      return invoker.on(IPC_EVENTS.updateStatusChanged, (payload) => {
        listener(parseUpdateStatus(payload));
      });
    },
    requestWindowAction: async (action: WindowAction): Promise<void> => {
      // Keep a validation guard here as well as in the main process. TypeScript
      // types do not protect a renderer at runtime, even with a narrow bridge.
      if (!isWindowAction(action)) {
        throw new Error("Unknown window action.");
      }

      await invoker.invoke(IPC_CHANNELS.windowAction, action);
    },
    getPetWindowPreferences: async (): Promise<PetWindowPreferences> => {
      const response = await invoker.invoke(
        IPC_CHANNELS.getPetWindowPreferences,
      );
      return parsePetWindowPreferences(response);
    },
    setPetWindowSize: async (sizePx: number): Promise<PetWindowPreferences> => {
      const normalizedSize = parsePetWindowSize(sizePx);
      const response = await invoker.invoke(
        IPC_CHANNELS.setPetWindowSize,
        normalizedSize,
      );
      return parsePetWindowPreferences(response);
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
    getSessionPreferences: async (): Promise<SessionPreferences> => {
      const response = await invoker.invoke(IPC_CHANNELS.getSessionPreferences);
      return parseSessionPreferences(response);
    },
    saveSessionPreferences: async (
      preferences: SessionPreferences,
    ): Promise<SessionPreferences> => {
      const normalizedPreferences = parseSessionPreferences(preferences);
      const response = await invoker.invoke(
        IPC_CHANNELS.saveSessionPreferences,
        normalizedPreferences,
      );
      return parseSessionPreferences(response);
    },
    onPreferencesFlushRequested: (listener) => {
      return invoker.on(IPC_EVENTS.preferencesFlushRequested, (payload) => {
        const requestId = parsePreferencesFlushRequestId(payload);
        void Promise.resolve()
          .then(listener)
          .catch(() => undefined)
          .then(() =>
            invoker.invoke(IPC_CHANNELS.acknowledgePreferencesFlush, requestId),
          )
          .catch(() => undefined);
      });
    },
  };
}
