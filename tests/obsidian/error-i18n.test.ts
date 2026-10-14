import { describe, it, expect } from "vitest";
import { initI18n, EN, DE } from "../../src/i18n/strings";
import { describeError } from "../../src/obsidian/error-i18n";
import { CORE_ERROR_CODES, CoreError } from "../../src/core/errors";
import { DavError } from "../../src/core/dav/types";

describe("describeError", () => {
  it.each(CORE_ERROR_CODES)("%s hat einen englischen und einen deutschen Text", (code) => {
    expect(EN[`core.error.${code}`], `EN ${code}`).toBeTruthy();
    expect(DE[`core.error.${code}`], `DE ${code}`).toBeTruthy();
  });

  it("uebersetzt einen CoreError samt Argumenten in die Oberflaechensprache", () => {
    const e = new CoreError("indexOutOfRange", "Index out of range: 5", [5]);
    initI18n("en");
    expect(describeError(e)).toBe("There is no entry number 5");
    initI18n("de");
    expect(describeError(e)).toBe("Eintrag Nummer 5 gibt es nicht");
  });

  it("uebersetzt einen DavError mit Code und laesst einen ohne Code bei seiner Meldung", () => {
    initI18n("de");
    expect(describeError(new DavError(401, "Access denied (401)", "https://x/", "accessDenied", [401]))).toBe("Zugang verweigert (401)");
    expect(describeError(new DavError(500, "GET /a → 500", "/a"))).toBe("GET /a → 500");
  });

  it("faellt bei fremden Fehlern und Nicht-Fehlern auf die Meldung zurueck", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("text")).toBe("text");
  });
});
