import type { SyncSnapshot } from "../dav/sync";
import type { FmVal } from "../mirror/profile";

export interface ObjectNoteState {
  path: string;
  written: Record<string, FmVal>;
  hash: string;
}
export interface ObjectState {
  uid: string;
  etag: string;
  raw: string;
  notes: Record<string, ObjectNoteState>; // key "" = Master/Kontakt, key <recurrenceId> = Override-Notiz
  history: { etag: string; raw: string; at: string }[];
}
export interface RunInfo {
  at: string;
  ok: boolean;
  error?: string;
  counts: { created: number; updated: number; skipped: number; archived: number; deleted: number; errors: number };
}
export interface CollectionState {
  version: 1;
  source: string;
  snapshot: SyncSnapshot;
  objects: Record<string, ObjectState>; // hrefPath → state
  lastRun?: RunInfo;
}
export const HISTORY_MAX = 10;

export function emptyState(source: string): CollectionState {
  return { version: 1, source, snapshot: { etags: {} }, objects: {} };
}

export function upsertObject(
  s: CollectionState,
  hrefPath: string,
  o: { uid: string; etag: string; raw: string; written: Record<string, FmVal>; hash: string; notePath: string; recurrenceId?: string; at: string },
): CollectionState {
  const prev = s.objects[hrefPath];
  const history = prev && prev.etag !== o.etag ? [{ etag: prev.etag, raw: prev.raw, at: o.at }, ...prev.history].slice(0, HISTORY_MAX) : (prev?.history ?? []);
  const notes = { ...(prev?.notes ?? {}), [o.recurrenceId ?? ""]: { path: o.notePath, written: { ...o.written }, hash: o.hash } };
  const next: ObjectState = { uid: o.uid, etag: o.etag, raw: o.raw, notes, history };
  return { ...s, objects: { ...s.objects, [hrefPath]: next } };
}
export function removeObject(s: CollectionState, hrefPath: string): CollectionState {
  const objects = { ...s.objects };
  delete objects[hrefPath];
  return { ...s, objects };
}
export function withSnapshot(s: CollectionState, snap: SyncSnapshot): CollectionState {
  return { ...s, snapshot: { ...snap, etags: { ...snap.etags } } };
}
export function withRun(s: CollectionState, run: RunInfo): CollectionState {
  return { ...s, lastRun: run };
}

interface LegacyObjectState {
  uid?: unknown; etag?: unknown; raw?: unknown;
  notePaths?: Record<string, string>;
  written?: Record<string, FmVal>;
  hash?: unknown;
  notes?: Record<string, ObjectNoteState>;
  history?: unknown;
}

function migrateObject(o: LegacyObjectState): ObjectState {
  const uid = typeof o.uid === "string" ? o.uid : "";
  const etag = typeof o.etag === "string" ? o.etag : "";
  const raw = typeof o.raw === "string" ? o.raw : "";
  const history = Array.isArray(o.history) ? (o.history as ObjectState["history"]) : [];
  if (o.notes && typeof o.notes === "object") {
    return { uid, etag, raw, notes: o.notes, history };
  }
  // altes Schema: notePaths + written + hash galten fuer alle Pfade gemeinsam
  const notePaths = o.notePaths && typeof o.notePaths === "object" ? o.notePaths : {};
  const written = o.written && typeof o.written === "object" ? o.written : {};
  const hash = typeof o.hash === "string" ? o.hash : "";
  const notes: Record<string, ObjectNoteState> = {};
  for (const [key, path] of Object.entries(notePaths)) notes[key] = { path, written, hash };
  return { uid, etag, raw, notes, history };
}

export function parseState(json: unknown, source: string): CollectionState {
  if (!json || typeof json !== "object") return emptyState(source);
  const j = json as Record<string, unknown>;
  if (j["version"] !== 1 || typeof j["source"] !== "string" || !j["objects"] || typeof j["objects"] !== "object" || !j["snapshot"] || typeof j["snapshot"] !== "object") {
    return emptyState(source);
  }
  const rawObjects = j["objects"] as Record<string, LegacyObjectState>;
  const objects: Record<string, ObjectState> = {};
  for (const [hp, o] of Object.entries(rawObjects)) {
    if (!o || typeof o !== "object") continue;
    objects[hp] = migrateObject(o);
  }
  return {
    version: 1,
    source,
    snapshot: j["snapshot"] as SyncSnapshot,
    objects,
    ...(j["lastRun"] ? { lastRun: j["lastRun"] as RunInfo } : {}),
  };
}
