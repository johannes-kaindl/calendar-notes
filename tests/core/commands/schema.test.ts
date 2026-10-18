import { describe, it, expect } from "vitest";
import { inputIssues, unsupportedSchemaKeywords, validateInput, type ObjectSchema } from "../../../src/core/commands/schema";
import { commandRegistry, ensureDefaultCommands } from "../../../src/core/commands/registry";

const SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1 },
    start: { type: "string", format: "date-time" },
    day: { type: "string", format: "date" },
    email: { type: "string", format: "email" },
    partstat: { type: "string", enum: ["ACCEPTED", "DECLINED", "TENTATIVE"] },
    rsvp: { type: "boolean" },
    count: { type: "number", minimum: 0, maximum: 10 },
    tags: { type: "array", items: { type: "string" } },
    attendees: { type: "array", items: { type: "string", format: "email" } },
  },
  required: ["title"],
};

describe("validateInput", () => {
  it("ok: all valid fields", () => {
    const r = validateInput(SCHEMA, {
      title: "Termin", start: "2026-09-02T14:00", day: "2026-09-02", email: "a@b.test",
      partstat: "ACCEPTED", rsvp: true, count: 5, tags: ["a", "b"], attendees: ["x@y.test"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value["title"]).toBe("Termin");
  });

  it("required fehlt -> Fehler", () => {
    const r = validateInput(SCHEMA, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("title"))).toBe(true);
  });

  it("enum: ungueltiger Wert -> Fehler", () => {
    const r = validateInput(SCHEMA, { title: "x", partstat: "MAYBE" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("partstat"))).toBe(true);
  });

  it("date-time: ISO mit T und Sekunden/Zone (floating oder Z — kein Offset)", () => {
    for (const v of ["2026-09-02T14:00", "2026-09-02T14:00:00", "2026-09-02T14:00Z", "2026-09-02T14:00:00Z"]) {
      const r = validateInput(SCHEMA, { title: "x", start: v });
      expect(r.ok, v).toBe(true);
    }
  });

  it("date-time: Form mit Leerzeichen statt T", () => {
    const r = validateInput(SCHEMA, { title: "x", start: "2026-09-02 14:00" });
    expect(r.ok).toBe(true);
  });

  it("date-time: Zeitzonen-Offset wird abgelehnt (Ruling Review-Runde 3, C1 — nur floating/Z, kein Offset)", () => {
    for (const v of ["2026-09-02T14:00+02:00", "2026-09-02T14:00:00+02:00", "2026-09-02T14:00-05:00"]) {
      const r = validateInput(SCHEMA, { title: "x", start: v });
      expect(r.ok, v).toBe(false);
    }
  });

  it("date-time: ungueltig -> Fehler", () => {
    const r = validateInput(SCHEMA, { title: "x", start: "not-a-date" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("start"))).toBe(true);
  });

  it("date: nur YYYY-MM-DD", () => {
    expect(validateInput(SCHEMA, { title: "x", day: "2026-09-02" }).ok).toBe(true);
    expect(validateInput(SCHEMA, { title: "x", day: "2026-09-02T14:00" }).ok).toBe(false);
  });

  it("email: muss @ enthalten", () => {
    expect(validateInput(SCHEMA, { title: "x", email: "keinat.test" }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "x", email: "a@b.test" }).ok).toBe(true);
  });

  it("unbekannte Keys -> Fehler", () => {
    const r = validateInput(SCHEMA, { title: "x", unknownKey: "y" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("unknownKey"))).toBe(true);
  });

  it("array of emails: prueft jeden Eintrag", () => {
    expect(validateInput(SCHEMA, { title: "x", attendees: ["a@b.test", "keinat"] }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "x", attendees: ["a@b.test", "c@d.test"] }).ok).toBe(true);
  });

  it("Typfehler: string statt number, non-array statt array", () => {
    expect(validateInput(SCHEMA, { title: "x", count: "5" }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "x", tags: "a" }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: 5 }).ok).toBe(false);
  });

  it("number: minimum/maximum", () => {
    expect(validateInput(SCHEMA, { title: "x", count: -1 }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "x", count: 11 }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "x", count: 0 }).ok).toBe(true);
  });

  it("input ist kein Objekt -> Fehler", () => {
    expect(validateInput(SCHEMA, null).ok).toBe(false);
    expect(validateInput(SCHEMA, "x").ok).toBe(false);
  });
});

describe("Schemas der registrierten Kommandos liegen im Teilbereich, den das Kit prueft", () => {
  it("kein Kommando verlangt etwas, das validateInput nicht pruefen kann (Kit-Pruefung statt stiller Luecke)", () => {
    ensureDefaultCommands();
    const gaps = commandRegistry().flatMap((c) => unsupportedSchemaKeywords(c.schema).map((g) => `${c.id}: ${g}`));
    expect(gaps).toEqual([]);
    expect(commandRegistry().length).toBeGreaterThan(15);
  });

  it("kein Kommando-Schema ist fuer das Kit unlesbar (bad-schema, z. B. ein required-Name ohne Eintrag in properties)", () => {
    ensureDefaultCommands();
    for (const c of commandRegistry()) {
      const codes = inputIssues(c.schema, {}).map((i) => i.code);
      expect(codes, c.id).not.toContain("bad-schema");
    }
  });

  it("Unterschiede zur frueheren lokalen Fassung: nicht existierender Tag, Pflichtfeld aus Leerraum, Datum leer", () => {
    expect(validateInput(SCHEMA, { title: "x", day: "2026-02-30" }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "x", start: "2026-09-02T25:00" }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "   " }).ok).toBe(false);
    expect(validateInput(SCHEMA, { title: "x", day: "" }).ok).toBe(true);
  });
});
