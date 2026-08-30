import { describe, it, expect } from "vitest";
import { DE, EN } from "../../src/i18n/strings";

describe("Wörterbücher EN/DE", () => {
  it("führen dieselben Schlüssel", () => {
    const missingInDe = Object.keys(EN).filter((k) => !Object.hasOwn(DE, k));
    const missingInEn = Object.keys(DE).filter((k) => !Object.hasOwn(EN, k));
    expect({ missingInDe, missingInEn }).toEqual({ missingInDe: [], missingInEn: [] });
  });

  it("haben keinen leeren Wert", () => {
    const empty = [...Object.entries(EN), ...Object.entries(DE)].filter(([, v]) => v.trim() === "").map(([k]) => k);
    expect(empty).toEqual([]);
  });

  // Deutsche Anführungszeichen im englischen Wörterbuch sind ein Übersetzungs-Artefakt: „…“
  // öffnet unten (U+201E), englisch wird oben geöffnet (“…”). Fällt beim Lesen nicht auf, weil
  // das SCHLIESSENDE deutsche Zeichen dasselbe ist wie das öffnende englische.
  it("benutzen im englischen Wörterbuch keine deutsche Anführungs-Typografie", () => {
    const offenders = Object.entries(EN).filter(([, v]) => v.includes("„")).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it("benutzen im deutschen Wörterbuch keine englische Anführungs-Typografie", () => {
    const offenders = Object.entries(DE).filter(([, v]) => v.includes("”")).map(([k]) => k);
    expect(offenders).toEqual([]);
  });
});
