import { describe, expect, it, vi } from "vitest";

import { assertTrustedSender, type ManagedWindow } from "./ipc";

function managedWindow(
  url = "file:///app/out/renderer/pet.html",
): ManagedWindow {
  const webContents = { getURL: () => url };
  return {
    kind: "pet",
    window: { webContents } as never,
    target: {
      kind: "file",
      filePath: "/app/out/renderer/pet.html",
      url: "file:///app/out/renderer/pet.html",
    },
  };
}

describe("IPC sender boundary", () => {
  it("accepts the exact local renderer and web contents", () => {
    const entry = managedWindow();
    expect(() =>
      assertTrustedSender(
        {
          sender: entry.window.webContents,
          senderFrame: { url: entry.target.url } as never,
        },
        [entry],
      ),
    ).not.toThrow();
  });

  it("rejects a different web contents even when it claims a trusted URL", () => {
    const entry = managedWindow();
    expect(() =>
      assertTrustedSender(
        {
          sender: { getURL: vi.fn(() => entry.target.url) } as never,
          senderFrame: { url: entry.target.url } as never,
        },
        [entry],
      ),
    ).toThrow("untrusted renderer");
  });

  it("rejects navigation away from the fixed production entry point", () => {
    const entry = managedWindow("https://example.com");
    expect(() =>
      assertTrustedSender(
        {
          sender: entry.window.webContents,
          senderFrame: { url: "https://example.com" } as never,
        },
        [entry],
      ),
    ).toThrow("untrusted renderer");
  });
});
