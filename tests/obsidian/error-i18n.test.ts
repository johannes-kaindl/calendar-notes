import { describe, it, expect } from "vitest";
import { initI18n, EN, DE, t } from "../../src/i18n/strings";
import { describeError } from "../../src/obsidian/error-i18n";
import { CORE_ERROR_CODES, CoreError, type CoreErrorCode } from "../../src/core/errors";
import { codedErrorOf } from "../../src/vendor/code-kit/coded-error";
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

  it("zeigt bei einem Code ohne Uebersetzung die englische Meldung statt des Schluessels", () => {
    const e = new CoreError("ohneUebersetzung" as CoreErrorCode, "No translation for this case", [7]);
    initI18n("de");
    // Vorbedingung: der Uebersetzer reicht den Schluessel selbst zurueck, sonst prueft der Fall nichts.
    expect(t("core.error.ohneUebersetzung", 7)).toBe("core.error.ohneUebersetzung");
    expect(describeError(e)).toBe("No translation for this case");
  });

  it("erkennt einen Fehler mit Code an seiner Form, nicht an der Klasse (CoreError und DavError)", () => {
    expect(codedErrorOf(new CoreError("noRaw", "m", [1]))).toEqual({ code: "noRaw", args: [1] });
    expect(codedErrorOf(new DavError(401, "m", "/x", "accessDenied", [401]))).toEqual({ code: "accessDenied", args: [401] });
    expect(codedErrorOf(new DavError(500, "m", "/x"))).toBeUndefined();
    expect(codedErrorOf(new Error("boom"))).toBeUndefined();
  });

  it("faellt bei fremden Fehlern und Nicht-Fehlern auf die Meldung zurueck", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("text")).toBe("text");
  });
});
