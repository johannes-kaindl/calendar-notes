import { t } from "../i18n/strings";

/** Menschenlesbares Label fuer einen Schema-Feldschluessel (`title`, `allDay`, …) — erst
 *  `form.field.<key>` aus dem Woerterbuch versuchen, sonst aus dem camelCase-/snake_case-
 *  Schluessel selbst ableiten (Fallback fuer Felder ohne eigenen i18n-Eintrag). Geteilt
 *  zwischen `command-modal.ts` (Formular-Zeilen) und `plan-preview-modal.ts`
 *  (Diff-Tabellen-Zeilen), damit beide dieselben Labels zeigen. */
export function fieldLabel(key: string): string {
  const translated = t(`form.field.${key}`);
  if (translated !== `form.field.${key}`) return translated;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
