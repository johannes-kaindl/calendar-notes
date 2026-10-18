// Mini-JSON-Schema: flache Untermenge von JSON Schema fuer Kommando-Eingaben (LLM-Tool-Calling-tauglich).

// i18n (M5, Task 1 — s. Sammel-Kommentar bei `CommandDescriptor` in
// `src/core/commands/types.ts`): `description` ist der ENGLISCHE Fallback-Text (core bleibt
// i18n-frei, keine `t()`-Importe erlaubt); `descriptionKey` ist optional — nur Felder mit
// eigenem Uebersetzungs-Eintrag (`cmd.<id>.field.<name>`, s. `src/i18n/strings.ts`) tragen
// einen. Aufgeloest wird erst in der Obsidian-Schicht (`src/obsidian/command-i18n.ts`,
// `trFieldDescription()`) — `api.commands()` gibt Key + englischen Fallback unveraendert
// weiter (Konsument uebersetzt selbst), `api.tools()` uebersetzt (LLM-Tool-Definitionen
// wollen fertigen Text in der aktuellen UI-Sprache).
export type FieldSchema =
  | { type: "string"; format?: "date-time" | "date" | "email" | "uri" | "multiline"; enum?: string[]; minLength?: number; description?: string; descriptionKey?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string; descriptionKey?: string }
  | { type: "boolean"; description?: string; descriptionKey?: string }
  | { type: "array"; items: { type: "string"; format?: "email" }; description?: string; descriptionKey?: string };

export interface ObjectSchema {
  type: "object";
  properties: Record<string, FieldSchema>;
  required?: string[];
}

// Die Pruefung selbst liegt im Kit (code-kit `validate-input`, Herkunft: die lokale Fassung dieser Datei bis 0.4.1). Unterschiede
// zur frueheren lokalen Fassung, begruendet:
// - Die Meldungen sind englisch und stabil (`path: text`); die Obsidian-Schicht uebersetzt ueber den Fehlercode
//   (`describeIssue` in `src/obsidian/command-i18n.ts`), `api.execute()` reicht sie englisch weiter. Vorher stand deutscher Text im Kern.
// - `date`/`date-time` pruefen einen Tag und eine Uhrzeit, die es gibt (2026-02-30 und 25:00 fallen jetzt durch statt erst in der
//   Mutation); ein leeres `date` gilt als „nicht gesetzt“. Der Ruling C1 (kein Zeitzonen-Offset) gilt unveraendert.
// - Ein Pflichtfeld aus Leerraum zaehlt als fehlend; `integer` und ein `items` ohne Angabe sind erlaubt; unendliche Zahlen fallen durch.
// - Ein `required`-Name ohne Eintrag in `properties` ist ein Schema-Fehler (`bad-schema`) statt ein stilles Pflichtfeld.
export { emptyChoiceField, inputIssues, predeterminedInput, validateInput, unsupportedSchemaKeywords, type ValidationIssue, type ValidationResult } from "../../vendor/code-kit/validate-input";
