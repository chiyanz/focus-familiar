import { contextBridge, ipcRenderer } from "electron";

import { createPreloadApi } from "./api";

contextBridge.exposeInMainWorld(
  "focusFamiliar",
  createPreloadApi({
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  }),
);
