import type {
  ApplicationIdentity,
  PlatformError,
  PlatformResult,
} from "../application";

export const ACTIVITY_PROTOCOL_VERSION = 1 as const;

export type NativeHelperMessage =
  | { readonly type: "ready" }
  | { readonly type: "current"; readonly application: ApplicationIdentity }
  | { readonly type: "application"; readonly application: ApplicationIdentity }
  | {
      readonly type: "activation";
      readonly application: ApplicationIdentity;
      readonly success: boolean;
      readonly error?: PlatformError;
    }
  | { readonly type: "termination"; readonly application: ApplicationIdentity }
  | { readonly type: "lifecycle"; readonly event: "sleep" | "wake" }
  | {
      readonly type: "complete";
      readonly operation: string;
      readonly count: number;
    }
  | {
      readonly type: "error";
      readonly operation: string;
      readonly error: PlatformError;
      readonly bundleId?: string;
    };

export function parseNativeHelperMessage(
  line: string,
): PlatformResult<NativeHelperMessage> {
  let input: unknown;
  try {
    input = JSON.parse(line);
  } catch {
    return failure("invalid-json", "The native helper emitted invalid JSON.");
  }

  if (!isRecord(input) || input.protocolVersion !== ACTIVITY_PROTOCOL_VERSION) {
    return failure(
      "unsupported-protocol",
      "The native helper protocol version is missing or unsupported.",
    );
  }

  switch (input.type) {
    case "ready":
      return { ok: true, value: { type: "ready" } };
    case "current":
    case "application":
    case "termination": {
      const application = parseApplication(input);
      return application
        ? { ok: true, value: { type: input.type, application } }
        : failure(
            "invalid-message",
            `The ${input.type} message has invalid application data.`,
          );
    }
    case "activation": {
      const application = parseApplication(input);
      if (!application || typeof input.success !== "boolean") {
        return failure(
          "invalid-message",
          "The activation message is malformed.",
        );
      }
      const error = parseOptionalError(input);
      if (!input.success && !error) {
        return failure(
          "invalid-message",
          "A failed activation must include an error.",
        );
      }
      return {
        ok: true,
        value: {
          type: "activation",
          application,
          success: input.success,
          ...(error ? { error } : {}),
        },
      };
    }
    case "lifecycle":
      return input.event === "sleep" || input.event === "wake"
        ? { ok: true, value: { type: "lifecycle", event: input.event } }
        : failure("invalid-message", "The lifecycle message is malformed.");
    case "complete":
      return typeof input.operation === "string" &&
        isNonNegativeInteger(input.count)
        ? {
            ok: true,
            value: {
              type: "complete",
              operation: input.operation,
              count: input.count,
            },
          }
        : failure("invalid-message", "The completion message is malformed.");
    case "error": {
      const error = parseOptionalError(input);
      if (!error || typeof input.operation !== "string") {
        return failure(
          "invalid-message",
          "The helper error message is malformed.",
        );
      }
      return {
        ok: true,
        value: {
          type: "error",
          operation: input.operation,
          error,
          ...(typeof input.bundleId === "string"
            ? { bundleId: input.bundleId }
            : {}),
        },
      };
    }
    default:
      return failure(
        "invalid-message",
        "The native helper emitted an unknown message type.",
      );
  }
}

function parseApplication(
  input: Record<string, unknown>,
): ApplicationIdentity | null {
  const bundleId = normalizeString(input.bundleId);
  const name = normalizeString(input.name);
  return bundleId && name ? { bundleId, name } : null;
}

function parseOptionalError(
  input: Record<string, unknown>,
): PlatformError | null {
  const code = normalizeString(input.code);
  const message = normalizeString(input.message);
  return code && message ? { code, message } : null;
}

function normalizeString(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return value.length > 0 ? value : null;
}

function isNonNegativeInteger(input: unknown): input is number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function failure(code: string, message: string): PlatformResult<never> {
  return { ok: false, error: { code, message } };
}
