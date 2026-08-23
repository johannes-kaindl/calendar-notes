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

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Ruling (Review-Runde 3, C1): KEINE Zeitzonen-Offsets (`+01:00`) akzeptieren — nur
// "floating" (kein Suffix, tzid kommt separat aus dem Feld `tzid`) oder `Z` (UTC). Ein
// Offset waere nur HALB ehrlich: `parseIsoParts`/`isoToTime` (core/ical/mutate.ts) werten
// ihn nie aus, ein akzeptierter aber ignorierter Offset waere ein stiller Datenverlust.
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?Z?$/;

function checkFormat(field: string, format: "date-time" | "date" | "email" | "uri" | "multiline", value: string, errors: string[]): void {
  switch (format) {
    case "date-time":
      if (!DATE_TIME_RE.test(value)) errors.push(`${field}: ungueltiges Datum/Zeit-Format`);
      break;
    case "date":
      if (!DATE_RE.test(value)) errors.push(`${field}: ungueltiges Datumsformat (YYYY-MM-DD)`);
      break;
    case "email":
      if (!value.includes("@")) errors.push(`${field}: keine gueltige E-Mail-Adresse`);
      break;
    case "uri":
    case "multiline":
      break;
  }
}

function checkField(field: string, schema: FieldSchema, value: unknown, errors: string[]): void {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") { errors.push(`${field}: muss ein String sein`); return; }
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${field}: zu kurz (min. ${schema.minLength})`);
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${field}: muss einer von [${schema.enum.join(", ")}] sein`);
      if (schema.format) checkFormat(field, schema.format, value, errors);
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) { errors.push(`${field}: muss eine Zahl sein`); return; }
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${field}: unterschreitet Minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${field}: ueberschreitet Maximum ${schema.maximum}`);
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") errors.push(`${field}: muss ein boolean sein`);
      break;
    }
    case "array": {
      if (!Array.isArray(value)) { errors.push(`${field}: muss ein Array sein`); return; }
      value.forEach((item, i) => {
        if (typeof item !== "string") { errors.push(`${field}[${i}]: muss ein String sein`); return; }
        if (schema.items.format) checkFormat(`${field}[${i}]`, schema.items.format, item, errors);
      });
      break;
    }
  }
}

export function validateInput(schema: ObjectSchema, input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["Eingabe ist kein Objekt"] };
  const o = input as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(o, key) || o[key] === undefined) errors.push(`${key}: fehlt (required)`);
  }
  for (const [key, value] of Object.entries(o)) {
    const fieldSchema = schema.properties[key];
    if (!fieldSchema) { errors.push(`${key}: unbekanntes Feld`); continue; }
    if (value === undefined) continue;
    checkField(key, fieldSchema, value, errors);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: o };
}
