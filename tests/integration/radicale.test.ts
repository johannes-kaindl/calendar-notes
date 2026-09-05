import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startRadicale, nodeTransport, type RunningServer } from "../../scripts/dav-server";
import { withBasicAuth } from "../../src/core/dav/transport";
import { discover } from "../../src/core/dav/discovery";
import { syncCollection, type SyncSnapshot } from "../../src/core/dav/sync";
import { putObject, deleteObject, getObject } from "../../src/core/dav/client";
import { parseEvents } from "../../src/core/ical/event";
import { applyMutation, applyTodoMutation, newEventIcs, newTodoIcs } from "../../src/core/ical/mutate";
import { parseContact } from "../../src/core/vcard/contact";
import { parseTodos } from "../../src/core/ical/todo";
import type { Transport, DavCollection } from "../../src/core/dav/types";

let server: RunningServer; let t: Transport;
beforeAll(async () => { server = await startRadicale({ port: 5299 }); t = withBasicAuth(nodeTransport(), server.user, server.pass); }, 40_000);
afterAll(async () => { await server?.stop(); });

describe("radicale end-to-end", () => {
  let kal: DavCollection; let kon: DavCollection; let snap: SyncSnapshot | undefined;

  it("discovery findet kalender + kontakte", async () => {
    const d = await discover(t, server.baseUrl);
    expect(d.principal).toBe(`${server.baseUrl}test/`);
    kal = d.collections.find((c) => c.kind === "calendar" && c.displayName === "Kalender")!;
    kon = d.collections.find((c) => c.kind === "addressbook")!;
    expect(kal.displayName).toBe("Kalender");
    expect(kal.readOnly).toBe(false);
    expect(kon.displayName).toBe("Kontakte");
  });

  it("erstsync liefert 3 events, zweiter sync unchanged", async () => {
    const d1 = await syncCollection(t, kal, undefined);
    expect(d1.changed).toHaveLength(3);
    expect(d1.changed.map((o) => parseEvents(o.data)[0]!.uid).sort()).toEqual(["allday-1@test", "rec-1@test", "simple-1@test"]);
    snap = d1.snapshot;
    const d2 = await syncCollection(t, { ...kal, syncToken: d1.snapshot.syncToken ?? kal.syncToken }, snap);
    expect(d2.unchanged).toBe(true);
  });

  it("kontakte: 2 vcards, v3 und v4", async () => {
    const d = await syncCollection(t, kon, undefined);
    expect(d.changed.map((o) => parseContact(o.data).version).sort()).toEqual(["3.0", "4.0"]);
  });

  it("put mit if-match → neuer etag; veralteter etag → 412; delete", async () => {
    const href = `${kal.href}simple-1.ics`;
    const cur = await getObject(t, href);
    const mutated = applyMutation(cur.data, { kind: "summary", summary: "Geändert" }, { now: new Date() });
    const r1 = await putObject(t, href, mutated, { ifMatch: cur.etag }, "text/calendar");
    expect(r1.ok).toBe(true);
    const again = await getObject(t, href);
    expect(parseEvents(again.data)[0]!.summary).toBe("Geändert");
    expect(again.etag).not.toBe(cur.etag);
    const r2 = await putObject(t, href, mutated, { ifMatch: cur.etag }, "text/calendar");
    expect(r2).toMatchObject({ ok: false, conflict: true });
    // sync sieht die Änderung
    const d3 = await syncCollection(t, { ...kal, syncToken: snap!.syncToken ?? kal.syncToken }, snap);
    expect(d3.changed.map((o) => o.href)).toEqual([href]);
    snap = d3.snapshot;
    // neu anlegen + löschen
    const newHref = `${kal.href}neu-1.ics`;
    const r3 = await putObject(t, newHref, newEventIcs({ uid: "neu-1@cn", summary: "Neu", start: "2026-11-01T10:00:00Z", end: "2026-11-01T11:00:00Z" }, { now: new Date() }), { ifNoneMatch: true }, "text/calendar");
    expect(r3.ok).toBe(true);
    const created = await getObject(t, newHref);
    const r4 = await deleteObject(t, newHref, created.etag);
    expect(r4.ok).toBe(true);
    const d4 = await syncCollection(t, { ...kal, syncToken: snap!.syncToken ?? kal.syncToken }, snap);
    expect(d4.deleted).toEqual([]);             // angelegt+gelöscht zwischen zwei Syncs → nie im Snapshot, also auch nicht "deleted"
  });

  it("entdeckt die Aufgaben-Sammlung und liest beide VTODOs", async () => {
    const d = await discover(t, server.baseUrl);
    const auf = d.collections.find((c) => c.displayName.toLowerCase().includes("aufgaben"));
    expect(auf).toBeDefined();
    expect(auf!.components?.map((x) => x.toUpperCase())).toContain("VTODO");
    const ds = await syncCollection(t, auf!, undefined);
    expect(ds.changed).toHaveLength(2);
    const uids = ds.changed.map((o) => parseTodos(o.data)[0]!.uid).sort();
    expect(uids).toEqual(["radicale-todo-1@test", "radicale-todo-2@test"]);
  });

  /**
   * M6b: der Schreibweg fuer Aufgaben gegen einen echten Server.
   *
   * Eigene Discovery statt der Sammlung aus dem Test darueber — sonst haengt dieser Test an
   * der Ausfuehrungsreihenfolge, und genau diese Bauart hat das Repo am 2026-09-03 schon
   * einmal Zeit gekostet (Lesson: eine neue Testressource macht einen bestehenden Test
   * reihenfolgeabhaengig, ohne ihn rot zu faerben).
   */
  it("VTODO: Neuanlage mit If-None-Match, Aenderung mit If-Match, Konflikt mit veraltetem Etag", async () => {
    const d = await discover(t, server.baseUrl);
    const auf = d.collections.find((c) => c.displayName.toLowerCase().includes("aufgaben"))!;
    const href = `${auf.href}m6b-todo-1.ics`;

    // 1. Erstanlage — der Fall ohne Etag. `ifNoneMatch` verhindert, dass ein zweiter Lauf
    //    eine fremde Ressource ueberschreibt, statt zu scheitern.
    const ics = newTodoIcs({ uid: "m6b-todo-1@cn", summary: "Steuer vorbereiten", due: "2026-09-30" }, { now: new Date() });
    expect(await putObject(t, href, ics, { ifNoneMatch: true }, "text/calendar")).toMatchObject({ ok: true });

    // Dasselbe noch einmal MUSS scheitern: die Ressource existiert jetzt.
    expect(await putObject(t, href, ics, { ifNoneMatch: true }, "text/calendar")).toMatchObject({ ok: false, conflict: true });

    // 2. Der Server hat das selbst gebaute VTODO angenommen und gibt es wieder her.
    const geholt = await getObject(t, href);
    const vorher = parseTodos(geholt.data)[0]!;
    expect(vorher.uid).toBe("m6b-todo-1@cn");
    expect(vorher.status).toBe("NEEDS-ACTION");

    // 3. Abhaken mit If-Match. Die Nebenwirkungen gehoeren zur Mutation, nicht zum Aufrufer
    //    (Spec §4): COMPLETED-Zeitstempel und PERCENT-COMPLETE entstehen mit dem Statuswechsel.
    const erledigt = applyTodoMutation(geholt.data, { kind: "status", status: "COMPLETED" }, { now: new Date() });
    expect(await putObject(t, href, erledigt, { ifMatch: geholt.etag }, "text/calendar")).toMatchObject({ ok: true });

    const danach = await getObject(t, href);
    const nachher = parseTodos(danach.data)[0]!;
    expect(nachher.status).toBe("COMPLETED");
    expect(danach.data).toContain("PERCENT-COMPLETE:100");
    expect(danach.etag).not.toBe(geholt.etag);

    // 4. Derselbe, jetzt veraltete Etag ein zweites Mal → Konflikt statt stillem Ueberschreiben.
    //    Das ist die Zusage, auf der das ganze Kommando steht.
    expect(await putObject(t, href, erledigt, { ifMatch: geholt.etag }, "text/calendar")).toMatchObject({ ok: false, conflict: true });

    expect(await deleteObject(t, href, danach.etag)).toMatchObject({ ok: true });
  });
});
