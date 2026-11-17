import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, digest, sha256Hex } from "../../src/core/hash";

describe("isomorphic sha256", () => {
  it("matches node:crypto across lengths and unicode", () => {
    const inputs = ["", "a", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000), "naïve café — ✓ 漢字 🎉"];
    for (let i = 0; i < 200; i++) inputs.push(String.fromCharCode(...Array.from({ length: i }, (_, j) => 32 + ((i * 7 + j * 13) % 900))));
    for (const s of inputs) expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
  });
  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(digest({ x: 1, y: 2 })).toBe(digest({ y: 2, x: 1 }));
  });
});
