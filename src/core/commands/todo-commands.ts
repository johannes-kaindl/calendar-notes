import type { TodoData } from "../ical/todo";
import { parseTodos, primaryTodo } from "../ical/todo";
import { newTodoIcs } from "../ical/mutate";
import { reverseStatus, reversePriority } from "../mirror/todo-reverse";
import { fmKeyFor, type MappingProfile } from "../mirror/profile";
import type { CommandContext, CommandPlan, CommandTarget } from "./types";

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

export type TodoServerFeld = (typeof TODO_SUPPORTED)[number];

/**
 * Welches Server-Feld traegt dieser Frontmatter-Schluessel — oder keines?
 *
 * Die eine Stelle, an der diese Frage beantwortet wird. `planTodoHandEdits` braucht die
 * Antwort, um zu mutieren, das Auswahl-Modal, um VORHER anzuzeigen, was nicht mitgeht
 * (Spec §4). Beide auf dieselbe Funktion zu setzen ist der Punkt: zwei Kopien der Regel
 * liefen auseinander, und der Nutzer saehe dann eine Ankuendigung, die das Senden nicht
 * einhaelt — in beide Richtungen unbemerkt, weil kein Test die Haelften vergleicht.
 */
export function todoServerFeld(profile: MappingProfile, fmKey: string): TodoServerFeld | undefined {
  return TODO_SUPPORTED.find((f) => fmKeyFor(profile, f) === fmKey);
}

/** Die Teilmenge der geaenderten Frontmatter-Schluessel, fuer die es kein Server-Feld gibt. */
export function nichtUebertragbareKeys(profile: MappingProfile, changedKeys: string[]): string[] {
  return changedKeys.filter((k) => todoServerFeld(profile, k) === undefined);
}

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

/** Liest einen Frontmatter-Wert ueber die Profil-Abbildung statt ueber einen festen Namen —
 *  `start` heisst im Default-Profil `scheduled`, `categories` heisst `tags`. Wer den
 *  Server-Feldnamen als Frontmatter-Key nimmt, findet nichts und legt still eine leere
 *  Aufgabe an. */
function fmWert(ctx: CommandContext, fm: Record<string, unknown>, serverField: string): unknown {
  const key = fmKeyFor(ctx.profile, serverField);
  return key === null ? undefined : fm[key];
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Eine im Vault entstandene Aufgabe zum Server-Objekt machen.
 *
 * Die UID wird hier erzeugt, nicht vom Server vergeben: CalDAV verlangt sie im Body, und der
 * Name der Ressource leitet sich davon ab. Beide muessen uebereinstimmen — laufen sie
 * auseinander, findet der naechste Sync die Notiz nicht wieder. `ctx.rand` ist injizierbar,
 * damit der Test einen festen Namen bekommt.
 *
 * `createsNew: true` waehlt in `executeCommandPlanLocked` den `If-None-Match: *`-Header. Das
 * schuetzt gegen eine Ressource, die zwischen Planung und Ausfuehrung unter demselben Namen
 * entstanden ist — unwahrscheinlich, aber der Header kostet nichts und die Alternative waere
 * ein stilles Ueberschreiben.
 *
 * Status und Prioritaet laufen ueber dieselbe bewahrende Rueckabbildung wie beim
 * Zurueckschreiben. Beim Anlegen gibt es kein "Vorher", also ist `alt` immer `undefined`;
 * liefert die Abbildung nichts, faellt `newTodoIcs` auf `NEEDS-ACTION` zurueck statt zu raten.
 */
export function planTodoCreate(ctx: CommandContext, frontmatter: Record<string, unknown>): CommandPlan {
  const uid = `cn-${Math.floor(ctx.rand() * 1e9).toString(36)}-${ctx.now.getTime().toString(36)}@calendar-notes`;
  const status = reverseStatus(ctx.profile, undefined, fmWert(ctx, frontmatter, "status"));
  const prio = reversePriority(ctx.profile, undefined, fmWert(ctx, frontmatter, "priority"));
  const kategorien = fmWert(ctx, frontmatter, "categories");
  const due = text(fmWert(ctx, frontmatter, "due"));
  const start = text(fmWert(ctx, frontmatter, "start"));
  const beschreibung = text(fmWert(ctx, frontmatter, "description"));
  const newRaw = newTodoIcs({
    uid,
    summary: text(fmWert(ctx, frontmatter, "title")) ?? "",
    ...(due !== undefined ? { due } : {}),
    ...(start !== undefined ? { start } : {}),
    ...(beschreibung !== undefined ? { description: beschreibung } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof prio === "number" ? { priority: prio } : {}),
    ...(Array.isArray(kategorien) ? { categories: kategorien.map(String) } : {}),
  }, { now: ctx.now });
  const after = primaryTodo(parseTodos(newRaw));
  if (!after) throw new Error("planTodoCreate: erzeugtes ICS enthaelt kein VTODO");
  return {
    commandId: "todo.create", target: ctx.target,
    summary: "Create task on the server", summaryKey: "plan.todo.create.summary", summaryArgs: [],
    diff: diffTodoFields(undefined, after), newRaw,
    contentType: "text/calendar", hrefForPut: `${ctx.collection.href}${uid}.ics`, createsNew: true,
  };
}
