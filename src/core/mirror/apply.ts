import type { SyncDelta } from "../dav/sync";
import { hrefPath } from "../dav/url";
import { parseContact, type ContactData } from "../vcard/contact";
import { parseEvents, type EventData } from "../ical/event";
import { parseTodos, type TodoData } from "../ical/todo";
import { eventOccursWithin } from "../ical/recur";
import { contactValues, eventValues, type AttendeeResolver } from "./fields";
import { renderContactBlock, renderEventBlock } from "./body";
import { renderTodoBlock, todoInWindow, todoValues } from "./todo-values";
import { noteBasename, notePath } from "./filename";
import { planUpsert, planRemoval, planArchive, type ExistingNote, type NotePlan } from "./plan";
import type { MappingProfile, ProfileKind } from "./profile";
import type { Window } from "./window";
import { upsertObject, removeObject, withSnapshot, type CollectionState, type RunInfo } from "../state/collection-state";
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";
import { assertNever } from "./kind";

export interface NoteLookup {
  byUid(uid: string, source: string, recurrenceId?: string): ExistingNote | undefined;
  byPath(path: string): ExistingNote | undefined;
  exists(path: string): boolean;
  hasBacklinks(path: string): boolean;
}
export interface ApplyInput {
  profile: MappingProfile;
  source: string;
  delta: SyncDelta;
  state: CollectionState;
  lookup: NoteLookup;
  now: Date;
  timeWindow?: Window;
  resolveAttendee?: AttendeeResolver;
}
export interface ApplyResult {
  plans: NotePlan[];
  state: CollectionState;
  errors: { href: string; message: string }[];
  counts: RunInfo["counts"];
}

function freePath(profile: MappingProfile, base: string, uid: string, lookup: NoteLookup, taken: Set<string>): string {
  for (let n = 1; n < 100; n++) {
    const p = notePath(profile, base, n === 1 ? undefined : n);
    if (!lookup.exists(p) && !taken.has(p)) return p;
  }
  const suffix = sha256HexUtf8(uid).slice(-6);
  return notePath(profile, `${base} ${suffix}`);
}

interface Item {
  data: ContactData | EventData | TodoData;
  uid: string;
  recurrenceId?: string;
  values: ReturnType<typeof contactValues>;
  block: string;
}

/** Boolescher Ausdruck, deshalb vom Compiler NICHT als Fallunterscheidung erkannt — die
 *  Erschoepfung steht hier von Hand (Task 4 hat diese beiden Stellen bewusst offen gelassen). */
function objectInWindow(kind: ProfileKind, raw: string, w: Window | undefined): boolean {
  if (!w) return true;
  if (kind === "contact") return true;
  if (kind === "event") return eventOccursWithin(raw, w.start, w.end);
  if (kind === "todo") return parseTodos(raw).some((t) => todoInWindow(t, w));
  return assertNever(kind, "Zeitfenster");
}

export function applyDelta(i: ApplyInput): ApplyResult {
  const plans: NotePlan[] = [];
  const errors: ApplyResult["errors"] = [];
  const counts: RunInfo["counts"] = { created: 0, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 };
  let state = i.state;
  const taken = new Set<string>();
  const erroredHps = new Set<string>();
  const at = i.now.toISOString();
  const push = (pl: NotePlan): void => {
    plans.push(pl);
    if (pl.op === "create") counts.created++;
    else if (pl.op === "update") counts.updated++;
    else if (pl.op === "skip") counts.skipped++;
    else if (pl.op === "archive") counts.archived++;
    else counts.deleted++;
  };

  const kind = i.profile.kind;
  for (const obj of i.delta.changed) {
    const hp = hrefPath(obj.href);
    try {
      const items: Item[] = [];
      if (kind === "contact") {
        const c = parseContact(obj.data);
        items.push({ data: c, uid: c.uid, values: contactValues(c), block: renderContactBlock(c) });
      } else if (kind === "event") {
        for (const e of parseEvents(obj.data)) {
          items.push({ data: e, uid: e.uid, ...(e.recurrenceId ? { recurrenceId: e.recurrenceId } : {}), values: eventValues(e, { resolveAttendee: i.resolveAttendee, attendeeLinks: i.profile.attendeeLinks }), block: renderEventBlock(e) });
        }
      } else if (kind === "todo") {
        for (const td of parseTodos(obj.data)) {
          items.push({ data: td, uid: td.uid, values: todoValues(td, i.profile), block: renderTodoBlock(td) });
        }
      } else {
        assertNever(kind, "Notiz-Plan");
      }
      const inWindow = objectInWindow(kind, obj.data, i.timeWindow);
      for (const it of items) {
        const rid = it.recurrenceId ?? "";
        const existing = i.lookup.byUid(it.uid, i.source, it.recurrenceId);
        if (!inWindow) {
          if (existing) push(planArchive(i.profile, existing));
          continue;
        }
        const path = existing?.path ?? freePath(i.profile, noteBasename(i.profile, it.data), it.uid, i.lookup, taken);
        taken.add(path);
        const prevWritten = state.objects[hp]?.notes[rid]?.written;
        const pl = planUpsert({
          profile: i.profile,
          source: i.source,
          uid: it.uid,
          ...(it.recurrenceId ? { recurrenceId: it.recurrenceId } : {}),
          etag: obj.etag,
          values: it.values,
          block: it.block,
          path,
          ...(existing ? { existing } : {}),
          ...(prevWritten ? { prevWritten } : {}),
          state: "live",
        });
        push(pl);
        const written = pl.op === "create" || pl.op === "update" ? pl.written : (state.objects[hp]?.notes[rid]?.written ?? {});
        const hash = pl.op === "create" || pl.op === "update" ? pl.hash : (state.objects[hp]?.notes[rid]?.hash ?? "");
        state = upsertObject(state, hp, { uid: it.uid, etag: obj.etag, raw: obj.data, written, hash, notePath: pl.path, ...(it.recurrenceId ? { recurrenceId: it.recurrenceId } : {}), at });
      }
    } catch (e) {
      errors.push({ href: obj.href, message: e instanceof Error ? e.message : String(e) });
      counts.errors++;
      // Objekt bleibt kaputt/unlesbar: kein neuer etag uebernommen, damit der naechste Lauf es
      // wieder als geaendert erkennt und erneut versucht statt es als erledigt zu betrachten.
      erroredHps.add(hp);
    }
  }
  for (const href of i.delta.deleted) {
    const hp = hrefPath(href);
    const os = state.objects[hp];
    if (!os) continue;
    for (const n of Object.values(os.notes)) {
      const note = i.lookup.byPath(n.path);
      if (note) push(planRemoval(i.profile, note, { hasBacklinks: i.lookup.hasBacklinks(n.path) }));
      else { errors.push({ href, message: `Notiz nicht auffindbar: ${n.path}` }); counts.errors++; }
    }
    state = removeObject(state, hp);
  }
  // Objekt bleibt bei echtem "nur aus dem Fenster gewandert" unveraendert im State (nicht per
  // upsertObject aktualisiert): das Fenster wandert vorwaerts, der naechste sync-token-/etag-Diff
  // liest den Stand aus `snapshot.etags`, nicht aus `state.objects[hp]` — hier wird nur archiviert,
  // nicht der Delta-Quellwert nachgezogen.
  //
  // ABER: unter der Kalender-Strategie (etag-diff MIT Fenster, s. `syncCollection` in
  // `src/core/dav/sync.ts`) meldet `outOfWindow` per M1-Ruling JEDEN href, der in der gefensterten
  // Server-Listing-Antwort fehlt — das trifft sowohl auf "aus dem Fenster gewandert" als auch auf
  // "vom Server geloescht, waehrend das Objekt noch im Fenster liegt" zu. Nur der gespeicherte
  // `raw`-Stand kann die beiden unterscheiden: liegt das zuletzt bekannte Ereignis noch im Fenster,
  // war es eine echte Loeschung (Server haette es sonst weiterhin in der Listing-Antwort gezeigt) —
  // dann gilt dieselbe Klassifikation wie `i.delta.deleted` oben (inkl. `byPath` undefined → Fehler).
  for (const href of i.delta.outOfWindow) {
    const hp = hrefPath(href);
    const os = state.objects[hp];
    if (!os) continue;
    const stillInWindow = i.timeWindow !== undefined && objectInWindow(kind, os.raw, i.timeWindow);
    if (stillInWindow) {
      for (const n of Object.values(os.notes)) {
        const note = i.lookup.byPath(n.path);
        if (note) push(planRemoval(i.profile, note, { hasBacklinks: i.lookup.hasBacklinks(n.path) }));
        else { errors.push({ href, message: `Notiz nicht auffindbar: ${n.path}` }); counts.errors++; }
      }
      state = removeObject(state, hp);
      continue;
    }
    for (const n of Object.values(os.notes)) {
      const note = i.lookup.byPath(n.path);
      if (note) push(planArchive(i.profile, note));
      else { errors.push({ href, message: `Notiz nicht auffindbar: ${n.path}` }); counts.errors++; }
    }
  }
  const snapshot = { ...i.delta.snapshot, etags: { ...i.delta.snapshot.etags } };
  for (const hp of erroredHps) {
    const prevEtag = i.state.snapshot.etags[hp];
    if (prevEtag !== undefined) snapshot.etags[hp] = prevEtag;
    else delete snapshot.etags[hp];
  }
  state = withSnapshot(state, snapshot);
  return { plans, state, errors, counts };
}
