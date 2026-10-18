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
describe("fmEquals mit linkAware (Rollout Teil B, Befund 2)", () => {
  const lose = (a: unknown, b: unknown): boolean => fmEquals(a, b, { linkAware: true });
  it("behandelt Wikilink und Klartext als gleich", () => {
    expect(lose("[[Bezirkskrankenhaus Augsburg]]", "Bezirkskrankenhaus Augsburg")).toBe(true);
    expect(lose("[[Orga/Sparkasse Kissing|Sparkasse Kissing]]", "Sparkasse Kissing")).toBe(true);
    expect(lose("[[Orga/Sparkasse Kissing]]", "Sparkasse Kissing")).toBe(true);
  });
  it("laesst echte Abweichungen stehen", () => {
    expect(lose("[[Orga/Sparkasse Kissing|Sparkasse Kissing]]", "Sparkasse")).toBe(false);
    expect(lose("0171 123", "171 123")).toBe(false);
  });
  it("vergleicht Listen elementweise locker", () => {
    expect(lose(["[[A]]", "B"], ["A", "B"])).toBe(true);
    expect(lose(["[[A]]"], ["A", "B"])).toBe(false);
  });
  it("ein leerer Alias zaehlt als fehlend: [[a|]] ist der Name (Kit-Regel, vorher der leere Text)", () => {
    expect(lose("[[Orga/Kissing|]]", "Kissing")).toBe(true);
  });
  it("ohne linkAware bleibt der Vergleich streng", () => {
    expect(fmEquals("[[Ort]]", "Ort")).toBe(false);
  });
  it("eine Liste und ein Skalar sind nie gleich (Unterschied zum Kit, der Spiegel schreibt Listen)", () => {
    expect(fmEquals(["a"], "a")).toBe(false);
    expect(fmEquals("a", ["a"], { linkAware: true })).toBe(false);
  });
  it("kennt, was das Kit nicht kennt: Boolean, null/undefined, Objekte", () => {
    expect(fmEquals(true, "true")).toBe(true);
    expect(fmEquals(undefined, null)).toBe(true);
    expect(fmEquals(null, "")).toBe(false);
    expect(fmEquals({ a: 1 }, { a: 1 })).toBe(true);
    expect(fmEquals({ a: 1 }, { a: 2 })).toBe(false);
  });
});
