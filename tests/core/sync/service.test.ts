import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SyncService } from "../../../src/core/sync/service";
import type { SyncDeps, Notifier, PlanExecutor } from "../../../src/core/sync/types";
import type { NoteLookup } from "../../../src/core/mirror/apply";
import type { NotePlan } from "../../../src/core/mirror/plan";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { windowFor, toDavTimeRange } from "../../../src/core/mirror/window";
import { DEFAULT_SYNC, type Account, type CollectionConfig, type PluginSettings } from "../../../src/core/settings";
import type { DavRequest, DavResponse, Transport } from "../../../src/core/dav/types";
import { emptyState, upsertObject, type CollectionState } from "../../../src/core/state/collection-state";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/ical/${n}`, import.meta.url), "utf8");

const V4MIN = `BEGIN:VCARD
VERSION:4.0
UID:urn:uuid:5e2f1a9c-0000-4000-8000-000000000001
FN:Alex Aguado
END:VCARD`;

const ACCOUNT: Account = { id: "acc1", name: "Acc", baseUrl: "https://dav.example/", username: "u", secretId: "sec1" };
const PROFILE = defaultContactProfile();
const EVENT_PROFILE = defaultEventProfile();

function addressbookCollection(id: string, opts: Partial<CollectionConfig> = {}): CollectionConfig {
  return { id, accountId: "acc1", href: `https://dav.example/${id}/`, kind: "addressbook", displayName: id, enabled: true, profileId: PROFILE.id, readOnly: false, ...opts };
}

function calendarCollection(id: string, opts: Partial<CollectionConfig> = {}): CollectionConfig {
  return { id, accountId: "acc1", href: `https://dav.example/${id}/`, kind: "calendar", displayName: id, enabled: true, profileId: EVENT_PROFILE.id, readOnly: false, ...opts };
}

function baseSettings(collections: CollectionConfig[], syncOverrides: Partial<PluginSettings["sync"]> = {}): PluginSettings {
  return { version: 1, accounts: [ACCOUNT], collections, profiles: [PROFILE, EVENT_PROFILE], sync: { ...DEFAULT_SYNC, ...syncOverrides }, language: "auto" };
}

function refreshMS(href: string, ctag: string): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cr="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cr:addressbook/></d:resourcetype><d:displayname>AB</d:displayname><cs:getctag>${ctag}</cs:getctag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}
function listingMS(colHref: string, cardHref: string, etag: string): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${colHref}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>${cardHref}</d:href><d:propstat><d:prop><d:getetag>"${etag}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}
function multigetMS(cardHref: string, etag: string, data: string): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cr="urn:ietf:params:xml:ns:carddav"><d:response><d:href>${cardHref}</d:href><d:propstat><d:prop><d:getetag>"${etag}"</d:getetag><cr:address-data>${data}</cr:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}
function emptyListingMS(colHref: string): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${colHref}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}

/** Baut einen Transport fuer genau eine addressbook-Collection: PROPFIND Depth 0
 *  (refresh), PROPFIND Depth 1 (etag-diff Listing), REPORT addressbook-multiget. */
function addressbookTransport(col: CollectionConfig, opts: { ctag?: string; cardEtag?: string; withCard?: boolean; refreshStatus?: number } = {}): Transport & { calls: DavRequest[] } {
  const calls: DavRequest[] = [];
  const cardHref = `${col.href}card1.vcf`;
  const t = (async (req: DavRequest): Promise<DavResponse> => {
    calls.push(req);
    if (req.method === "PROPFIND" && req.headers?.["Depth"] === "0") {
      if (opts.refreshStatus && opts.refreshStatus !== 207) return { status: opts.refreshStatus, headers: {}, text: "" };
      return { status: 207, headers: {}, text: refreshMS(col.href, opts.ctag ?? '"c1"') };
    }
    if (req.method === "PROPFIND" && req.headers?.["Depth"] === "1") {
      const text = opts.withCard === false ? emptyListingMS(col.href) : listingMS(col.href, cardHref, opts.cardEtag ?? "e1");
      return { status: 207, headers: {}, text };
    }
    if (req.method === "REPORT" && req.body?.includes("addressbook-multiget")) {
      return { status: 207, headers: {}, text: multigetMS(cardHref, opts.cardEtag ?? "e1", V4MIN) };
    }
    return { status: 404, headers: {}, text: "" };
  }) as Transport & { calls: DavRequest[] };
  t.calls = calls;
  return t;
}

function refreshCalMS(href: string, ctag: string, syncToken: string): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Cal</d:displayname><cs:getctag>${ctag}</cs:getctag><d:sync-token>${syncToken}</d:sync-token></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}
function calQueryListingMS(entries: { href: string; etag: string }[]): string {
  const responses = entries.map((e) => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><d:getetag>"${e.etag}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("");
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`;
}
function calMultigetMS(entries: { href: string; etag: string; data: string }[]): string {
  const responses = entries.map((e) => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><d:getetag>"${e.etag}"</d:getetag><c:calendar-data>${e.data}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("");
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`;
}

/** Baut einen Transport fuer genau eine calendar-Collection: PROPFIND Depth 0
 *  (refresh, liefert bewusst einen sync-token zurück — der Service MUSS ihn vor dem
 *  syncCollection-Aufruf entfernen), REPORT calendar-query (Fenster-Listing, Depth 1)
 *  und REPORT calendar-multiget. Ein REPORT mit sync-collection-Body wirft — der
 *  Service darf diesen Zweig fuer Kalender NIE nehmen (Ruling: immer etag-Diff). */
function calendarTransport(col: CollectionConfig, entries: { href: string; etag: string; data: string }[], opts: { ctag?: string; syncToken?: string } = {}): Transport & { calls: DavRequest[] } {
  const calls: DavRequest[] = [];
  const t = (async (req: DavRequest): Promise<DavResponse> => {
    calls.push(req);
    if (req.method === "PROPFIND" && req.headers?.["Depth"] === "0") {
      return { status: 207, headers: {}, text: refreshCalMS(col.href, opts.ctag ?? '"cal-c1"', opts.syncToken ?? "https://dav.example/sync/1") };
    }
    if (req.method === "REPORT" && req.body?.includes("sync-collection")) {
      throw new Error("Kalender-Sync darf NIE sync-collection senden (Ruling: immer etag-Diff mit Fenster)");
    }
    if (req.method === "REPORT" && req.body?.includes("calendar-multiget")) {
      return { status: 207, headers: {}, text: calMultigetMS(entries) };
    }
    if (req.method === "REPORT" && req.body?.includes("calendar-query")) {
      return { status: 207, headers: {}, text: calQueryListingMS(entries.map((e) => ({ href: e.href, etag: e.etag }))) };
    }
    return { status: 404, headers: {}, text: "" };
  }) as Transport & { calls: DavRequest[] };
  t.calls = calls;
  return t;
}

function noopLookup(): NoteLookup {
  return { byUid: () => undefined, byPath: () => undefined, exists: () => false, hasBacklinks: () => false };
}

function collectingNotify(): Notifier & { infos: string[]; warns: string[]; handEditedCounts: number[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  const handEditedCounts: number[] = [];
  return { infos, warns, handEditedCounts, info: (m) => infos.push(m), warn: (m) => warns.push(m), handEdited: (n) => handEditedCounts.push(n) };
}

function loggingExecutor(): PlanExecutor & { calls: NotePlan[] } {
  const calls: NotePlan[] = [];
  return { calls, execute: async (plan) => { calls.push(plan); } };
}

interface DepsBundle {
  deps: SyncDeps;
  notify: ReturnType<typeof collectingNotify>;
  executor: ReturnType<typeof loggingExecutor>;
  saved: PluginSettings[];
  transports: Map<string, Transport & { calls: DavRequest[] }>;
  settingsRef: { current: PluginSettings };
}

function makeDeps(settings: PluginSettings, transports: Record<string, Transport & { calls: DavRequest[] }>, opts: { secret?: string | null; now?: Date } = {}): DepsBundle {
  const notify = collectingNotify();
  const executor = loggingExecutor();
  const saved: PluginSettings[] = [];
  const settingsRef = { current: settings };
  const transportsMap = new Map(Object.entries(transports));
  const secret = opts.secret === undefined ? "geheim" : opts.secret;
  const now = opts.now ?? new Date("2026-08-22T12:00:00Z");
  const stateStore = new (class {
    private readonly states = new Map<string, CollectionState>();
    async load(source: string): Promise<CollectionState> {
      return this.states.get(source) ?? emptyState(source);
    }
    async save(state: CollectionState): Promise<void> {
      this.states.set(state.source, state);
    }
    async remove(source: string): Promise<void> {
      this.states.delete(source);
    }
  })();
  const deps: SyncDeps = {
    settings: () => settingsRef.current,
    saveSettings: async (s) => { saved.push(s); settingsRef.current = s; },
    secrets: { get: () => secret, set: () => {}, has: () => secret !== null },
    stateStore,
    transportFor: (account) => transportsMap.get(account.id) ?? (async () => ({ status: 404, headers: {}, text: "" })),
    lookupFor: async () => noopLookup(),
    executor,
    notify,
    now: () => now,
  };
  return { deps, notify, executor, saved, transports: transportsMap, settingsRef };
}

describe("SyncService", () => {
  it("(a) dryRun: liefert create-Pläne, Executor wird nicht gerufen, State nicht gespeichert", async () => {
    const col = addressbookCollection("ab1");
    const settings = baseSettings([col]);
    const t = addressbookTransport(col);
    const { deps, executor } = makeDeps(settings, { acc1: t });
    const service = new SyncService(deps);
    const r = await service.runCollection("ab1", { dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.plans.map((p) => p.op)).toEqual(["create"]);
    expect(executor.calls).toEqual([]);
    const state = await deps.stateStore.load("acc1/ab1");
    expect(state.lastRun).toBeUndefined();
  });

  it("(b) echter Lauf: Executor gerufen, State gespeichert (snapshot + lastRun.ok), Settings-ctag aktualisiert", async () => {
    const col = addressbookCollection("ab1");
    const settings = baseSettings([col]);
    const t = addressbookTransport(col, { ctag: '"c-new"' });
    const { deps, executor, saved } = makeDeps(settings, { acc1: t });
    const service = new SyncService(deps);
    const r = await service.runCollection("ab1");
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(false);
    expect(r.strategy).toBe("etag-diff");
    expect(executor.calls).toHaveLength(1);
    const state = await deps.stateStore.load("acc1/ab1");
    expect(state.lastRun?.ok).toBe(true);
    expect(Object.keys(state.snapshot.etags)).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.collections[0]!.ctag).toBe('"c-new"');
  });

  it("(c) fehlendes Secret → skippedReason no-secret, kein Transport-Aufruf, keine Notice", async () => {
    const col = addressbookCollection("ab1");
    const settings = baseSettings([col]);
    const t = addressbookTransport(col);
    const { deps, notify } = makeDeps(settings, { acc1: t }, { secret: null });
    const service = new SyncService(deps);
    const r = await service.runCollection("ab1");
    expect(r.skippedReason).toBe("no-secret");
    expect(t.calls).toEqual([]);
    expect(notify.warns).toEqual([]);
    expect(notify.infos).toEqual([]);
  });

  it("(c2) leeres Secret (\"\") zählt ebenfalls als no-secret, kein Transport-Aufruf", async () => {
    const col = addressbookCollection("ab1");
    const settings = baseSettings([col]);
    const t = addressbookTransport(col);
    const { deps } = makeDeps(settings, { acc1: t }, { secret: "" });
    const service = new SyncService(deps);
    const r = await service.runCollection("ab1");
    expect(r.skippedReason).toBe("no-secret");
    expect(t.calls).toEqual([]);
  });

  it("(d) Transport wirft 401 in Sammlung A, Sammlung B läuft durch; warn genau einmal; zweiter Lauf mit gleichem Fehler → keine zweite warn", async () => {
    const colA = addressbookCollection("a");
    const colB = addressbookCollection("b");
    const settings = baseSettings([colA, colB]);
    const tA = addressbookTransport(colA, { refreshStatus: 401 });
    const tB = addressbookTransport(colB, { withCard: false });
    const { deps, notify } = makeDeps(settings, { acc1: tA }); // acc1 shared: beide Collections nutzen denselben Account/Transport-Key
    // Zwei Collections desselben Accounts teilen sich denselben Transport-Key ("acc1") in transportFor —
    // deshalb muss der Transport je nach Ziel-Collection verzweigen:
    const combined: Transport & { calls: DavRequest[] } = (async (req: DavRequest) => {
      if (req.url.startsWith(colA.href)) return tA(req);
      return tB(req);
    }) as Transport & { calls: DavRequest[] };
    combined.calls = [];
    deps.transportFor = () => combined;

    const service = new SyncService(deps);
    const r1 = await service.runAll();
    const a1 = r1.collections.find((c) => c.collectionId === "a")!;
    const b1 = r1.collections.find((c) => c.collectionId === "b")!;
    expect(a1.ok).toBe(false);
    expect(a1.error).toBeDefined();
    expect(b1.ok).toBe(true);
    expect(notify.warns).toHaveLength(1);

    const r2 = await service.runAll();
    const a2 = r2.collections.find((c) => c.collectionId === "a")!;
    expect(a2.error).toBe(a1.error);
    expect(notify.warns).toHaveLength(1);
  });

  it("(e) busy: runAll zweimal ohne await → zweites Ergebnis nur busy", async () => {
    const col = addressbookCollection("ab1");
    const settings = baseSettings([col]);
    const t = addressbookTransport(col);
    const { deps } = makeDeps(settings, { acc1: t });
    const service = new SyncService(deps);
    const p1 = service.runAll();
    const p2 = service.runAll();
    const r2 = await p2;
    expect(r2.collections.every((c) => c.skippedReason === "busy")).toBe(true);
    const r1 = await p1;
    expect(r1.collections[0]!.skippedReason).toBeUndefined();
    expect(service.isRunning()).toBe(false);
  });

  it("(f) Executor-Fehler markiert RunInfo.ok als false; runCollection() setzt lastResult() mit genau dieser Sammlung", async () => {
    const col = addressbookCollection("ab1");
    const settings = baseSettings([col]);
    const t = addressbookTransport(col);
    const { deps } = makeDeps(settings, { acc1: t });
    deps.executor = { execute: async () => { throw new Error("boom"); } };
    const service = new SyncService(deps);
    const r = await service.runCollection("ab1");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
    const state = await deps.stateStore.load("acc1/ab1");
    expect(state.lastRun?.ok).toBe(false);
    const last = service.lastResult();
    expect(last?.collections).toHaveLength(1);
    expect(last?.collections[0]?.collectionId).toBe("ab1");
    expect(last?.collections[0]?.ok).toBe(false);
  });

  it("disabled collection is skipped", async () => {
    const col = addressbookCollection("ab1", { enabled: false });
    const settings = baseSettings([col]);
    const t = addressbookTransport(col);
    const { deps } = makeDeps(settings, { acc1: t });
    const service = new SyncService(deps);
    const r = await service.runCollection("ab1");
    expect(r.skippedReason).toBe("disabled");
    expect(t.calls).toEqual([]);
  });

  it("calendar collection: strippt syncToken, sendet calendar-query mit Fenster-time-range, plant nur das Ereignis innerhalb des Fensters", async () => {
    const col = calendarCollection("cal1");
    const settings = baseSettings([col], { pastDays: 90, futureDays: 30 });
    const now = new Date("2026-08-22T12:00:00Z");
    const simpleHref = `${col.href}simple.ics`;
    const alldayHref = `${col.href}allday.ics`;
    const entries = [
      { href: simpleHref, etag: "e-simple", data: fx("simple.ics") },
      { href: alldayHref, etag: "e-allday", data: fx("allday.ics") },
    ];
    const t = calendarTransport(col, entries);
    const { deps } = makeDeps(settings, { acc1: t }, { now });
    const service = new SyncService(deps);

    const r = await service.runCollection("cal1", { dryRun: true });

    expect(r.strategy).toBe("etag-diff");
    expect(t.calls.some((c) => c.body?.includes("sync-collection"))).toBe(false);
    const queryCall = t.calls.find((c) => c.method === "REPORT" && c.body?.includes("calendar-query"));
    expect(queryCall).toBeDefined();
    const expectedRange = toDavTimeRange(windowFor(now, settings.sync.pastDays, settings.sync.futureDays));
    expect(queryCall!.body).toContain("time-range");
    expect(queryCall!.body).toContain(`start="${expectedRange.start}"`);
    expect(queryCall!.body).toContain(`end="${expectedRange.end}"`);

    expect(r.plans).toHaveLength(1);
    expect(r.plans[0]!.op).toBe("create");
    expect(r.plans[0]!.uid).toBe("simple-1@test");
    expect(r.plans.some((p) => p.uid === "allday-1@test")).toBe(false);
  });

  it("handEdited aus einem update-Plan erreicht CollectionRunResult.handEdited und löst genau eine notify.info aus", async () => {
    const col = addressbookCollection("ab1");
    const settings = baseSettings([col]);
    const source = "acc1/ab1";
    const uid = "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001";
    const t = addressbookTransport(col, { cardEtag: "new" });
    const { deps, notify } = makeDeps(settings, { acc1: t });

    const existingNote = { path: "Contacts/A.md", frontmatter: { dav_uid: uid, dav_source: source, dav_etag: '"old"', dav_state: "live", title: "Von Hand geändert" }, body: "" };
    deps.lookupFor = async () => ({
      byUid: (u, s, rid) => (u === uid && s === source && !rid ? existingNote : undefined),
      byPath: (p) => (p === existingNote.path ? existingNote : undefined),
      exists: (p) => p === existingNote.path,
      hasBacklinks: () => false,
    });
    const seedState = upsertObject(emptyState(source), "/ab1/card1.vcf", {
      uid, etag: '"old"', raw: "x", written: { title: "Alex Aguado" }, hash: "h", notePath: existingNote.path, at: "2026-08-01T00:00:00Z",
    });
    await deps.stateStore.save(seedState);

    const service = new SyncService(deps);
    const r = await service.runCollection("ab1");

    expect(r.plans[0]!.op).toBe("update");
    expect(r.handEdited).toEqual([{ path: "Contacts/A.md", keys: ["title"] }]);
    expect(notify.handEditedCounts).toEqual([1]);
    expect(notify.infos).toEqual([]);
  });
});
