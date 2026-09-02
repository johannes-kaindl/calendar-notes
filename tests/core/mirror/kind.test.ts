import { describe, it, expect } from "vitest";
import { assertNever, nichtUnterstuetzt } from "../../../src/core/mirror/kind";

describe("assertNever", () => {
  it("wirft mit Hinweis und Wert, wenn zur Laufzeit doch etwas ankommt", () => {
    expect(() => assertNever("todo" as never, "Notiz-Plan")).toThrow(/Notiz-Plan.*todo/);
  });
});

describe("nichtUnterstuetzt", () => {
  it("wirft mit Hinweis und Sorte", () => {
    expect(() => nichtUnterstuetzt("todo", "Dateiname")).toThrow(/Dateiname.*todo/);
  });
});
