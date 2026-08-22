import type { CommandPlan } from "../commands/types";
import { deleteObject, getObject, headEtag, putObject } from "../dav/client";
import { DavError } from "../dav/types";
import { hrefPath } from "../dav/url";
import { applyDelta } from "../mirror/apply";
import type { NotePlan } from "../mirror/plan";
import { effectiveProfile, sourceOf, type PluginSettings } from "../settings";
import type { SyncDeps } from "./types";

/** Neutrale Fehlercodes statt deutschsprachiger Strings (`src/core/**` bleibt i18n-frei) —
 *  die Obsidian-Schicht uebersetzt ueber `execute.error.<code>` (s. `obsidian/execute-i18n.ts`). */
export type ExecuteErrorCode = "collection-not-found" | "account-not-found" | "profile-not-found" | "no-secret" | "busy" | "transport-error";

export type ExecuteResult =
  | { ok: true; uid: string; etag: string | null; resynced: boolean; resyncError?: string }
  | { ok: false; conflict: true; freshEtag?: string }
  | { ok: false; conflict: false; error: ExecuteErrorCode };

interface Resolved {
  collectionId: string;
  transport: ReturnType<SyncDeps["transportFor"]>;
}

function resolve(deps: SyncDeps, settings: PluginSettings, plan: CommandPlan): Resolved | { error: ExecuteErrorCode } {
  const col = settings.collections.find((c) => sourceOf(c) === plan.target.source);
  if (!col) return { error: "collection-not-found" };
  const account = settings.accounts.find((a) => a.id === col.accountId);
  if (!account) return { error: "account-not-found" };
  if (!effectiveProfile(settings, col)) return { error: "profile-not-found" };
  const secret = deps.secrets.get(account.secretId);
  if (secret === null || secret === "") return { error: "no-secret" };
  const transport = deps.transportFor(account, secret);
  return { collectionId: col.id, transport };
}

/** Schreibt den vom Server soeben bestaetigten etag direkt in `state.snapshot.etags` — der
 *  Fallback, wenn `resyncObject` selbst nicht bis zum Speichern kommt (GET dort scheitert
 *  nicht-404, s. unten): der PUT/DELETE ist bereits durch, der naechste echte Sync-Lauf soll
 *  dieses Objekt trotzdem nicht erneut als "geaendert" auffassen. `null`/gelöscht → Eintrag
 *  entfernt; ein PUT ohne zurueckgegebenen etag laesst den vorhandenen Eintrag unangetastet
 *  (kein besserer Wert bekannt, lieber stehen lassen als raten). */
async function persistKnownEtag(deps: SyncDeps, settings: PluginSettings, collectionId: string, href: string, isDelete: boolean, etag: string | null): Promise<void> {
  const col = settings.collections.find((c) => c.id === collectionId);
  if (!col) return;
  const source = sourceOf(col);
  const state = await deps.stateStore.load(source);
  const hp = hrefPath(href);
  const etags = { ...state.snapshot.etags };
  if (isDelete) delete etags[hp];
  else if (etag !== null) etags[hp] = etag;
  else return;
  await deps.stateStore.save({ ...state, snapshot: { ...state.snapshot, etags } });
}

/**
 * Fragt genau EIN Objekt frisch vom Server ab und speist es als gezielten
 * (Ein-Objekt-)Delta durch `applyDelta` — statt eines vollen Collection-Sync-Laufs
 * nach jedem Kommando. Fehlt das Objekt (404 → geloescht), wird es als `deleted`
 * behandelt; sonst als `changed`. Pläne werden ausgefuehrt, Zustand gespeichert.
 *
 * Robust gegen Fehler NACH dem bereits erfolgreichen Server-Schreiben (PUT/DELETE laufen
 * VOR `resyncObject`): ein nicht-404-GET-Fehler liefert `{ plans: [], error }` ohne zu werfen
 * (kein State-Update moeglich — der Aufrufer haelt den bekannten neuen etag separat fest,
 * s. `persistKnownEtag`); ein Executor-Fehler bei einzelnen Notiz-Plaenen wird gesammelt,
 * der State (etag/raw/written, aus `applyDelta` unabhaengig vom Notiz-Schreiben) wird
 * TROTZDEM gespeichert — der naechste echte Sync-Lauf soll das Objekt nicht nochmal als
 * "geaendert" sehen, nur weil der lokale Notiz-Schreibvorgang stolperte.
 */
export async function resyncObject(deps: SyncDeps, settings: PluginSettings, collectionId: string, href: string): Promise<{ plans: NotePlan[]; error?: string }> {
  const col = settings.collections.find((c) => c.id === collectionId);
  if (!col) return { plans: [] };
  const account = settings.accounts.find((a) => a.id === col.accountId);
  const profile = effectiveProfile(settings, col);
  if (!account || !profile) return { plans: [] };
  const secret = deps.secrets.get(account.secretId);
  if (secret === null || secret === "") return { plans: [] };
  const transport = deps.transportFor(account, secret);
  const source = sourceOf(col);
  const state = await deps.stateStore.load(source);
  const lookup = await deps.lookupFor(profile);
  const resolveAttendee = deps.resolveAttendee?.();
  const now = deps.now();
  const hp = hrefPath(href);

  let deleted = false;
  let obj: { href: string; etag: string; data: string } | undefined;
  try {
    obj = await getObject(transport, href);
  } catch (e) {
    if (e instanceof DavError && e.status === 404) deleted = true;
    else return { plans: [], error: e instanceof Error ? e.message : String(e) };
  }

  const etags = { ...state.snapshot.etags };
  if (deleted) delete etags[hp];
  else if (obj) etags[hp] = obj.etag;
  const snapshot = { ...state.snapshot, etags };

  const applyResult = applyDelta({
    profile,
    source,
    delta: {
      changed: deleted || !obj ? [] : [obj],
      deleted: deleted ? [href] : [],
      outOfWindow: [],
      snapshot,
      strategy: "etag-diff",
      unchanged: false,
    },
    state,
    lookup,
    now,
    ...(resolveAttendee ? { resolveAttendee } : {}),
  });

  const execErrors: string[] = [];
  for (const plan of applyResult.plans) {
    try {
      await deps.executor.execute(plan);
      deps.events?.emit("changed", { path: plan.path, op: plan.op, uid: plan.uid });
    } catch (e) {
      execErrors.push(e instanceof Error ? e.message : String(e));
    }
  }
  await deps.stateStore.save(applyResult.state);

  return { plans: applyResult.plans, ...(execErrors.length > 0 ? { error: execErrors.join("; ") } : {}) };
}

/**
 * Fuehrt einen `CommandPlan` gegen den Server aus (PUT/DELETE mit If-Match /
 * If-None-Match) und synct das betroffene Objekt danach gezielt zurueck
 * (`resyncObject`) — statt eines vollen Sync-Laufs. Haelt `deps.busy` (core/sync/busy.ts)
 * fuer die GESAMTE Dauer (PUT/DELETE + Resync) belegt — bidirektional mit `SyncService`
 * geteilt, ein laufender Sync-Lauf laesst ein Kommando also ebenfalls mit busy abbrechen.
 */
export async function executeCommandPlan(deps: SyncDeps, settings: PluginSettings, plan: CommandPlan): Promise<ExecuteResult> {
  if (!deps.busy.tryAcquire()) return { ok: false, conflict: false, error: "busy" };
  try {
    return await executeCommandPlanLocked(deps, settings, plan);
  } finally {
    deps.busy.release();
  }
}

async function executeCommandPlanLocked(deps: SyncDeps, settings: PluginSettings, plan: CommandPlan): Promise<ExecuteResult> {
  const resolved = resolve(deps, settings, plan);
  if ("error" in resolved) return { ok: false, conflict: false, error: resolved.error };
  const { collectionId, transport } = resolved;
  const targetUid = "uid" in plan.target ? plan.target.uid : "";

  if (plan.delete) {
    let res;
    try {
      res = await deleteObject(transport, plan.hrefForPut, plan.etag ?? "");
    } catch {
      return { ok: false, conflict: false, error: "transport-error" };
    }
    if (!res.ok) {
      if (res.conflict) {
        const freshEtag = await headEtag(transport, plan.hrefForPut);
        return { ok: false, conflict: true, ...(freshEtag !== undefined ? { freshEtag } : {}) };
      }
      return { ok: false, conflict: false, error: "transport-error" };
    }
    const resync = await resyncObject(deps, settings, collectionId, plan.hrefForPut);
    if (resync.error && resync.plans.length === 0) await persistKnownEtag(deps, settings, collectionId, plan.hrefForPut, true, res.etag);
    return { ok: true, uid: targetUid, etag: res.etag, resynced: !resync.error, ...(resync.error ? { resyncError: resync.error } : {}) };
  }

  const putOpts = plan.createsNew ? { ifNoneMatch: true as const } : { ifMatch: plan.etag ?? "" };
  let res;
  try {
    res = await putObject(transport, plan.hrefForPut, plan.newRaw, putOpts, plan.contentType);
  } catch {
    return { ok: false, conflict: false, error: "transport-error" };
  }
  if (!res.ok) {
    if (res.conflict) {
      const freshEtag = await headEtag(transport, plan.hrefForPut);
      return { ok: false, conflict: true, ...(freshEtag !== undefined ? { freshEtag } : {}) };
    }
    return { ok: false, conflict: false, error: "transport-error" };
  }

  const resync = await resyncObject(deps, settings, collectionId, plan.hrefForPut);
  if (resync.error && resync.plans.length === 0) await persistKnownEtag(deps, settings, collectionId, plan.hrefForPut, false, res.etag);
  const uid = resync.plans[0]?.uid ?? targetUid;
  return { ok: true, uid, etag: res.etag, resynced: !resync.error, ...(resync.error ? { resyncError: resync.error } : {}) };
}
