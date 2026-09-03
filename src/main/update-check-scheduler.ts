import { UPDATE_CHECK_INTERVAL_MS } from "./update-checker";

export const INITIAL_UPDATE_CHECK_DELAY_MS = 4_000;

export interface UpdateCheckTimer {
  readonly schedule: (callback: () => void, delayMs: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

const defaultTimer: UpdateCheckTimer = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Schedules one non-overlapping check at a time and is disposable on quit. */
export class UpdateCheckScheduler {
  private handle: unknown;
  private started = false;
  private disposed = false;

  constructor(
    private readonly check: () => Promise<unknown>,
    private readonly timer: UpdateCheckTimer = defaultTimer,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.schedule(INITIAL_UPDATE_CHECK_DELAY_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.handle !== undefined) {
      this.timer.cancel(this.handle);
      this.handle = undefined;
    }
  }

  private schedule(delayMs: number): void {
    if (this.disposed) return;
    this.handle = this.timer.schedule(() => {
      this.handle = undefined;
      void Promise.resolve()
        .then(() => this.check())
        .catch((error: unknown) => {
          this.onError(
            error instanceof Error
              ? error
              : new Error("Unknown scheduled update error."),
          );
        })
        .finally(() => this.schedule(UPDATE_CHECK_INTERVAL_MS));
    }, delayMs);
  }
}
