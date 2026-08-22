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
  it("strips a trailing 'x<digits>' extension before normalizing", () => {
    expect(normalizePhone("+49 821 555 0 x42")).toBe(normalizePhone("+49 821 555 0"));
  });
  it("strips a trailing 'ext. <digits>' extension before normalizing", () => {
    expect(normalizePhone("0821 555 0 ext. 42")).toBe(normalizePhone("0821 555 0"));
  });
  it("strips a trailing 'Durchwahl <digits>' extension before normalizing", () => {
    expect(normalizePhone("0821 555 0 Durchwahl 42")).toBe(normalizePhone("0821 555 0"));
  });
  it("does not attempt to strip a bare '-<digits>' suffix without a marker (fail-safe: merges into the digits instead of a false match)", () => {
    // Ohne Marker (x/ext/durchwahl) ist "-42" nicht von einer regulären Nummern-Fortsetzung zu
    // unterscheiden — bewusst NICHT als Durchwahl erkannt, die Ziffern fliessen einfach mit ein.
    expect(normalizePhone("0821 555 0-42")).not.toBe(normalizePhone("0821 555 0"));
  });
});
