import type { SyncDelta } from "../dav/sync";
import { hrefPath } from "../dav/url";
import { parseContact, type ContactData } from "../vcard/contact";
import { parseEvents, type EventData } from "../ical/event";
import { eventOccursWithin } from "../ical/recur";
import { contactValues, eventValues, type AttendeeResolver } from "./fields";
import { renderContactBlock, renderEventBlock } from "./body";
import { noteBasename, notePath } from "./filename";
import { planUpsert, planRemoval, planArchive, type ExistingNote, type NotePlan } from "./plan";
import type { MappingProfile, ProfileKind } from "./profile";
import type { Window } from "./window";
import { upsertObject, removeObject, withSnapshot, type CollectionState, type RunInfo } from "../state/collection-state";

export interface NoteLookup {
  byUid(uid: string, source: string, recurrenceId?: string): ExistingNote | undefined;
  byPath(path: string): ExistingNote | undefined;
  exists(path: string): boolean;
  hasBacklinks(path: string): boolean;
}
export interface ApplyInput {
  kind: ProfileKind;
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

function freePath(profile: MappingProfile, base: string, lookup: NoteLookup, taken: Set<string>): string {
  for (let n = 1; n < 100; n++) {
    const p = notePath(profile, base, n === 1 ? undefined : n);
    if (!lookup.exists(p) && !taken.has(p)) return p;
  }
  return notePath(profile, base, 99);
}

interface Item {
  data: ContactData | EventData;
  uid: string;
  recurrenceId?: string;
  values: ReturnType<typeof contactValues>;
  block: string;
}

export function applyDelta(i: ApplyInput): ApplyResult {
  const plans: NotePlan[] = [];
  const errors: ApplyResult["errors"] = [];
  const counts: RunInfo["counts"] = { created: 0, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 };
  let state = i.state;
  const taken = new Set<string>();
  const at = i.now.toISOString();
  const push = (pl: NotePlan): void => {
    plans.push(pl);
    if (pl.op === "create") counts.created++;
    else if (pl.op === "update") counts.updated++;
    else if (pl.op === "skip") counts.skipped++;
    else if (pl.op === "archive") counts.archived++;
    else counts.deleted++;
  };

  for (const obj of i.delta.changed) {
    const hp = hrefPath(obj.href);
    try {
      const items: Item[] = [];
      if (i.kind === "contact") {
        const c = parseContact(obj.data);
        items.push({ data: c, uid: c.uid, values: contactValues(c), block: renderContactBlock(c) });
      } else {
        for (const e of parseEvents(obj.data)) {
          items.push({ data: e, uid: e.uid, ...(e.recurrenceId ? { recurrenceId: e.recurrenceId } : {}), values: eventValues(e, { resolveAttendee: i.resolveAttendee, attendeeLinks: i.profile.attendeeLinks }), block: renderEventBlock(e) });
        }
      }
      const inWindow = i.kind === "event" && i.timeWindow ? eventOccursWithin(obj.data, i.timeWindow.start, i.timeWindow.end) : true;
      for (const it of items) {
        const existing = i.lookup.byUid(it.uid, i.source, it.recurrenceId);
        if (!inWindow) {
          if (existing) push(planArchive(i.profile, existing));
          continue;
        }
        const path = existing?.path ?? freePath(i.profile, noteBasename(i.profile, it.data), i.lookup, taken);
        taken.add(path);
        const prevWritten = state.objects[hp]?.written;
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
        const written = pl.op === "create" || pl.op === "update" ? pl.written : (state.objects[hp]?.written ?? {});
        const hash = pl.op === "create" || pl.op === "update" ? pl.hash : (state.objects[hp]?.hash ?? "");
        state = upsertObject(state, hp, { uid: it.uid, etag: obj.etag, raw: obj.data, written, hash, notePath: pl.path, ...(it.recurrenceId ? { recurrenceId: it.recurrenceId } : {}), at });
      }
    } catch (e) {
      errors.push({ href: obj.href, message: e instanceof Error ? e.message : String(e) });
      counts.errors++;
    }
  }
  for (const href of i.delta.deleted) {
    const hp = hrefPath(href);
    const os = state.objects[hp];
    if (!os) continue;
    for (const path of Object.values(os.notePaths)) {
      const n = i.lookup.byPath(path);
      if (n) push(planRemoval(i.profile, n, { hasBacklinks: i.lookup.hasBacklinks(path) }));
    }
    state = removeObject(state, hp);
  }
  // Objekt bleibt unveraendert im State (nicht per upsertObject aktualisiert): das Fenster wandert
  // vorwaerts, der naechste sync-token-/etag-Diff liest den Stand aus `snapshot.etags`, nicht aus
  // `state.objects[hp]` — hier wird nur archiviert, nicht der Delta-Quellwert nachgezogen.
  for (const href of i.delta.outOfWindow) {
    const os = state.objects[hrefPath(href)];
    if (!os) continue;
    for (const path of Object.values(os.notePaths)) {
      const n = i.lookup.byPath(path);
      if (n) push(planArchive(i.profile, n));
    }
  }
  state = withSnapshot(state, i.delta.snapshot);
  return { plans, state, errors, counts };
}
