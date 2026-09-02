import { describe, expect, it, vi } from "vitest";

import { JsonLineDecoder } from "./helper-runner";

describe("JSON line decoder", () => {
  it("reassembles split UTF-8 frames and ignores blank lines", () => {
    const lines: string[] = [];
    const decoder = new JsonLineDecoder((line) => lines.push(line));
    const encoded = Buffer.from('{"name":"Café"}\n\n{"type":"ready"}', "utf8");

    decoder.push(encoded.subarray(0, 13));
    decoder.push(encoded.subarray(13));
    decoder.finish();

    expect(lines).toEqual(['{"name":"Café"}', '{"type":"ready"}']);
  });

  it("rejects an unbounded frame", () => {
    const decoder = new JsonLineDecoder(vi.fn());
    expect(() => decoder.push(Buffer.alloc(65_537, 0x61))).toThrow("64 KiB");
  });
});
