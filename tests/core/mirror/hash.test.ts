import { describe, it, expect } from "vitest";
import { managedHash, fmEquals } from "../../../src/core/mirror/hash";
describe("managedHash", () => {
  it("order-independent and block-sensitive", () => {
    expect(managedHash({ a: 1, b: "x" }, ["c"], "blk")).toBe(managedHash({ b: "x", a: 1 }, ["c"], "blk"));
    expect(managedHash({ a: 1 }, [], "blk")).not.toBe(managedHash({ a: 1 }, [], "other"));
    expect(managedHash({ a: 1 }, [], null)).toMatch(/^[0-9a-f]{64}$/);
  });
});
describe("fmEquals", () => {
  it("normalizes scalars and arrays", () => {
    expect(fmEquals(true, "true")).toBe(true);
    expect(fmEquals(1, "1")).toBe(true);
    expect(fmEquals(["a", "b"], ["a", "b"])).toBe(true);
    expect(fmEquals(["a"], "a")).toBe(false);
    expect(fmEquals(undefined, null)).toBe(true);
    expect(fmEquals("x", undefined)).toBe(false);
  });
});
