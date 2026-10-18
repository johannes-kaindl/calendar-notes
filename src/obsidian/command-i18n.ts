import type { FieldSchema, ObjectSchema, ValidationIssue } from "../core/commands/schema";
import type { CommandDescriptor, CommandPlan } from "../core/commands/types";
import { t } from "../i18n/strings";

/**
 * i18n-Bruecke fuer Kommando-Deskriptoren/-Plaene (M5, Task 1) — Kern bleibt i18n-frei
 * (`src/core/**`, `check:pure`), traegt aber die Schluessel (`titleKey`/`descriptionKey`/
 * `summaryKey`/`FieldSchema.descriptionKey`) UND einen englischen Fallback-Text je Feld.
 * Aufgeloest wird ausschliesslich hier, in der Obsidian-Schicht.
 *
 * `t()` (`src/vendor/code-kit/i18n.ts`) faellt bei einem im aktiven UND im EN-Woerterbuch
 * fehlenden Key auf den Key selbst zurueck ("Key-Echo") — das ist kein reiner Tippfehler-Fall:
 * `registerCommands()` ist oeffentliche API, ein Fremdplugin/Test kann eigene Deskriptoren mit
 * eigenen (oder gar keinen echten) Keys registrieren. Erkennt eine Funktion hier das Key-Echo
 * (uebersetzter Text == angefragter Key), faellt sie auf den mitgelieferten englischen
 * Fallback-Text zurueck statt den rohen Key anzuzeigen — dasselbe Muster wie `fieldLabel()`
 * in `field-labels.ts`.
 */
function trOrFallback(key: string, fallback: string, ...args: (string | number)[]): string {
  const translated = t(key, ...args);
  return translated === key ? fallback : translated;
}

/** Uebersetzter Titel eines Kommando-Deskriptors, mit Rueckfall auf `descriptor.title`. */
export function trTitle(descriptor: CommandDescriptor): string {
  return trOrFallback(descriptor.titleKey, descriptor.title);
}

/** Uebersetzte Beschreibung eines Kommando-Deskriptors, mit Rueckfall auf `descriptor.description`. */
export function trDescription(descriptor: CommandDescriptor): string {
  return trOrFallback(descriptor.descriptionKey, descriptor.description);
}

/** Titel + Beschreibung eines Deskriptors in einem Aufruf — fuer Formular-/Suggester-Anzeige. */
export function tr(descriptor: CommandDescriptor): { title: string; description: string } {
  return { title: trTitle(descriptor), description: trDescription(descriptor) };
}

/** Uebersetzte Feld-Beschreibung eines Schema-Feldes — ohne `descriptionKey` gibt es nichts zu
 *  uebersetzen (der englische Fallback ist dann bereits der gesamte Inhalt). `undefined`
 *  bleibt `undefined` (kein leerer String), damit Aufrufer wie `SchemaFormModal.renderField()`
 *  weiterhin `if (desc) …` schreiben koennen. */
export function trFieldDescription(field: FieldSchema): string | undefined {
  if (!field.descriptionKey) return field.description;
  return trOrFallback(field.descriptionKey, field.description ?? "");
}

/** Uebersetzte Kopie eines `ObjectSchema` — jede Feld-`description` durch `trFieldDescription()`
 *  ersetzt. Fuer `api.tools()` (Spec §5b): LLM-Tool-Definitionen bekommen fertigen Text in der
 *  aktuellen UI-Sprache statt Key + englischem Fallback (anders als `api.commands()`, das Key +
 *  Fallback unveraendert durchreicht, damit ein UI-Konsument selbst uebersetzen kann). */
export function trSchema(schema: ObjectSchema): ObjectSchema {
  const properties: Record<string, FieldSchema> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    const description = trFieldDescription(field);
    properties[key] = description === undefined ? field : { ...field, description };
  }
  return { ...schema, properties };
}

/** Uebersetzte `CommandPlan.summary`, mit Rueckfall auf `plan.summary` (bereits fertig
 *  formatierter englischer Text mit denselben Argumenten). */
export function trPlan(plan: CommandPlan): string {
  return trOrFallback(plan.summaryKey, plan.summary, ...plan.summaryArgs);
}

/** Der Text eines Pruefbefunds (`inputIssues`) in der Sprache der Oberflaeche. Das Kit liefert Fehlercode und Pfad, der Satz
 *  steht hier; was der Code nicht sagt (erwarteter Typ, Mindestlaenge, Auswahl, Grenzen), liest die Funktion aus dem Schema. Ein
 *  Befund ohne eigenen Satz (`unsupported-type`, `bad-schema`: ein Fehler im Schema, nicht in der Eingabe) bleibt der englische Kit-Text. */
export function describeIssue(schema: ObjectSchema, issue: ValidationIssue): string {
  const root = issue.path.replace(/\[\d+\]$/, "");
  const field: FieldSchema | undefined = Object.hasOwn(schema.properties, root) ? schema.properties[root] : undefined;
  const isItem = root !== issue.path;
  switch (issue.code) {
    case "not-object": return t("validation.notObject");
    case "missing": return t("validation.missing", issue.path);
    case "unknown-field": return t("validation.unknownField", issue.path);
    case "type": return t(`validation.type.${isItem ? "string" : (field?.type ?? "string")}`, issue.path);
    case "too-short": return field?.type === "string" && field.minLength !== undefined ? t("validation.tooShort", issue.path, field.minLength) : issue.message;
    case "not-in-enum": return field?.type === "string" && field.enum ? t("validation.notInEnum", issue.path, field.enum.join(", ")) : issue.message;
    case "format": {
      const format = field?.type === "string" ? field.format : field?.type === "array" ? field.items.format : undefined;
      return format === "date" || format === "date-time" || format === "email" ? t(`validation.format.${format}`, issue.path) : issue.message;
    }
    case "below-minimum": return field?.type === "number" && field.minimum !== undefined ? t("validation.belowMin", issue.path, field.minimum) : issue.message;
    case "above-maximum": return field?.type === "number" && field.maximum !== undefined ? t("validation.aboveMax", issue.path, field.maximum) : issue.message;
    default: return issue.message;
  }
}
