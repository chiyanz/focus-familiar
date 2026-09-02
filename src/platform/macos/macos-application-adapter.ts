import type {
  ActivityProvider,
  ApplicationActivator,
  ApplicationActivityEvent,
  ApplicationIdentity,
  Clock,
  Disposable,
  PlatformError,
  PlatformResult,
} from "../application";
import {
  parseNativeHelperMessage,
  type NativeHelperMessage,
} from "./helper-protocol";
import {
  NativeHelperRunnerError,
  type NativeHelperRunner,
} from "./helper-runner";

const OBSERVATION_READY_TIMEOUT_MS = 5_000;

export class MacOSApplicationAdapter
  implements ActivityProvider, ApplicationActivator
{
  constructor(
    private readonly runner: NativeHelperRunner,
    private readonly clock: Clock,
  ) {}

  async currentApplication(): Promise<PlatformResult<ApplicationIdentity>> {
    const result = await this.request(["--current"]);
    if (!result.ok) return result;
    const current = result.value.find(
      (message): message is Extract<NativeHelperMessage, { type: "current" }> =>
        message.type === "current",
    );
    return current
      ? { ok: true, value: current.application }
      : failure(
          "missing-current-application",
          "The helper returned no current application.",
        );
  }

  async listApplications(): Promise<
    PlatformResult<readonly ApplicationIdentity[]>
  > {
    const result = await this.request(["--list"]);
    if (!result.ok) return result;

    const applications = result.value
      .filter(
        (
          message,
        ): message is Extract<NativeHelperMessage, { type: "application" }> =>
          message.type === "application",
      )
      .map(({ application }) => application);
    const completion = result.value.find(
      (
        message,
      ): message is Extract<NativeHelperMessage, { type: "complete" }> =>
        message.type === "complete" && message.operation === "list",
    );
    if (!completion || completion.count !== applications.length) {
      return failure(
        "incomplete-application-list",
        "The helper returned an incomplete application list.",
      );
    }
    const unique = new Map(
      applications.map((application) => [application.bundleId, application]),
    );
    return {
      ok: true,
      value: [...unique.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };
  }

  async activate(
    bundleIdInput: string,
  ): Promise<PlatformResult<ApplicationIdentity>> {
    const bundleId = bundleIdInput.trim();
    if (!bundleId)
      return failure(
        "invalid-bundle-id",
        "Bundle identifier must not be empty.",
      );

    const result = await this.request(["--activate", bundleId]);
    if (!result.ok) return result;
    const activation = result.value.find(
      (
        message,
      ): message is Extract<NativeHelperMessage, { type: "activation" }> =>
        message.type === "activation",
    );
    if (!activation) {
      return failure(
        "missing-activation-result",
        "The helper returned no activation result.",
      );
    }
    return activation.success
      ? { ok: true, value: activation.application }
      : { ok: false, error: activation.error ?? fallbackActivationError() };
  }

  observe(listener: (event: ApplicationActivityEvent) => void): Disposable {
    let lastBundleId: string | null = null;
    let sleeping = false;
    let ready = false;
    let disposed = false;
    let failed = false;
    const observationHolder: { current?: Disposable } = {};
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;

    const emitError = (error: PlatformError): void => {
      listener({ type: "observation-error", atMs: this.clock.nowMs(), error });
    };
    const failObservation = (error: PlatformError): void => {
      if (disposed || failed) return;
      failed = true;
      if (readyTimeout) clearTimeout(readyTimeout);
      emitError(error);
      observationHolder.current?.dispose();
    };
    const observation = this.runner.observe(
      ["--observe"],
      (line) => {
        if (disposed || failed) return;
        const parsed = parseNativeHelperMessage(line);
        if (!parsed.ok) {
          failObservation(parsed.error);
          return;
        }

        const message = parsed.value;
        if (message.type === "ready") {
          ready = true;
          if (readyTimeout) clearTimeout(readyTimeout);
          return;
        }
        if (!ready && message.type !== "error") {
          failObservation({
            code: "helper-not-ready",
            message: "The native helper emitted data before its ready signal.",
          });
          return;
        }
        switch (message.type) {
          case "current":
          case "activation":
            if (message.type === "activation" && !message.success) {
              emitError(message.error ?? fallbackActivationError());
              return;
            }
            if (sleeping || message.application.bundleId === lastBundleId)
              return;
            lastBundleId = message.application.bundleId;
            listener({
              type: "application-activated",
              atMs: this.clock.nowMs(),
              application: message.application,
            });
            break;
          case "termination":
            listener({
              type: "application-terminated",
              atMs: this.clock.nowMs(),
              application: message.application,
            });
            break;
          case "lifecycle":
            if (message.event === "sleep") {
              if (sleeping) return;
              sleeping = true;
              listener({ type: "system-sleep", atMs: this.clock.nowMs() });
            } else {
              if (!sleeping) return;
              sleeping = false;
              lastBundleId = null;
              listener({ type: "system-wake", atMs: this.clock.nowMs() });
            }
            break;
          case "error":
            emitError(message.error);
            break;
          case "application":
          case "complete":
            break;
        }
      },
      failObservation,
    );
    observationHolder.current = observation;
    if (failed) observation.dispose();
    if (!ready && !failed) {
      readyTimeout = setTimeout(() => {
        if (ready) return;
        failObservation({
          code: "helper-ready-timeout",
          message:
            "The native helper did not become ready within five seconds.",
        });
      }, OBSERVATION_READY_TIMEOUT_MS);
    }
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (readyTimeout) clearTimeout(readyTimeout);
        observation.dispose();
      },
    };
  }

  private async request(
    arguments_: readonly string[],
  ): Promise<PlatformResult<readonly NativeHelperMessage[]>> {
    let run;
    try {
      run = await this.runner.request(arguments_);
    } catch (error) {
      return error instanceof NativeHelperRunnerError
        ? failure(error.code, error.message)
        : failure(
            "helper-spawn-failed",
            "The native helper could not complete the request.",
          );
    }

    const messages: NativeHelperMessage[] = [];
    for (const line of run.lines) {
      const parsed = parseNativeHelperMessage(line);
      if (!parsed.ok) return parsed;
      messages.push(parsed.value);
    }

    const helperError = messages.find(
      (message): message is Extract<NativeHelperMessage, { type: "error" }> =>
        message.type === "error",
    );
    if (helperError) return { ok: false, error: helperError.error };
    if (run.exitCode !== 0) {
      return failure(
        "helper-request-failed",
        run.stderr ||
          `The native helper exited with code ${String(run.exitCode)}.`,
      );
    }
    return { ok: true, value: messages };
  }
}

function failure<T>(code: string, message: string): PlatformResult<T> {
  return { ok: false, error: { code, message } };
}

function fallbackActivationError(): PlatformError {
  return {
    code: "activation-failed",
    message: "macOS did not activate the application.",
  };
}
