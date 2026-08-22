import type { SyncSnapshot } from "../dav/sync";
import type { FmVal } from "../mirror/profile";

export interface ObjectState {
  uid: string;
  etag: string;
  raw: string;
  written: Record<string, FmVal>;
  hash: string;
  notePaths: Record<string, string>; // key "" = Master/Kontakt, key <recurrenceId> = Override-Notiz
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
  const notePaths = { ...(prev?.notePaths ?? {}), [o.recurrenceId ?? ""]: o.notePath };
  const next: ObjectState = { uid: o.uid, etag: o.etag, raw: o.raw, written: { ...o.written }, hash: o.hash, notePaths, history };
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
export function parseState(json: unknown, source: string): CollectionState {
  if (!json || typeof json !== "object") return emptyState(source);
  const j = json as Record<string, unknown>;
  if (j["version"] !== 1 || typeof j["source"] !== "string" || !j["objects"] || typeof j["objects"] !== "object" || !j["snapshot"] || typeof j["snapshot"] !== "object") {
    return emptyState(source);
  }
  return {
    version: 1,
    source,
    snapshot: j["snapshot"] as SyncSnapshot,
    objects: j["objects"] as Record<string, ObjectState>,
    ...(j["lastRun"] ? { lastRun: j["lastRun"] as RunInfo } : {}),
  };
}
