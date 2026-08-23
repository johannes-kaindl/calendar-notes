import type { FieldSchema, ObjectSchema } from "../core/commands/schema";
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
