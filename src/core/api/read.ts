import { parseEvents, primaryEvent } from "../ical/event";
import { effectiveProfile, sourceOf, type CollectionConfig, type PluginSettings } from "../settings";
import type { CollectionState } from "../state/collection-state";
import { parseContact } from "../vcard/contact";
import type { ApiContact, ApiEvent, ContactsQuery, EventsQuery } from "./types";
import { assertNever } from "../mirror/kind";

/** Ein geladener Collection-State + die zugehoerige Konfiguration — der Aufrufer
 *  (`src/obsidian/api.ts`) laedt die States (braucht `StateStore`, also nicht pure),
 *  diese Funktionen hier werten sie nur noch aus (pure, `check:pure`-tauglich,
 *  ohne Obsidian direkt testbar). */
export interface CollectionStateEntry {
  collection: CollectionConfig;
  state: CollectionState;
}

function masterPath(state: CollectionState, hp: string): string | undefined {
  return state.objects[hp]?.notes[""]?.path;
}

export function collectEvents(settings: PluginSettings, entries: CollectionStateEntry[], q?: EventsQuery): ApiEvent[] {
  const out: ApiEvent[] = [];
  for (const { collection, state } of entries) {
    if (q?.collectionId && collection.id !== q.collectionId) continue;
    const profile = effectiveProfile(settings, collection);
    if (!profile || profile.kind !== "event") continue;
    const source = sourceOf(collection);
    for (const [hp, obj] of Object.entries(state.objects)) {
      let data;
      try {
        data = primaryEvent(parseEvents(obj.raw));
      } catch {
        continue;
      }
      if (!data) continue;
      if (q?.from && data.start < q.from) continue;
      if (q?.to && data.start > q.to) continue;
      out.push({ uid: obj.uid, source, collectionId: collection.id, ...(masterPath(state, hp) ? { path: masterPath(state, hp) } : {}), data });
    }
  }
  return out;
}

export function collectContacts(settings: PluginSettings, entries: CollectionStateEntry[], q?: ContactsQuery): ApiContact[] {
  const out: ApiContact[] = [];
  const needle = q?.query?.toLowerCase();
  for (const { collection, state } of entries) {
    if (q?.collectionId && collection.id !== q.collectionId) continue;
    const profile = effectiveProfile(settings, collection);
    if (!profile || profile.kind !== "contact") continue;
    const source = sourceOf(collection);
    for (const [hp, obj] of Object.entries(state.objects)) {
      let data;
      try {
        data = parseContact(obj.raw);
      } catch {
        continue;
      }
      if (needle) {
        const haystack = [data.fn, ...data.emails.map((e) => e.value)].join(" ").toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      out.push({ uid: obj.uid, source, collectionId: collection.id, ...(masterPath(state, hp) ? { path: masterPath(state, hp) } : {}), data });
    }
  }
  return out;
}

/** `get(ref)` — sucht ueber alle Sammlungen (oder nur `ref.source`, falls angegeben) nach
 *  `uid` und liefert das passende Termin- oder Kontakt-Objekt. `null`, wenn nichts passt. */
export function findByUid(settings: PluginSettings, entries: CollectionStateEntry[], ref: { uid: string; source?: string }): ApiEvent | ApiContact | null {
  for (const { collection, state } of entries) {
    const source = sourceOf(collection);
    if (ref.source && source !== ref.source) continue;
    const profile = effectiveProfile(settings, collection);
    if (!profile) continue;
    const entry = Object.entries(state.objects).find(([, o]) => o.uid === ref.uid);
    if (!entry) continue;
    const [hp, obj] = entry;
    const path = masterPath(state, hp);
    if (profile.kind === "event") {
      try {
        const data = primaryEvent(parseEvents(obj.raw));
        if (data) return { uid: obj.uid, source, collectionId: collection.id, ...(path ? { path } : {}), data };
      } catch {
        continue;
      }
    } else if (profile.kind === "contact") {
      try {
        const data = parseContact(obj.raw);
        return { uid: obj.uid, source, collectionId: collection.id, ...(path ? { path } : {}), data };
      } catch {
        continue;
      }
    } else {
      assertNever(profile.kind, "API-Lesen");
    }
  }
  return null;
}
