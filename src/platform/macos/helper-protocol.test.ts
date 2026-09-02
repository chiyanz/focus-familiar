import { describe, expect, it } from "vitest";

import { parseNativeHelperMessage } from "./helper-protocol";

function line(value: Record<string, unknown>): string {
  return JSON.stringify({ protocolVersion: 1, ...value });
}

describe("native activity helper protocol", () => {
  it.each([
    [{ type: "ready", operation: "observe", success: true }, { type: "ready" }],
    [
      { type: "current", bundleId: " com.example.Editor ", name: " Editor " },
      {
        type: "current",
        application: { bundleId: "com.example.Editor", name: "Editor" },
      },
    ],
    [
      { type: "application", bundleId: "com.example.Editor", name: "Editor" },
      {
        type: "application",
        application: { bundleId: "com.example.Editor", name: "Editor" },
      },
    ],
    [
      { type: "termination", bundleId: "com.example.Editor", name: "Editor" },
      {
        type: "termination",
        application: { bundleId: "com.example.Editor", name: "Editor" },
      },
    ],
    [
      { type: "lifecycle", event: "sleep" },
      { type: "lifecycle", event: "sleep" },
    ],
    [
      { type: "complete", operation: "list", count: 2, success: true },
      { type: "complete", operation: "list", count: 2 },
    ],
  ])("parses a supported %o message", (input, expected) => {
    expect(parseNativeHelperMessage(line(input))).toEqual({
      ok: true,
      value: expected,
    });
  });

  it("parses successful and failed activation results", () => {
    expect(
      parseNativeHelperMessage(
        line({
          type: "activation",
          operation: "activate",
          bundleId: "com.example.Editor",
          name: "Editor",
          success: true,
        }),
      ),
    ).toMatchObject({ ok: true, value: { type: "activation", success: true } });
    expect(
      parseNativeHelperMessage(
        line({
          type: "activation",
          operation: "activate",
          bundleId: "com.example.Editor",
          name: "Editor",
          success: false,
          code: "activation-failed",
          message: "macOS declined.",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        type: "activation",
        application: { bundleId: "com.example.Editor", name: "Editor" },
        success: false,
        error: { code: "activation-failed", message: "macOS declined." },
      },
    });
  });

  it("parses structured helper errors", () => {
    expect(
      parseNativeHelperMessage(
        line({
          type: "error",
          operation: "activate",
          bundleId: "com.missing.App",
          success: false,
          code: "application-not-running",
          message: "Not running.",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        type: "error",
        operation: "activate",
        bundleId: "com.missing.App",
        error: { code: "application-not-running", message: "Not running." },
      },
    });
  });

  it.each([
    ["not json", "invalid-json"],
    [
      JSON.stringify({ protocolVersion: 2, type: "ready" }),
      "unsupported-protocol",
    ],
    [line({ type: "unknown" }), "invalid-message"],
    [
      line({ type: "current", bundleId: "", name: "Editor" }),
      "invalid-message",
    ],
    [line({ type: "lifecycle", event: "hibernate" }), "invalid-message"],
    [
      line({ type: "complete", operation: "list", count: -1 }),
      "invalid-message",
    ],
    [
      line({
        type: "activation",
        bundleId: "com.example.Editor",
        name: "Editor",
        success: false,
      }),
      "invalid-message",
    ],
  ])("rejects malformed protocol input", (input, code) => {
    expect(parseNativeHelperMessage(input)).toMatchObject({
      ok: false,
      error: { code },
    });
  });
});
