import { describe, expect, it, vi } from "vitest";

import type { FocusSessionConfig, FocusSessionState } from "../core";
import type {
  ApplicationActivator,
  ApplicationIdentity,
  PlatformResult,
} from "../platform/application";
import {
  InterventionCoordinator,
  STRICT_INTERVENTION_WARNING_MS,
  type InterventionActivationFailed,
  type InterventionActivationSucceeded,
  type InterventionTimerDriver,
  type InterventionTimerHandle,
} from "./intervention-coordinator";

const editor: ApplicationIdentity = {
  bundleId: "com.example.Editor",
  name: "Editor",
};
const browser: ApplicationIdentity = {
  bundleId: "com.example.Browser",
  name: "Browser",
};

const baseConfig: FocusSessionConfig = {
  task: "Write tests",
  targetApplication: editor,
  durationMs: 10_000,
  gracePeriodMs: 1_000,
  interventionAfterMs: 3_000,
  intensity: "strict",
};

class FakeActivator implements ApplicationActivator {
  readonly calls: string[] = [];
  response: PlatformResult<ApplicationIdentity> = { ok: true, value: editor };
  implementation:
    | ((bundleId: string) => Promise<PlatformResult<ApplicationIdentity>>)
    | undefined;

  activate(bundleId: string): Promise<PlatformResult<ApplicationIdentity>> {
    this.calls.push(bundleId);
    return this.implementation?.(bundleId) ?? Promise.resolve(this.response);
  }
}

class FakeInterventionTimer implements InterventionTimerDriver {
  readonly entries: Array<{
    readonly handle: number;
    readonly callback: () => void;
    readonly delayMs: number;
    canceled: boolean;
  }> = [];
  throwOnSchedule = false;

  readonly schedule = vi.fn(
    (callback: () => void, delayMs: number): InterventionTimerHandle => {
      if (this.throwOnSchedule) throw new Error("warning timer unavailable");
      const entry = {
        handle: this.entries.length + 1,
        callback,
        delayMs,
        canceled: false,
      };
      this.entries.push(entry);
      return entry.handle;
    },
  );

  readonly cancel = vi.fn((handle: InterventionTimerHandle): void => {
    const entry = this.entries.find((candidate) => candidate.handle === handle);
    if (entry) entry.canceled = true;
  });

  fire(index: number): void {
    this.entries[index]?.callback();
  }
}

interface PendingActivation {
  readonly bundleId: string;
  readonly resolve: (result: PlatformResult<ApplicationIdentity>) => void;
}

function deferredActivator(): {
  readonly activator: FakeActivator;
  readonly pending: PendingActivation[];
} {
  const activator = new FakeActivator();
  const pending: PendingActivation[] = [];
  activator.implementation = (bundleId) =>
    new Promise((resolve) => {
      pending.push({ bundleId, resolve });
    });
  return { activator, pending };
}

function sessionState(
  phase: FocusSessionState["phase"],
  overrides: Partial<{
    sessionId: string | null;
    config: FocusSessionConfig | null;
    currentApplication: ApplicationIdentity | null;
  }> = {},
): FocusSessionState {
  return {
    schemaVersion: 1,
    sessionId: "session-1",
    phase,
    config: baseConfig,
    currentApplication: browser,
    focusedMs: 0,
    awayMs: phase === "intervention" ? 3_000 : 0,
    currentAwayMs: phase === "intervention" ? 3_000 : 0,
    lastEventAtMs: 0,
    endedAtMs: null,
    stopReason: null,
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("InterventionCoordinator", () => {
  it.each(["gentle", "balanced"] as const)(
    "does not activate automatically for %s intensity",
    async (intensity) => {
      const activator = new FakeActivator();
      const coordinator = new InterventionCoordinator(activator);

      coordinator.synchronize(
        sessionState("focused", { config: { ...baseConfig, intensity } }),
      );
      coordinator.synchronize(
        sessionState("intervention", {
          config: { ...baseConfig, intensity },
        }),
      );
      await flushAsyncWork();

      expect(activator.calls).toEqual([]);
    },
  );

  it("activates the target exactly once when strict intervention begins", async () => {
    const activator = new FakeActivator();
    const succeeded =
      vi.fn<(result: InterventionActivationSucceeded) => void>();
    const coordinator = new InterventionCoordinator(activator, {
      onActivationSucceeded: succeeded,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("intervention"));
    await flushAsyncWork();

    expect(activator.calls).toEqual([editor.bundleId]);
    expect(succeeded).toHaveBeenCalledOnce();
    expect(succeeded).toHaveBeenCalledWith({
      sessionId: "session-1",
      targetApplication: editor,
      activatedApplication: editor,
    });
  });

  it("holds the strict final warning for seven seconds before activation", async () => {
    const activator = new FakeActivator();
    const timer = new FakeInterventionTimer();
    const coordinator = new InterventionCoordinator(activator, {
      activationDelayMs: STRICT_INTERVENTION_WARNING_MS,
      timer,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("intervention"));

    expect(activator.calls).toEqual([]);
    expect(timer.schedule).toHaveBeenCalledOnce();
    expect(timer.entries[0]?.delayMs).toBe(7_000);

    timer.fire(0);
    await flushAsyncWork();

    expect(activator.calls).toEqual([editor.bundleId]);
  });

  it.each(["focused", "paused", "stopped"] as const)(
    "cancels the delayed strict activation after transition to %s",
    async (phase) => {
      const activator = new FakeActivator();
      const timer = new FakeInterventionTimer();
      const coordinator = new InterventionCoordinator(activator, {
        activationDelayMs: STRICT_INTERVENTION_WARNING_MS,
        timer,
      });

      coordinator.synchronize(sessionState("focused"));
      coordinator.synchronize(sessionState("intervention"));
      coordinator.synchronize(sessionState(phase));
      timer.fire(0);
      await flushAsyncWork();

      expect(timer.entries[0]?.canceled).toBe(true);
      expect(activator.calls).toEqual([]);
    },
  );

  it("reports a final-warning timer failure without activating", async () => {
    const activator = new FakeActivator();
    const timer = new FakeInterventionTimer();
    timer.throwOnSchedule = true;
    const failed = vi.fn<(result: InterventionActivationFailed) => void>();
    const coordinator = new InterventionCoordinator(activator, {
      activationDelayMs: STRICT_INTERVENTION_WARNING_MS,
      timer,
      onActivationFailed: failed,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    await flushAsyncWork();

    expect(activator.calls).toEqual([]);
    expect(failed).toHaveBeenCalledWith({
      sessionId: "session-1",
      targetApplication: editor,
      error: {
        code: "activation-delay-failed",
        message: "warning timer unavailable",
      },
    });
  });

  it("keeps a current activation result valid across duplicate intervention snapshots", async () => {
    const { activator, pending } = deferredActivator();
    const succeeded =
      vi.fn<(result: InterventionActivationSucceeded) => void>();
    const coordinator = new InterventionCoordinator(activator, {
      onActivationSucceeded: succeeded,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("intervention"));
    pending[0]?.resolve({ ok: true, value: editor });
    await flushAsyncWork();

    expect(activator.calls).toEqual([editor.bundleId]);
    expect(succeeded).toHaveBeenCalledOnce();
  });

  it("rearms after leaving intervention and activates on a later entry", async () => {
    const activator = new FakeActivator();
    const coordinator = new InterventionCoordinator(activator);

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("nudge"));
    coordinator.synchronize(sessionState("intervention"));
    await flushAsyncWork();

    expect(activator.calls).toEqual([editor.bundleId, editor.bundleId]);
  });

  it("treats an existing intervention snapshot as a side-effect-free recovery baseline", async () => {
    const activator = new FakeActivator();
    const coordinator = new InterventionCoordinator(activator);

    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("intervention"));
    await flushAsyncWork();

    expect(activator.calls).toEqual([]);
  });

  it("captures session and target identity at request time", async () => {
    const activator = new FakeActivator();
    const succeeded =
      vi.fn<(result: InterventionActivationSucceeded) => void>();
    const alternateTarget: ApplicationIdentity = {
      bundleId: "com.example.AlternateEditor",
      name: "Alternate Editor",
    };
    activator.response = { ok: true, value: alternateTarget };
    const coordinator = new InterventionCoordinator(activator, {
      onActivationSucceeded: succeeded,
    });

    coordinator.synchronize(
      sessionState("focused", {
        sessionId: "session-captured",
        config: { ...baseConfig, targetApplication: alternateTarget },
      }),
    );
    coordinator.synchronize(
      sessionState("intervention", {
        sessionId: "session-captured",
        config: { ...baseConfig, targetApplication: alternateTarget },
      }),
    );
    await flushAsyncWork();

    expect(activator.calls).toEqual([alternateTarget.bundleId]);
    expect(succeeded).toHaveBeenCalledWith({
      sessionId: "session-captured",
      targetApplication: alternateTarget,
      activatedApplication: alternateTarget,
    });
  });

  it("reports an explicit activation failure without retrying", async () => {
    const activator = new FakeActivator();
    const failed = vi.fn<(result: InterventionActivationFailed) => void>();
    const error = {
      code: "activation-failed",
      message: "The target could not be focused.",
    };
    activator.response = { ok: false, error };
    const coordinator = new InterventionCoordinator(activator, {
      onActivationFailed: failed,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("intervention"));
    await flushAsyncWork();

    expect(activator.calls).toHaveLength(1);
    expect(failed).toHaveBeenCalledWith({
      sessionId: "session-1",
      targetApplication: editor,
      error,
    });
  });

  it("reports a rejected activation request as a failure", async () => {
    const activator = new FakeActivator();
    const failed = vi.fn<(result: InterventionActivationFailed) => void>();
    activator.implementation = () =>
      Promise.reject(new Error("helper disconnected"));
    const coordinator = new InterventionCoordinator(activator, {
      onActivationFailed: failed,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    await flushAsyncWork();

    expect(failed).toHaveBeenCalledWith({
      sessionId: "session-1",
      targetApplication: editor,
      error: {
        code: "activation-request-failed",
        message: "helper disconnected",
      },
    });
  });

  it("does not activate when an intervention snapshot already has the target foreground", async () => {
    const activator = new FakeActivator();
    const coordinator = new InterventionCoordinator(activator);

    coordinator.synchronize(
      sessionState("focused", { currentApplication: browser }),
    );
    coordinator.synchronize(
      sessionState("intervention", { currentApplication: editor }),
    );
    await flushAsyncWork();

    expect(activator.calls).toEqual([]);
  });

  it.each(["focused", "paused", "stopped", "completed"] as const)(
    "ignores a late activation success after leaving intervention for %s",
    async (phase) => {
      const { activator, pending } = deferredActivator();
      const succeeded =
        vi.fn<(result: InterventionActivationSucceeded) => void>();
      const coordinator = new InterventionCoordinator(activator, {
        onActivationSucceeded: succeeded,
      });

      coordinator.synchronize(sessionState("focused"));
      coordinator.synchronize(sessionState("intervention"));
      coordinator.synchronize(sessionState(phase));
      pending[0]?.resolve({ ok: true, value: editor });
      await flushAsyncWork();

      expect(activator.calls).toEqual([editor.bundleId]);
      expect(succeeded).not.toHaveBeenCalled();
    },
  );

  it("ignores a late activation failure after leaving intervention", async () => {
    const { activator, pending } = deferredActivator();
    const failed = vi.fn<(result: InterventionActivationFailed) => void>();
    const coordinator = new InterventionCoordinator(activator, {
      onActivationFailed: failed,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("paused"));
    pending[0]?.resolve({
      ok: false,
      error: { code: "activation-failed", message: "Declined." },
    });
    await flushAsyncWork();

    expect(failed).not.toHaveBeenCalled();
  });

  it("ignores a superseded episode result while keeping the new episode result", async () => {
    const { activator, pending } = deferredActivator();
    const succeeded =
      vi.fn<(result: InterventionActivationSucceeded) => void>();
    const coordinator = new InterventionCoordinator(activator, {
      onActivationSucceeded: succeeded,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(
      sessionState("intervention", { sessionId: "session-2" }),
    );

    pending[0]?.resolve({ ok: true, value: editor });
    pending[1]?.resolve({ ok: true, value: editor });
    await flushAsyncWork();

    expect(activator.calls).toEqual([editor.bundleId, editor.bundleId]);
    expect(succeeded).toHaveBeenCalledOnce();
    expect(succeeded).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-2" }),
    );
  });

  it("does not auto-activate an incomplete intervention snapshot", async () => {
    const activator = new FakeActivator();
    const coordinator = new InterventionCoordinator(activator);

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(
      sessionState("intervention", { sessionId: null, config: null }),
    );
    await flushAsyncWork();

    expect(activator.calls).toEqual([]);
  });

  it("ignores in-flight completion and future synchronization after disposal", async () => {
    const activator = new FakeActivator();
    const succeeded =
      vi.fn<(result: InterventionActivationSucceeded) => void>();
    let resolveActivation:
      | ((result: PlatformResult<ApplicationIdentity>) => void)
      | undefined;
    activator.implementation = () =>
      new Promise((resolve) => {
        resolveActivation = resolve;
      });
    const coordinator = new InterventionCoordinator(activator, {
      onActivationSucceeded: succeeded,
    });

    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    coordinator.dispose();
    coordinator.dispose();
    coordinator.synchronize(sessionState("focused"));
    coordinator.synchronize(sessionState("intervention"));
    resolveActivation?.({ ok: true, value: editor });
    await flushAsyncWork();

    expect(activator.calls).toHaveLength(1);
    expect(succeeded).not.toHaveBeenCalled();
  });
});
