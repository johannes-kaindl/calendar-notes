import { describe, it, expect } from "vitest";
import { executeCommandPlan, resyncObject } from "../../../src/core/sync/execute";
import { createBusyGuard, type BusyGuard } from "../../../src/core/sync/busy";
import { createEmitter, type SyncEvents } from "../../../src/core/sync/events";
import type { SyncDeps, Notifier, PlanExecutor } from "../../../src/core/sync/types";
import type { NoteLookup } from "../../../src/core/mirror/apply";
import type { NotePlan } from "../../../src/core/mirror/plan";
import type { CommandPlan } from "../../../src/core/commands/types";
import { defaultContactProfile } from "../../../src/core/mirror/profile";
import { DEFAULT_SYNC, type Account, type CollectionConfig, type PluginSettings } from "../../../src/core/settings";
import type { DavRequest, DavResponse, Transport } from "../../../src/core/dav/types";
import { emptyState, type CollectionState } from "../../../src/core/state/collection-state";

const PROFILE = defaultContactProfile();
const ACCOUNT: Account = { id: "acc1", name: "Acc", baseUrl: "https://dav.example/", username: "u", secretId: "sec1" };
const COL: CollectionConfig = {
  id: "ab1", accountId: "acc1", href: "https://dav.example/ab1/", kind: "addressbook",
  displayName: "ab1", enabled: true, profileId: PROFILE.id, readOnly: false,
};

const CARD_HREF = "https://dav.example/ab1/card1.vcf";
const UID = "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001";
const VCARD = `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${UID}\r\nFN:Alex Aguado\r\nEND:VCARD\r\n`;

function baseSettings(): PluginSettings {
  return { version: 1, accounts: [ACCOUNT], collections: [COL], profiles: [PROFILE], sync: DEFAULT_SYNC, language: "auto" };
}

function noopLookup(): NoteLookup {
  return { byUid: () => undefined, byPath: () => undefined, exists: () => false, hasBacklinks: () => false };
}

function loggingExecutor(opts: { throwOnFirst?: boolean } = {}): PlanExecutor & { calls: NotePlan[] } {
  const calls: NotePlan[] = [];
  let n = 0;
  return {
    calls,
    execute: async (plan) => {
      n += 1;
      if (opts.throwOnFirst && n === 1) throw new Error("Vault-Schreibfehler");
      calls.push(plan);
    },
  };
}

function noopNotify(): Notifier {
  return { info: () => {}, warn: () => {}, handEdited: () => {} };
}

interface TransportOpts {
  putStatus?: number;
  putEtag?: string;
  deleteStatus?: number;
  getStatus?: number;
  getEtag?: string;
  getData?: string;
  getThrows?: boolean;
  throws?: boolean;
}

function fakeTransport(opts: TransportOpts = {}): Transport & { calls: DavRequest[] } {
  const calls: DavRequest[] = [];
  const t = (async (req: DavRequest): Promise<DavResponse> => {
    calls.push(req);
    if (opts.throws) throw new Error("Netzwerkfehler");
    if (req.method === "PUT") {
      const status = opts.putStatus ?? 201;
      return { status, headers: status < 300 ? { etag: opts.putEtag ?? '"e-new"' } : {}, text: status === 412 ? "" : "" };
    }
    if (req.method === "DELETE") {
      return { status: opts.deleteStatus ?? 204, headers: {}, text: "" };
    }
    if (req.method === "GET") {
      if (opts.getThrows) throw new Error("GET fehlgeschlagen (5xx)");
      const status = opts.getStatus ?? 200;
      if (status === 200) return { status, headers: { etag: opts.getEtag ?? '"e-new"' }, text: opts.getData ?? VCARD };
      return { status, headers: {}, text: "" };
    }
    return { status: 404, headers: {}, text: "" };
  }) as Transport & { calls: DavRequest[] };
  t.calls = calls;
  return t;
}

function makeDeps(
  opts: { transport: Transport; secret?: string | null; busy?: BusyGuard; executor?: PlanExecutor & { calls: NotePlan[] } } = { transport: fakeTransport() },
): { deps: SyncDeps; executor: ReturnType<typeof loggingExecutor>; states: Map<string, CollectionState>; busy: BusyGuard } {
  const executor = opts.executor ?? loggingExecutor();
  const states = new Map<string, CollectionState>();
  const secret = opts.secret === undefined ? "geheim" : opts.secret;
  const busy = opts.busy ?? createBusyGuard();
  const deps: SyncDeps = {
    settings: () => baseSettings(),
    saveSettings: async () => {},
    secrets: { get: () => secret, set: () => {}, has: () => secret !== null },
    stateStore: {
      load: async (source) => states.get(source) ?? emptyState(source),
      save: async (state) => { states.set(state.source, state); },
      remove: async (source) => { states.delete(source); },
    },
    busy,
    transportFor: () => opts.transport,
    lookupFor: async () => noopLookup(),
    executor,
    notify: noopNotify(),
    now: () => new Date("2026-08-22T12:00:00Z"),
  };
  return { deps, executor, states, busy };
}

function updatePlan(overrides: Partial<CommandPlan> = {}): CommandPlan {
  return {
    commandId: "test.update",
    target: { kind: "contact", source: "acc1/ab1", href: CARD_HREF, uid: UID },
    summary: "Test",
    diff: [],
    newRaw: VCARD,
    etag: '"e-old"',
    contentType: "text/vcard",
    hrefForPut: CARD_HREF,
    createsNew: false,
    ...overrides,
  };
}

describe("executeCommandPlan", () => {
  it("Erfolg: PUT (If-Match) + Resync legt/aktualisiert Notiz ueber den Executor an", async () => {
    const transport = fakeTransport();
    const { deps, executor } = makeDeps({ transport });
    const plan = updatePlan();
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resynced).toBe(true);
      expect(res.uid).toBe(UID);
      expect(res.resyncError).toBeUndefined();
    }
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.op).toBe("create");
    const putReq = transport.calls.find((c) => c.method === "PUT");
    expect(putReq?.headers?.["If-Match"]).toBe('"e-old"');
  });

  it("ein werfender 'changed'-Listener wird geschluckt und zaehlt nicht als Resync-Fehler (Fix-Runde 1, Punkt 1)", async () => {
    const transport = fakeTransport();
    const { deps, executor } = makeDeps({ transport });
    const changed: unknown[] = [];
    const events = createEmitter<SyncEvents>();
    events.on("changed", (e) => {
      changed.push(e);
      throw new Error("kaputter Listener");
    });
    const plan = updatePlan();
    const res = await executeCommandPlan({ ...deps, events }, baseSettings(), plan);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resynced).toBe(true);
      expect(res.resyncError).toBeUndefined();
    }
    expect(executor.calls).toHaveLength(1);
    expect(changed).toHaveLength(1);
  });

  it("create: PUT mit If-None-Match statt If-Match", async () => {
    const transport = fakeTransport();
    const { deps } = makeDeps({ transport });
    const plan = updatePlan({ target: { kind: "contact", source: "acc1/ab1", new: true }, createsNew: true, etag: undefined });
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res.ok).toBe(true);
    const putReq = transport.calls.find((c) => c.method === "PUT");
    expect(putReq?.headers?.["If-None-Match"]).toBe("*");
    expect(putReq?.headers?.["If-Match"]).toBeUndefined();
  });

  it("412 → conflict, kein Resync (kein GET, Executor nicht gerufen)", async () => {
    const transport = fakeTransport({ putStatus: 412 });
    const { deps, executor } = makeDeps({ transport });
    const plan = updatePlan();
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toBe(true);
    expect(executor.calls).toHaveLength(0);
    expect(transport.calls.some((c) => c.method === "GET")).toBe(true); // headEtag holt frischen etag
  });

  it("delete: DELETE (If-Match) + Notiz-Plan delete ueber Resync", async () => {
    const transport = fakeTransport({ getStatus: 404 });
    const { deps, executor } = makeDeps({ transport });
    const plan = updatePlan({ delete: true });
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res.ok).toBe(true);
    const delReq = transport.calls.find((c) => c.method === "DELETE");
    expect(delReq?.headers?.["If-Match"]).toBe('"e-old"');
    // ohne vorbestehenden state.objects-Eintrag erzeugt applyDelta fuer "deleted" keinen Plan —
    // aber resyncObject muss trotzdem versucht haben, das Objekt zu GETten (404) statt zu werfen.
    expect(transport.calls.some((c) => c.method === "GET")).toBe(true);
    expect(executor.calls).toHaveLength(0);
  });

  it("PUT wirft (Netzwerkfehler) → { ok:false, conflict:false, error:'transport-error' }", async () => {
    const transport = fakeTransport({ throws: true });
    const { deps } = makeDeps({ transport });
    const plan = updatePlan();
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res).toEqual({ ok: false, conflict: false, error: "transport-error" });
  });

  it("PUT nicht-conflict-Fehlstatus (z. B. 500) → error:'transport-error'", async () => {
    const transport = fakeTransport({ putStatus: 500 });
    const { deps } = makeDeps({ transport });
    const plan = updatePlan();
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res).toEqual({ ok: false, conflict: false, error: "transport-error" });
  });

  it("busy: liefert { ok:false, conflict:false, error:'busy' } ohne Netzwerkaufruf", async () => {
    const transport = fakeTransport();
    const busy = createBusyGuard();
    busy.tryAcquire(); // simuliert einen laufenden SyncService-Lauf
    const { deps } = makeDeps({ transport, busy });
    const plan = updatePlan();
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res).toEqual({ ok: false, conflict: false, error: "busy" });
    expect(transport.calls).toHaveLength(0);
  });

  it("gibt den Busy-Guard nach Ausfuehrung wieder frei (auch nach Erfolg)", async () => {
    const { deps, busy } = makeDeps({ transport: fakeTransport() });
    await executeCommandPlan(deps, baseSettings(), updatePlan());
    expect(busy.isBusy()).toBe(false);
  });

  it("fehlende Sammlung → error:'collection-not-found'", async () => {
    const transport = fakeTransport();
    const { deps } = makeDeps({ transport });
    const plan = updatePlan({ target: { kind: "contact", source: "acc1/unknown", href: CARD_HREF, uid: UID } });
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res).toEqual({ ok: false, conflict: false, error: "collection-not-found" });
  });

  it("fehlendes Passwort → error:'no-secret'", async () => {
    const transport = fakeTransport();
    const { deps } = makeDeps({ transport, secret: null });
    const res = await executeCommandPlan(deps, baseSettings(), updatePlan());
    expect(res).toEqual({ ok: false, conflict: false, error: "no-secret" });
  });

  it("PUT erfolgreich, aber Resync-GET scheitert nicht-404 → ok:true, resynced:false, resyncError gesetzt; State haelt trotzdem den frischen etag fest", async () => {
    const transport = fakeTransport({ getThrows: true, putEtag: '"e-fresh"' });
    const { deps, executor, states } = makeDeps({ transport });
    const res = await executeCommandPlan(deps, baseSettings(), updatePlan());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resynced).toBe(false);
      expect(res.resyncError).toBeDefined();
      expect(res.etag).toBe('"e-fresh"');
    }
    expect(executor.calls).toHaveLength(0); // Resync kam nie bis applyDelta/Executor
    const state = states.get("acc1/ab1");
    expect(state?.snapshot.etags["/ab1/card1.vcf"]).toBe('"e-fresh"');
  });

  it("PUT erfolgreich, Executor wirft beim Notiz-Schreiben → ok:true, resynced:false, resyncError gesetzt; State (etag) wird trotzdem gespeichert", async () => {
    const transport = fakeTransport();
    const throwingExecutor = loggingExecutor({ throwOnFirst: true });
    const { deps, states } = makeDeps({ transport, executor: throwingExecutor });
    const res = await executeCommandPlan(deps, baseSettings(), updatePlan());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.resynced).toBe(false);
      expect(res.resyncError).toBeDefined();
    }
    const state = states.get("acc1/ab1");
    expect(state?.snapshot.etags["/ab1/card1.vcf"]).toBe('"e-new"');
  });
});

describe("bidirektionaler Busy-Guard", () => {
  it("ein von aussen belegter Guard (simulierter SyncService-Lauf) blockiert executeCommandPlan", async () => {
    const busy = createBusyGuard();
    const { deps } = makeDeps({ transport: fakeTransport(), busy });
    expect(busy.tryAcquire()).toBe(true); // "SyncService laeuft"
    const res = await executeCommandPlan(deps, baseSettings(), updatePlan());
    expect(res).toEqual({ ok: false, conflict: false, error: "busy" });
    busy.release();
    const res2 = await executeCommandPlan(deps, baseSettings(), updatePlan());
    expect(res2.ok).toBe(true);
  });

  it("executeCommandPlan haelt den Guard fuer die GESAMTE Dauer (PUT+Resync) belegt", async () => {
    const { deps, busy } = makeDeps({ transport: fakeTransport() });
    const p = executeCommandPlan(deps, baseSettings(), updatePlan());
    expect(busy.isBusy()).toBe(true);
    await p;
    expect(busy.isBusy()).toBe(false);
  });
});

describe("resyncObject", () => {
  it("GET 404 behandelt als Loeschung statt zu werfen", async () => {
    const transport = fakeTransport({ getStatus: 404 });
    const { deps } = makeDeps({ transport });
    const { plans, error } = await resyncObject(deps, baseSettings(), "ab1", CARD_HREF);
    expect(plans).toEqual([]);
    expect(error).toBeUndefined();
  });

  it("GET-Fehler (nicht-404) liefert { plans:[], error } statt zu werfen", async () => {
    const transport = fakeTransport({ getThrows: true });
    const { deps } = makeDeps({ transport });
    const { plans, error } = await resyncObject(deps, baseSettings(), "ab1", CARD_HREF);
    expect(plans).toEqual([]);
    expect(error).toBeDefined();
  });
});
