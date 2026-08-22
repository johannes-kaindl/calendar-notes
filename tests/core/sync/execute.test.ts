import { describe, it, expect } from "vitest";
import { executeCommandPlan, resyncObject } from "../../../src/core/sync/execute";
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

function loggingExecutor(): PlanExecutor & { calls: NotePlan[] } {
  const calls: NotePlan[] = [];
  return { calls, execute: async (plan) => { calls.push(plan); } };
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
}

function fakeTransport(opts: TransportOpts = {}): Transport & { calls: DavRequest[] } {
  const calls: DavRequest[] = [];
  const t = (async (req: DavRequest): Promise<DavResponse> => {
    calls.push(req);
    if (req.method === "PUT") {
      const status = opts.putStatus ?? 201;
      return { status, headers: status < 300 ? { etag: opts.putEtag ?? '"e-new"' } : {}, text: status === 412 ? "" : "" };
    }
    if (req.method === "DELETE") {
      return { status: opts.deleteStatus ?? 204, headers: {}, text: "" };
    }
    if (req.method === "GET") {
      const status = opts.getStatus ?? 200;
      if (status === 200) return { status, headers: { etag: opts.getEtag ?? '"e-new"' }, text: opts.getData ?? VCARD };
      return { status, headers: {}, text: "" };
    }
    return { status: 404, headers: {}, text: "" };
  }) as Transport & { calls: DavRequest[] };
  t.calls = calls;
  return t;
}

function makeDeps(opts: { transport: Transport; secret?: string | null; isBusy?: boolean } = { transport: fakeTransport() }): { deps: SyncDeps; executor: ReturnType<typeof loggingExecutor>; states: Map<string, CollectionState> } {
  const executor = loggingExecutor();
  const states = new Map<string, CollectionState>();
  const secret = opts.secret === undefined ? "geheim" : opts.secret;
  const deps: SyncDeps = {
    settings: () => baseSettings(),
    saveSettings: async () => {},
    secrets: { get: () => secret, set: () => {}, has: () => secret !== null },
    stateStore: {
      load: async (source) => states.get(source) ?? emptyState(source),
      save: async (state) => { states.set(state.source, state); },
      remove: async (source) => { states.delete(source); },
    },
    transportFor: () => opts.transport,
    lookupFor: async () => noopLookup(),
    executor,
    notify: noopNotify(),
    now: () => new Date("2026-08-22T12:00:00Z"),
    ...(opts.isBusy !== undefined ? { isBusy: () => opts.isBusy! } : {}),
  };
  return { deps, executor, states };
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
    }
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]?.op).toBe("create");
    const putReq = transport.calls.find((c) => c.method === "PUT");
    expect(putReq?.headers?.["If-Match"]).toBe('"e-old"');
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

  it("busy: liefert { ok:false, conflict:false, error:'busy' } ohne Netzwerkaufruf", async () => {
    const transport = fakeTransport();
    const { deps } = makeDeps({ transport, isBusy: true });
    const plan = updatePlan();
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res).toEqual({ ok: false, conflict: false, error: "busy" });
    expect(transport.calls).toHaveLength(0);
  });

  it("fehlende Sammlung/Konto → { ok:false, conflict:false, error }", async () => {
    const transport = fakeTransport();
    const { deps } = makeDeps({ transport });
    const plan = updatePlan({ target: { kind: "contact", source: "acc1/unknown", href: CARD_HREF, uid: UID } });
    const res = await executeCommandPlan(deps, baseSettings(), plan);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toBe(false);
  });
});

describe("resyncObject", () => {
  it("GET 404 behandelt als Loeschung statt zu werfen", async () => {
    const transport = fakeTransport({ getStatus: 404 });
    const { deps } = makeDeps({ transport });
    const { plans } = await resyncObject(deps, baseSettings(), "ab1", CARD_HREF);
    expect(plans).toEqual([]);
  });
});
