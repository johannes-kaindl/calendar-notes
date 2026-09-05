import type { TodoData } from "../ical/todo";
import type { CommandTarget } from "./types";

/**
 * Die Server-Felder einer Aufgabe, die aus dem Vault heraus geschrieben werden duerfen.
 *
 * Bewusst NICHT dabei: `completed` und `percent` (die leitet der Statuswechsel ab — sie von
 * Hand schreibbar zu machen erlaubte widerspruechliche Zustaende, s. `applyTodoMutation`),
 * `rrule` (Nicht-Ziel), `uid`/`last_modified` (gehoeren dem Server), `allday`/`tzid` (haengen
 * an `due`/`start` und werden mit ihnen gesetzt).
 *
 * Was hier fehlt, verschwindet nicht still: `planPushHandEdits` meldet es in `skipped`.
 */
export const TODO_SUPPORTED = ["title", "due", "start", "description", "status", "priority", "categories"] as const;

export function hrefOfTodoTarget(target: CommandTarget): string {
  if (!("href" in target) || !target.href) throw new Error("todo-Kommando ohne href im Target");
  return target.href;
}

/** Ein Feldwert als Anzeigezeile. Der Parametertyp ist bewusst `TodoData[keyof TodoData]`
 *  und nicht `unknown`: die Felder einer Aufgabe sind Text, Zahl, Wahrheitswert oder
 *  Textliste — nie ein Objekt. Mit `unknown` waere `String(v)` fuer ein Objekt
 *  `"[object Object]"`, und der Diff zeigte dem Nutzer Unsinn statt eines Werts. */
function zeile(v: TodoData[keyof TodoData]): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/**
 * Vorher/Nachher je Feld — die Vorlage fuer die Diff-Tabelle im Vorschau-Modal.
 *
 * `before === undefined` ist der Erstanlage-Fall (es gibt kein Vorher); die Darstellung zeigt
 * dann nur die Nachher-Spalte.
 */
export function diffTodoFields(before: TodoData | undefined, after: TodoData): { field: string; before?: string; after?: string }[] {
  const felder: (keyof TodoData)[] = ["summary", "due", "start", "description", "status", "priority", "categories"];
  const out: { field: string; before?: string; after?: string }[] = [];
  for (const f of felder) {
    const b = zeile(before?.[f]);
    const a = zeile(after[f]);
    if (b !== a) out.push({ field: String(f), ...(b !== undefined ? { before: b } : {}), ...(a !== undefined ? { after: a } : {}) });
  }
  return out;
}
