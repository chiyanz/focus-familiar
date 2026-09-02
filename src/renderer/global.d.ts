import type { FocusFamiliarApi } from "../shared/ipc";

declare global {
  interface Window {
    readonly focusFamiliar: FocusFamiliarApi;
  }
}

export {};
