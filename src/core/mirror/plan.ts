import type { FmVal, MappingProfile } from "./profile";
import { toFrontmatter, type ManagedValues } from "./fields";
import { mergeBody, userContent } from "./body";
import { managedHash, fmEquals } from "./hash";
import { eventStatusValue, nextEventStatus } from "./event-status";
import { fmKeyFor } from "./profile";

export interface ExistingNote {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export type NotePlan =
  | { op: "create"; path: string; uid: string; recurrenceId?: string; frontmatter: Record<string, FmVal>; body: string; written: Record<string, FmVal>; hash: string }
  | { op: "update"; path: string; uid: string; recurrenceId?: string; set: Record<string, FmVal>; unset: string[]; body?: string; written: Record<string, FmVal>; hash: string; handEdited: string[] }
  | { op: "skip"; path: string; uid: string; recurrenceId?: string; reason: "unchanged" | "already-archived" | "already-deleted" }
  | { op: "archive"; path: string; uid: string; set: Record<string, FmVal> }
  | { op: "delete"; path: string; uid: string; mode: "trash" | "mark"; set?: Record<string, FmVal> };

export interface UpsertInput {
  profile: MappingProfile;
  source: string;
  uid: string;
  recurrenceId?: string;
  etag: string;
  values: ManagedValues;
  block: string; // aus fields.ts / body.ts (Aufrufer rechnet sie, damit plan.ts daten-agnostisch bleibt)
  path: string; // Ziel-Pfad bei Neuanlage (Aufrufer hat Kollisionen aufgelöst)
  existing?: ExistingNote;
  prevWritten?: Record<string, FmVal>;
  state?: "live" | "archived";
}

export function planUpsert(i: UpsertInput): NotePlan {
  const p = i.profile;
  const mapped = toFrontmatter(i.values, p);
  const set: Record<string, FmVal> = { [p.uidField]: i.uid, [p.sourceField]: i.source, [p.etagField]: i.etag, [p.stateField]: i.state ?? "live", ...mapped.set };
  const unset = [...mapped.unset];
  // Status-Abbildung (nur Termine mit eventStatusMap): der Schluessel ist KEIN verwalteter Wert,
  // weil der Nutzer ihn weiterschaltet — er steht nicht in written/hash und loest kein handEdited aus.
  const statusKey = p.kind === "event" && p.eventStatusMap ? fmKeyFor(p, "status") : null;
  let rawStatus: string | null = null;
  if (statusKey) {
    const raw = set[statusKey];
    rawStatus = typeof raw === "string" ? raw : null;
    delete set[statusKey];
    const at = unset.indexOf(statusKey);
    if (at >= 0) unset.splice(at, 1);
  }
  if (i.recurrenceId) set[p.recurrenceIdField] = i.recurrenceId;
  else unset.push(p.recurrenceIdField);
  const written = { ...set };
  const hash = managedHash(set, unset, p.body === "block" ? i.block : null);
  const rid = i.recurrenceId ? { recurrenceId: i.recurrenceId } : {};

  if (!i.existing) {
    const statusFm = statusKey && p.eventStatusMap ? { [statusKey]: eventStatusValue(p.eventStatusMap, rawStatus) } : {};
    return { op: "create", path: i.path, uid: i.uid, ...rid, frontmatter: { ...p.onCreate, ...set, ...statusFm }, body: mergeBody("", i.block, p.body), written, hash };
  }

  const fm = i.existing.frontmatter;
  const effSet: Record<string, FmVal> = {};
  for (const [k, v] of Object.entries(set)) if (!fmEquals(fm[k], v)) effSet[k] = v;
  if (statusKey && p.eventStatusMap) {
    const next = nextEventStatus(p.eventStatusMap, rawStatus, fm[statusKey]);
    if (next !== undefined) effSet[statusKey] = next;
  }
  const effUnset = unset.filter((k) => Object.hasOwn(fm, k) && fm[k] !== undefined);
  const newBody = mergeBody(i.existing.body, i.block, p.body);
  const bodyChanged = newBody !== i.existing.body;
  const handEdited: string[] = [];
  if (i.prevWritten) for (const [k, v] of Object.entries(i.prevWritten)) if (!fmEquals(fm[k], v)) handEdited.push(k);
  if (Object.keys(effSet).length === 0 && effUnset.length === 0 && !bodyChanged) {
    return { op: "skip", path: i.existing.path, uid: i.uid, ...rid, reason: "unchanged" };
  }
  return { op: "update", path: i.existing.path, uid: i.uid, ...rid, set: effSet, unset: effUnset, ...(bodyChanged ? { body: newBody } : {}), written, hash, handEdited };
}

function uidOf(p: MappingProfile, n: ExistingNote): string {
  const v = n.frontmatter[p.uidField];
  return typeof v === "string" ? v : "";
}

export function planRemoval(profile: MappingProfile, existing: ExistingNote, opts: { hasBacklinks: boolean }): NotePlan {
  const uid = uidOf(profile, existing);
  if (existing.frontmatter[profile.stateField] === "deleted") return { op: "skip", path: existing.path, uid, reason: "already-deleted" };
  if (opts.hasBacklinks || userContent(existing.body) !== "") {
    return { op: "delete", path: existing.path, uid, mode: "mark", set: { [profile.stateField]: "deleted" } };
  }
  return { op: "delete", path: existing.path, uid, mode: "trash" };
}

export function planArchive(profile: MappingProfile, existing: ExistingNote): NotePlan {
  const uid = uidOf(profile, existing);
  if (existing.frontmatter[profile.stateField] === "archived") return { op: "skip", path: existing.path, uid, reason: "already-archived" };
  return { op: "archive", path: existing.path, uid, set: { [profile.stateField]: "archived" } };
}
