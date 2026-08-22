import type { CommandPlan } from "../commands/types";
import { deleteObject, getObject, headEtag, putObject } from "../dav/client";
import { DavError } from "../dav/types";
import { hrefPath } from "../dav/url";
import { applyDelta } from "../mirror/apply";
import type { NotePlan } from "../mirror/plan";
import { effectiveProfile, sourceOf, type PluginSettings } from "../settings";
import type { SyncDeps } from "./types";

export type ExecuteResult =
  | { ok: true; uid: string; etag: string | null; resynced: boolean }
  | { ok: false; conflict: true; freshEtag?: string }
  | { ok: false; conflict: false; error: string };

interface Resolved {
  collectionId: string;
  transport: ReturnType<SyncDeps["transportFor"]>;
}

function resolve(deps: SyncDeps, settings: PluginSettings, plan: CommandPlan): Resolved | { error: string } {
  const col = settings.collections.find((c) => sourceOf(c) === plan.target.source);
  if (!col) return { error: "Sammlung nicht gefunden" };
  const account = settings.accounts.find((a) => a.id === col.accountId);
  if (!account) return { error: "Konto nicht gefunden" };
  if (!effectiveProfile(settings, col)) return { error: "Profil nicht gefunden" };
  const secret = deps.secrets.get(account.secretId);
  if (secret === null || secret === "") return { error: "Kein Passwort auf diesem Gerät hinterlegt" };
  const transport = deps.transportFor(account, secret);
  return { collectionId: col.id, transport };
}

/**
 * Fragt genau EIN Objekt frisch vom Server ab und speist es als gezielten
 * (Ein-Objekt-)Delta durch `applyDelta` — statt eines vollen Collection-Sync-Laufs
 * nach jedem Kommando. Fehlt das Objekt (404 → geloescht), wird es als `deleted`
 * behandelt; sonst als `changed`. Pläne werden ausgefuehrt, Zustand gespeichert.
 */
export async function resyncObject(deps: SyncDeps, settings: PluginSettings, collectionId: string, href: string): Promise<{ plans: NotePlan[] }> {
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
    else throw e;
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

  for (const plan of applyResult.plans) {
    await deps.executor.execute(plan);
  }
  await deps.stateStore.save(applyResult.state);

  return { plans: applyResult.plans };
}

/**
 * Fuehrt einen `CommandPlan` gegen den Server aus (PUT/DELETE mit If-Match /
 * If-None-Match) und synct das betroffene Objekt danach gezielt zurueck
 * (`resyncObject`) — statt eines vollen Sync-Laufs. Busy-Guard analog zu
 * `SyncService.runAll` (`deps.isBusy?.()`), damit ein laufender Sync nicht mit
 * einem Kommando kollidiert.
 */
export async function executeCommandPlan(deps: SyncDeps, settings: PluginSettings, plan: CommandPlan): Promise<ExecuteResult> {
  if (deps.isBusy?.()) return { ok: false, conflict: false, error: "busy" };

  const resolved = resolve(deps, settings, plan);
  if ("error" in resolved) return { ok: false, conflict: false, error: resolved.error };
  const { collectionId, transport } = resolved;
  const targetUid = "uid" in plan.target ? plan.target.uid : "";

  if (plan.delete) {
    const res = await deleteObject(transport, plan.hrefForPut, plan.etag ?? "");
    if (!res.ok) {
      if (res.conflict) {
        const freshEtag = await headEtag(transport, plan.hrefForPut);
        return { ok: false, conflict: true, ...(freshEtag !== undefined ? { freshEtag } : {}) };
      }
      return { ok: false, conflict: false, error: res.message };
    }
    await resyncObject(deps, settings, collectionId, plan.hrefForPut);
    return { ok: true, uid: targetUid, etag: res.etag, resynced: true };
  }

  const putOpts = plan.createsNew ? { ifNoneMatch: true as const } : { ifMatch: plan.etag ?? "" };
  const res = await putObject(transport, plan.hrefForPut, plan.newRaw, putOpts, plan.contentType);
  if (!res.ok) {
    if (res.conflict) {
      const freshEtag = await headEtag(transport, plan.hrefForPut);
      return { ok: false, conflict: true, ...(freshEtag !== undefined ? { freshEtag } : {}) };
    }
    return { ok: false, conflict: false, error: res.message };
  }

  const { plans } = await resyncObject(deps, settings, collectionId, plan.hrefForPut);
  const uid = plans[0]?.uid ?? targetUid;
  return { ok: true, uid, etag: res.etag, resynced: true };
}
