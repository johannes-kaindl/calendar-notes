import { describe, it, expect, beforeEach } from "vitest";
import { makeFakeApp } from "../vendor/kit/obsidian-mock";
import { createPluginApi } from "../../src/obsidian/api";
import { CALENDAR_NOTES_API_VERSION } from "../../src/core/api/types";
import { InviteRouter, type MailTransport } from "../../src/obsidian/invite";
import { createMailTransportRegistry } from "../../src/obsidian/plugin-host";
import { registerCommands, resetCommands } from "../../src/core/commands/registry";
import type { CommandDescriptor, CommandTarget } from "../../src/core/commands/types";
import { defaultContactProfile, defaultEventProfile } from "../../src/core/mirror/profile";
import { DEFAULT_SYNC, type Account, type CollectionConfig, type PluginSettings } from "../../src/core/settings";
import { createEmitter, type SyncEmitter } from "../../src/core/sync/events";
import { createBusyGuard, type BusyGuard } from "../../src/core/sync/busy";
import type { SyncDeps, Notifier, PlanExecutor } from "../../src/core/sync/types";
import type { NoteLookup } from "../../src/core/mirror/apply";
import type { NotePlan } from "../../src/core/mirror/plan";
import { emptyState, type CollectionState } from "../../src/core/state/collection-state";
import type { DavRequest, DavResponse, Transport } from "../../src/core/dav/types";

const EVENT_PROFILE = defaultEventProfile();
const CONTACT_PROFILE = defaultContactProfile();
const ACCOUNT: Account = { id: "acc1", name: "Acc", baseUrl: "https://dav.example/", username: "u", secretId: "sec1" };
const EVENT_COL: CollectionConfig = {
  id: "cal1", accountId: "acc1", href: "https://dav.example/cal1/", kind: "calendar",
  displayName: "Kalender", enabled: true, profileId: EVENT_PROFILE.id, readOnly: false,
};
const CONTACT_COL: CollectionConfig = {
  id: "ab1", accountId: "acc1", href: "https://dav.example/ab1/", kind: "addressbook",
  displayName: "Adressbuch", enabled: true, profileId: CONTACT_PROFILE.id, readOnly: false,
};
const EVENT_SOURCE = "acc1/cal1";
const CONTACT_SOURCE = "acc1/ab1";

const EVENT_UID = "evt-uid-1";
const ICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//calendar-notes//test//DE\r\nBEGIN:VEVENT\r\nUID:${EVENT_UID}\r\nDTSTART:20260901T100000Z\r\nDTEND:20260901T110000Z\r\nSUMMARY:Test Event\r\nEND:VEVENT\r\nEND:VCALENDAR`;

const CONTACT_UID = "contact-uid-1";
const VCARD = `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${CONTACT_UID}\r\nFN:Alex Aguado\r\nEMAIL:alex@example.test\r\nEND:VCARD\r\n`;

function baseSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    version: 1,
    accounts: [ACCOUNT],
    collections: [EVENT_COL, CONTACT_COL],
    profiles: [EVENT_PROFILE, CONTACT_PROFILE],
    sync: DEFAULT_SYNC,
    language: "auto",
    ...overrides,
  };
}

function eventState(): CollectionState {
  const s = emptyState(EVENT_SOURCE);
  return {
    ...s,
    objects: {
      "evt1.ics": { uid: EVENT_UID, etag: '"e1"', raw: ICS, notes: { "": { path: "Termine/Test Event.md", written: {}, hash: "h1" } }, history: [] },
    },
  };
}

function contactState(): CollectionState {
  const s = emptyState(CONTACT_SOURCE);
  return {
    ...s,
    objects: {
      "card1.vcf": { uid: CONTACT_UID, etag: '"e2"', raw: VCARD, notes: { "": { path: "Kontakte/Alex Aguado.md", written: {}, hash: "h2" } }, history: [] },
    },
  };
}

function noopLookup(): NoteLookup {
  return { byUid: () => undefined, byPath: () => undefined, exists: () => false, hasBacklinks: () => false };
}

function noopNotify(): Notifier {
  return { info: () => {}, warn: () => {}, handEdited: () => {} };
}

function loggingExecutor(): PlanExecutor & { calls: NotePlan[] } {
  const calls: NotePlan[] = [];
  return { calls, execute: async (plan) => { calls.push(plan); } };
}

interface TransportOpts {
  putStatus?: number;
  putEtag?: string;
  getData?: string;
  getEtag?: string;
  getStatus?: number;
}

function fakeTransport(opts: TransportOpts = {}): Transport & { calls: DavRequest[] } {
  const calls: DavRequest[] = [];
  const t = (async (req: DavRequest): Promise<DavResponse> => {
    calls.push(req);
    if (req.method === "PUT") {
      const status = opts.putStatus ?? 201;
      return { status, headers: status < 300 ? { etag: opts.putEtag ?? '"e-new"' } : {}, text: "" };
    }
    if (req.method === "GET") {
      const status = opts.getStatus ?? 200;
      if (status === 200) return { status, headers: { etag: opts.getEtag ?? '"e-new"' }, text: opts.getData ?? ICS };
      return { status, headers: {}, text: "" };
    }
    return { status: 404, headers: {}, text: "" };
  }) as Transport & { calls: DavRequest[] };
  t.calls = calls;
  return t;
}

interface Fakes {
  deps: SyncDeps;
  states: Map<string, CollectionState>;
  events: SyncEmitter;
  busy: BusyGuard;
  transport: Transport & { calls: DavRequest[] };
  executor: ReturnType<typeof loggingExecutor>;
  mailTransports: ReturnType<typeof createMailTransportRegistry>;
  inviteRouter: InviteRouter;
  app: ReturnType<typeof makeFakeApp>;
  settings: PluginSettings;
}

function makeFakes(opts: { settings?: PluginSettings; transport?: Transport & { calls: DavRequest[] }; secret?: string | null } = {}): Fakes {
  const settings = opts.settings ?? baseSettings();
  const states = new Map<string, CollectionState>([
    [EVENT_SOURCE, eventState()],
    [CONTACT_SOURCE, contactState()],
  ]);
  const events = createEmitter<import("../../src/core/sync/events").SyncEvents>();
  const busy = createBusyGuard();
  const transport = opts.transport ?? fakeTransport();
  const executor = loggingExecutor();
  const secret = opts.secret === undefined ? "geheim" : opts.secret;
  const mailTransports = createMailTransportRegistry();
  const app = makeFakeApp();
  const inviteRouter = new InviteRouter(() => mailTransports.list(), app);

  const deps: SyncDeps = {
    settings: () => settings,
    saveSettings: async () => {},
    secrets: { get: () => secret, set: () => {}, has: () => secret !== null },
    stateStore: {
      load: async (source) => states.get(source) ?? emptyState(source),
      save: async (state) => { states.set(state.source, state); },
      remove: async (source) => { states.delete(source); },
    },
    busy,
    events,
    transportFor: () => transport,
    lookupFor: async () => noopLookup(),
    executor,
    notify: noopNotify(),
    now: () => new Date("2026-08-23T09:00:00Z"),
  };

  return { deps, states, events, busy, transport, executor, mailTransports, inviteRouter, app, settings };
}

function api(f: Fakes) {
  return createPluginApi({ app: f.app, deps: f.deps, inviteRouter: f.inviteRouter, mailTransports: f.mailTransports });
}

function eventRenameDescriptor(withInvite = false): CommandDescriptor {
  return {
    id: "event.rename",
    kind: "event",
    title: "Titel ändern",
    description: "Ändert den Titel eines Termins",
    schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    appliesTo: (ctx) => ctx.target.kind === "event" && "href" in ctx.target,
    plan(input, ctx) {
      const title = typeof input["title"] === "string" ? input["title"] : "";
      const target = ctx.target as Extract<CommandTarget, { href: string }>;
      const plan: ReturnType<CommandDescriptor["plan"]> = {
        commandId: "event.rename",
        target: ctx.target,
        summary: `Titel geändert: ${title}`,
        diff: [{ field: "summary", after: title }],
        newRaw: ctx.raw ?? "",
        etag: ctx.etag,
        contentType: "text/calendar",
        hrefForPut: target.href,
        createsNew: false,
      };
      if (withInvite) plan.invite = { attendees: ["alex@example.test"], method: "REQUEST" };
      return plan;
    },
  };
}

function eventCreateDescriptor(): CommandDescriptor {
  return {
    id: "test.event.create",
    kind: "event",
    title: "Neuer Termin",
    description: "Legt einen Termin an",
    schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    appliesTo: (ctx) => "new" in ctx.target && ctx.target.new === true,
    plan(input, ctx) {
      const title = typeof input["title"] === "string" ? input["title"] : "Neu";
      return {
        commandId: "test.event.create",
        target: ctx.target,
        summary: `Termin angelegt: ${title}`,
        diff: [],
        newRaw: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:new-uid\r\nDTSTART:20260910T090000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
        contentType: "text/calendar",
        hrefForPut: `${ctx.collection.href}new-uid.ics`,
        createsNew: true,
      };
    },
  };
}

beforeEach(() => resetCommands());

describe("createPluginApi — version", () => {
  it("version ist die zentrale CALENDAR_NOTES_API_VERSION-Konstante, kein Literal (Fix-Runde 1, Punkt 3)", () => {
    const f = makeFakes();
    expect(api(f).version).toBe(CALENDAR_NOTES_API_VERSION);
  });
});

describe("createPluginApi — events/contacts/get", () => {
  it("events() liefert die Termine aus den Kalender-Sammlungen", async () => {
    const f = makeFakes();
    const result = await api(f).events();
    expect(result).not.toHaveProperty("error");
    const events = result as Exclude<typeof result, { error: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uid: EVENT_UID, source: EVENT_SOURCE, collectionId: "cal1", path: "Termine/Test Event.md" });
    expect(events[0]?.data.summary).toBe("Test Event");
  });

  it("events() filtert nach collectionId und Zeitfenster", async () => {
    const f = makeFakes();
    const byCollection = await api(f).events({ collectionId: "ab1" });
    expect(byCollection).toEqual([]);
    const inWindow = await api(f).events({ from: "2026-09-01", to: "2026-09-02" });
    expect(inWindow).toHaveLength(1);
    const outOfWindow = await api(f).events({ from: "2026-10-01" });
    expect(outOfWindow).toEqual([]);
  });

  it("contacts() liefert Kontakte und filtert per Teilstring-Suche", async () => {
    const f = makeFakes();
    const all = await api(f).contacts();
    expect(all).toHaveLength(1);
    const hit = await api(f).contacts({ query: "alex@example" });
    expect(hit).toHaveLength(1);
    const miss = await api(f).contacts({ query: "niemand" });
    expect(miss).toEqual([]);
  });

  it("get() findet ueber uid (+source), sonst null", async () => {
    const f = makeFakes();
    const found = await api(f).get({ uid: EVENT_UID });
    expect(found).toMatchObject({ uid: EVENT_UID, source: EVENT_SOURCE });
    const foundBySource = await api(f).get({ uid: CONTACT_UID, source: CONTACT_SOURCE });
    expect(foundBySource).toMatchObject({ uid: CONTACT_UID });
    const missing = await api(f).get({ uid: "does-not-exist" });
    expect(missing).toBeNull();
  });

  // Fix M8 (Review-Runde 3): events()/contacts()/get() ueberspringen deaktivierte
  // Sammlungen — deren State wird nicht mehr synchronisiert und kann stale sein.
  it("events()/contacts()/get() ueberspringen eine deaktivierte Sammlung", async () => {
    const settings = baseSettings({ collections: [{ ...EVENT_COL, enabled: false }, { ...CONTACT_COL, enabled: false }] });
    const f = makeFakes({ settings });
    expect(await api(f).events()).toEqual([]);
    expect(await api(f).contacts()).toEqual([]);
    expect(await api(f).get({ uid: EVENT_UID })).toBeNull();
  });

  it("faengt unerwartete Fehler und liefert { error }", async () => {
    const f = makeFakes();
    f.deps.stateStore.load = async () => {
      throw new Error("State-Store kaputt");
    };
    const result = await api(f).events();
    expect(result).toEqual({ error: "State-Store kaputt" });
  });
});

describe("createPluginApi — commands/tools", () => {
  it("commands()/tools() enthalten sowohl eigene registrierte als auch (defensiv via ensureDefaultCommands) nachgezogene Default-Kommandos", () => {
    registerCommands([eventRenameDescriptor(), eventCreateDescriptor()]);
    const f = makeFakes();
    const a = api(f);
    const ids = a.commands().map((c) => c.id);
    // Fix-Runde 1, Punkt 0: `createPluginApi` ruft `ensureDefaultCommands()` defensiv selbst
    // auf — die Registry enthaelt danach IMMER auch den eingebauten Kommando-Satz, nicht nur
    // die von diesem Test registrierten Fakes.
    expect(ids).toContain("event.rename");
    expect(ids).toContain("test.event.create");
    expect(ids).toContain("event.move");
    expect(ids).toContain("undo.last");
    expect(new Set(ids).size).toBe(ids.length);

    const tools = a.tools();
    expect(tools.map((t) => t.name)).toContain("event_rename");
    expect(tools.map((t) => t.name)).toContain("test_event_create");
    expect(tools.some((t) => t.name.includes("."))).toBe(false);
    expect(tools.length).toBe(a.commands().length);
  });
});

describe("createPluginApi — plan()", () => {
  it("baut einen ApiPlan fuer ein bestehendes Ziel (uid+source)", async () => {
    registerCommands([eventRenameDescriptor()]);
    const f = makeFakes();
    const result = await api(f).plan("event.rename", { title: "Neuer Titel" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    expect(result).not.toHaveProperty("error");
    const plan = result as Exclude<typeof result, { error: string }>;
    expect(plan.commandId).toBe("event.rename");
    expect(plan.summary).toBe("Titel geändert: Neuer Titel");
    expect(plan.hrefForPut).toBe("https://dav.example/cal1/evt1.ics");
    expect(plan.etag).toBe('"e1"');
    expect(plan.inviteRoute).toBeUndefined();
  });

  it("baut einen ApiPlan fuer ein neues Ziel ({ new: true, collectionId })", async () => {
    registerCommands([eventCreateDescriptor()]);
    const f = makeFakes();
    const result = await api(f).plan("test.event.create", { title: "Frisch" }, { new: true, collectionId: "cal1" });
    expect(result).not.toHaveProperty("error");
    const plan = result as Exclude<typeof result, { error: string }>;
    expect(plan.createsNew).toBe(true);
    expect(plan.summary).toBe("Termin angelegt: Frisch");
  });

  it("liefert { error } fuer unbekannte Kommando-ID", async () => {
    const f = makeFakes();
    const result = await api(f).plan("no.such.command", {}, { uid: EVENT_UID, source: EVENT_SOURCE });
    expect(result).toEqual({ error: "command-not-found" });
  });

  it("liefert { error } wenn kein passendes Zielobjekt im State liegt", async () => {
    registerCommands([eventRenameDescriptor()]);
    const f = makeFakes();
    const result = await api(f).plan("event.rename", { title: "x" }, { uid: "unbekannt", source: EVENT_SOURCE });
    expect(result).toEqual({ error: "target-not-found" });
  });

  it("liefert { error } wenn das Kommando auf dieses Ziel nicht anwendbar ist", async () => {
    registerCommands([eventRenameDescriptor()]);
    const f = makeFakes();
    const result = await api(f).plan("event.rename", { title: "x" }, { new: true, collectionId: "cal1" });
    expect(result).toEqual({ error: "command-not-applicable" });
  });

  // Fix M8 (Review-Runde 3): plan() lehnt eine deaktivierte Sammlung als Ziel ab — sowohl
  // fuer ein bestehendes als auch fuer ein neues Objekt.
  it("liefert { error: 'collection-disabled' } fuer ein bestehendes Ziel in einer deaktivierten Sammlung", async () => {
    registerCommands([eventRenameDescriptor()]);
    const settings = baseSettings({ collections: [{ ...EVENT_COL, enabled: false }, CONTACT_COL] });
    const f = makeFakes({ settings });
    const result = await api(f).plan("event.rename", { title: "x" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    expect(result).toEqual({ error: "collection-disabled" });
  });

  it("liefert { error: 'collection-disabled' } fuer ein neues Ziel in einer deaktivierten Sammlung", async () => {
    registerCommands([eventCreateDescriptor()]);
    const settings = baseSettings({ collections: [{ ...EVENT_COL, enabled: false }, CONTACT_COL] });
    const f = makeFakes({ settings });
    const result = await api(f).plan("test.event.create", { title: "x" }, { new: true, collectionId: "cal1" });
    expect(result).toEqual({ error: "collection-disabled" });
  });

  it("faengt einen werfenden Kommando-plan() ab", async () => {
    registerCommands([
      {
        ...eventRenameDescriptor(),
        plan() {
          throw new Error("kaputtes Kommando");
        },
      },
    ]);
    const f = makeFakes();
    // gueltige Eingabe (title gesetzt) — sonst schlaegt schon validateInput() zu (Punkt 5),
    // bevor descriptor.plan() ueberhaupt laeuft.
    const result = await api(f).plan("event.rename", { title: "x" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    expect(result).toEqual({ error: "kaputtes Kommando" });
  });

  it("liefert { error: \"validation: …\" }, wenn die Eingabe das Schema nicht erfuellt (Fix-Runde 1, Punkt 5)", async () => {
    registerCommands([eventRenameDescriptor()]);
    const f = makeFakes();
    const result = await api(f).plan("event.rename", {}, { uid: EVENT_UID, source: EVENT_SOURCE });
    expect(result).toEqual({ error: "validation: title: fehlt (required)" });
  });

  it("ergaenzt inviteRoute, wenn der Plan eine Einladung enthaelt", async () => {
    registerCommands([eventRenameDescriptor(true)]);
    const settings = baseSettings({ accounts: [{ ...ACCOUNT, scheduling: { outbox: "https://dav.example/outbox/", addresses: [] } }] });
    const f = makeFakes({ settings });
    const result = await api(f).plan("event.rename", { title: "x" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    expect(result).not.toHaveProperty("error");
    const plan = result as Exclude<typeof result, { error: string }>;
    expect(plan.inviteRoute).toBe("server");
  });
});

describe("createPluginApi — execute()", () => {
  it("fuehrt einen Plan aus und reicht ExecuteResult durch", async () => {
    registerCommands([eventRenameDescriptor()]);
    const f = makeFakes();
    const plan = await api(f).plan("event.rename", { title: "x" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    if ("error" in plan) throw new Error("plan() fehlgeschlagen");
    const result = await api(f).execute(plan);
    expect(result).not.toHaveProperty("error");
    expect(result).toMatchObject({ ok: true, uid: EVENT_UID });
  });

  it("liefert { route: 'ics' } inkl. ics-Text, wenn kein Server-Outbox/Transport verfuegbar ist", async () => {
    registerCommands([eventRenameDescriptor(true)]);
    const f = makeFakes();
    const plan = await api(f).plan("event.rename", { title: "x" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    if ("error" in plan) throw new Error("plan() fehlgeschlagen");
    const result = await api(f).execute(plan);
    if ("error" in result || !result.ok) throw new Error("execute() fehlgeschlagen");
    expect(result.invite?.route).toBe("ics");
    expect(result.invite?.ics).toContain("METHOD:REQUEST");
  });

  it("verschickt ueber einen registrierten Mail-Transport, wenn kein Server-Outbox vorliegt", async () => {
    registerCommands([eventRenameDescriptor(true)]);
    const f = makeFakes();
    let sent: unknown;
    const transport: MailTransport = {
      id: "mailstone", label: "Mailstone",
      accounts: async () => [{ id: "mail@example.test", address: "mail@example.test", label: "mail@" }],
      send: async (msg) => { sent = msg; return { ok: true, messageId: "m1" }; },
    };
    f.mailTransports.register(transport);
    const plan = await api(f).plan("event.rename", { title: "x" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    if ("error" in plan) throw new Error("plan() fehlgeschlagen");
    const result = await api(f).execute(plan);
    if ("error" in result || !result.ok) throw new Error("execute() fehlgeschlagen");
    expect(result.invite).toEqual({ route: "transport", delivered: true });
    expect(sent).toMatchObject({ from: "mail@example.test", method: "REQUEST" });
  });

  it("faengt unerwartete Fehler und liefert { error }", async () => {
    registerCommands([eventRenameDescriptor()]);
    const f = makeFakes();
    const plan = await api(f).plan("event.rename", { title: "x" }, { uid: EVENT_UID, source: EVENT_SOURCE });
    if ("error" in plan) throw new Error("plan() fehlgeschlagen");
    f.deps.stateStore.load = async () => {
      throw new Error("kaputt beim Resync");
    };
    const result = await api(f).execute(plan);
    expect(result).toHaveProperty("error");
  });
});

describe("createPluginApi — Mail-Transport-Registrierung", () => {
  it("registriert einen formkorrekten Transport", () => {
    const f = makeFakes();
    const transport: MailTransport = { id: "mailstone", label: "Mailstone", accounts: async () => [], send: async () => ({ ok: true }) };
    const result = api(f).registerMailTransport(transport);
    expect(result).toEqual({ ok: true });
    expect(f.mailTransports.list().map((t) => t.id)).toEqual(["mailstone"]);
  });

  it("lehnt ein formfremdes Objekt ab, ohne es zu registrieren", () => {
    const f = makeFakes();
    const result = api(f).registerMailTransport({ id: "x" } as unknown as MailTransport);
    expect(result).toEqual({ error: "invalid-mail-transport" });
    expect(f.mailTransports.list()).toEqual([]);
  });

  it("unregisterMailTransport entfernt einen registrierten Transport", () => {
    const f = makeFakes();
    const transport: MailTransport = { id: "mailstone", label: "Mailstone", accounts: async () => [], send: async () => ({ ok: true }) };
    api(f).registerMailTransport(transport);
    api(f).unregisterMailTransport("mailstone");
    expect(f.mailTransports.list()).toEqual([]);
  });
});

describe("createPluginApi — undo.last (Fix-Runde 1, Punkt 0)", () => {
  it("ist ohne Verlauf nicht anwendbar", async () => {
    const f = makeFakes(); // eventState() hat history: []
    const result = await api(f).plan("undo.last", {}, { uid: EVENT_UID, source: EVENT_SOURCE });
    expect(result).toEqual({ error: "command-not-applicable" });
  });

  it("plant und fuehrt die Wiederherstellung des letzten Verlaufseintrags aus (macht P12 moeglich)", async () => {
    const f = makeFakes();
    const priorRaw = ICS.replace("Test Event", "Alter Titel");
    const state = f.states.get(EVENT_SOURCE);
    if (!state) throw new Error("kein Event-State im Fixture");
    const withHistory: CollectionState = {
      ...state,
      objects: {
        "evt1.ics": { ...state.objects["evt1.ics"]!, history: [{ etag: '"e0"', raw: priorRaw, at: "2026-08-20T09:00:00Z" }] },
      },
    };
    f.states.set(EVENT_SOURCE, withHistory);

    const plan = await api(f).plan("undo.last", {}, { uid: EVENT_UID, source: EVENT_SOURCE });
    if ("error" in plan) throw new Error(`plan() fehlgeschlagen: ${plan.error}`);
    expect(plan.commandId).toBe("undo.last");
    expect(plan.newRaw).toBe(priorRaw);

    const result = await api(f).execute(plan);
    expect(result).not.toHaveProperty("error");
    expect(result).toMatchObject({ ok: true });
  });
});

describe("createPluginApi — on()", () => {
  it("on('synced') feuert bei einem 'synced'-Event des geteilten Emitters", () => {
    const f = makeFakes();
    const calls: unknown[] = [];
    const unsubscribe = api(f).on("synced", (e) => calls.push(e));
    f.events.emit("synced", { collectionId: "cal1", counts: { created: 1, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 } });
    expect(calls).toHaveLength(1);
    unsubscribe();
    f.events.emit("synced", { collectionId: "cal1", counts: { created: 1, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 } });
    expect(calls).toHaveLength(1);
  });

  it("on('changed') feuert bei einem 'changed'-Event", () => {
    const f = makeFakes();
    const calls: unknown[] = [];
    api(f).on("changed", (e) => calls.push(e));
    f.events.emit("changed", { path: "Termine/Test Event.md", op: "update", uid: EVENT_UID });
    expect(calls).toHaveLength(1);
  });
});
