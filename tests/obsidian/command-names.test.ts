import { describe, expect, it } from "vitest";
import { DE, EN } from "../../src/i18n/strings";

// UI-STANDARD §11: Verb plus Gegenstand; die Ids bleiben, die Namen kommen aus den Schluesseln
// `cmd.<id>` (hier camelCase der Id). Johannes hat die drei Namen am 2026-11-01 per Klickfrage gewaehlt.
const NAMEN: Array<[string, string, string]> = [
  ["cmd.newEvent", "Create event…", "Termin anlegen…"],
  ["cmd.newContact", "Create contact…", "Kontakt anlegen…"],
  ["cmd.syncPreview", "Preview sync (dry run)", "Synchronisation als Vorschau anzeigen"],
];

describe("Befehlsnamen nach UI-STANDARD §11", () => {
  it.each(NAMEN)("%s: EN und DE", (key, en, de) => {
    expect(EN[key]).toBe(en);
    expect(DE[key]).toBe(de);
  });
});
