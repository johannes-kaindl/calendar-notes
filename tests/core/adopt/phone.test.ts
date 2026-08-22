import { describe, it, expect } from "vitest";
import { normalizePhone } from "../../../src/core/adopt/phone";

describe("normalizePhone", () => {
  it("normalizes a national number with the default country", () => {
    expect(normalizePhone("0171/1234567")).toBe("+491711234567");
  });
  it("normalizes an already-international number regardless of formatting", () => {
    expect(normalizePhone("+49 171 1234567")).toBe("+491711234567");
  });
  it("both forms of the same number normalize to the same string", () => {
    expect(normalizePhone("+49 171 1234567")).toBe(normalizePhone("0171/1234567"));
  });
  it("converts a leading 00 to +", () => {
    expect(normalizePhone("0034 696 386 907")).toBe("+34696386907");
  });
  it("keeps other digits as-is when already prefixed with +", () => {
    expect(normalizePhone("+34696386907")).toBe("+34696386907");
  });
  it("respects a custom default country", () => {
    expect(normalizePhone("0696386907", "34")).toBe("+34696386907");
  });
  it("returns null for too-short input", () => {
    expect(normalizePhone("12345")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(normalizePhone("")).toBeNull();
  });
  it("strips non-digit separators like spaces, dashes, parens", () => {
    expect(normalizePhone("+49 (171) 123-4567")).toBe("+491711234567");
  });
});
