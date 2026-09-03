import { describe, expect, it, vi } from "vitest";

import { UPDATE_CHECK_INTERVAL_MS } from "./update-checker";
import {
  INITIAL_UPDATE_CHECK_DELAY_MS,
  UpdateCheckScheduler,
  type UpdateCheckTimer,
} from "./update-check-scheduler";

function fakeTimer() {
  const callbacks = new Map<object, () => void>();
  const delays: number[] = [];
  const timer: UpdateCheckTimer = {
    schedule: vi.fn((callback, delayMs) => {
      const handle = {};
      callbacks.set(handle, callback);
      delays.push(delayMs);
      return handle;
    }),
    cancel: vi.fn((handle) => callbacks.delete(handle as object)),
  };
  return { callbacks, delays, timer };
}

describe("automatic update check scheduler", () => {
  it("checks after startup and schedules the next check only after completion", async () => {
    const { callbacks, delays, timer } = fakeTimer();
    let finishCheck: (() => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCheck = resolve;
        }),
    );
    const scheduler = new UpdateCheckScheduler(check, timer);

    scheduler.start();
    scheduler.start();
    expect(delays).toEqual([INITIAL_UPDATE_CHECK_DELAY_MS]);
    const firstCallback = [...callbacks.values()][0];
    firstCallback?.();
    await Promise.resolve();
    expect(check).toHaveBeenCalledOnce();
    expect(delays).toHaveLength(1);

    finishCheck?.();
    await vi.waitFor(() =>
      expect(delays).toEqual([
        INITIAL_UPDATE_CHECK_DELAY_MS,
        UPDATE_CHECK_INTERVAL_MS,
      ]),
    );
  });

  it("reports failures and keeps the periodic schedule alive", async () => {
    const { callbacks, delays, timer } = fakeTimer();
    const onError = vi.fn();
    const scheduler = new UpdateCheckScheduler(
      async () => {
        throw new Error("offline");
      },
      timer,
      onError,
    );

    scheduler.start();
    [...callbacks.values()][0]?.();
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "offline" }),
      ),
    );
    expect(delays.at(-1)).toBe(UPDATE_CHECK_INTERVAL_MS);
  });

  it("contains synchronous check failures and keeps scheduling", async () => {
    const { callbacks, delays, timer } = fakeTimer();
    const onError = vi.fn();
    const synchronousFailure = (() => {
      throw new Error("synchronous publish failure");
    }) as () => Promise<unknown>;
    const scheduler = new UpdateCheckScheduler(
      synchronousFailure,
      timer,
      onError,
    );

    scheduler.start();
    [...callbacks.values()][0]?.();
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "synchronous publish failure" }),
      ),
    );
    expect(delays.at(-1)).toBe(UPDATE_CHECK_INTERVAL_MS);
  });

  it("cancels pending work and never reschedules after disposal", async () => {
    const { callbacks, timer } = fakeTimer();
    const check = vi.fn(async () => undefined);
    const scheduler = new UpdateCheckScheduler(check, timer);

    scheduler.start();
    const pendingHandle = [...callbacks.keys()][0];
    scheduler.dispose();
    expect(timer.cancel).toHaveBeenCalledWith(pendingHandle);
    expect(callbacks.size).toBe(0);

    scheduler.start();
    expect(check).not.toHaveBeenCalled();
  });
});
