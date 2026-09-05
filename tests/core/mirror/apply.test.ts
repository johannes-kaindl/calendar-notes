import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyDelta, type NoteLookup } from "../../../src/core/mirror/apply";
import { emptyState, upsertObject } from "../../../src/core/state/collection-state";
import { defaultContactProfile, defaultEventProfile, defaultTodoProfile } from "../../../src/core/mirror/profile";
import type { ExistingNote } from "../../../src/core/mirror/plan";
import type { SyncDelta } from "../../../src/core/dav/sync";
const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");
const NOW = new Date("2026-08-22T12:00:00Z");

function lookupOf(notes: ExistingNote[], backlinks: string[] = []): NoteLookup {
  return {
    byUid: (uid, source, rid) => notes.find((n) => n.frontmatter["dav_uid"] === uid && n.frontmatter["dav_source"] === source && (rid ? n.frontmatter["dav_recurrence_id"] === rid : !n.frontmatter["dav_recurrence_id"])),
    byPath: (p) => notes.find((n) => n.path === p),
    exists: (p) => notes.some((n) => n.path === p),
    hasBacklinks: (p) => backlinks.includes(p),
  };
}
const delta = (o: Partial<SyncDelta>): SyncDelta => ({ changed: [], deleted: [], outOfWindow: [], snapshot: { etags: {} }, strategy: "etag-diff", unchanged: false, ...o });

describe("applyDelta — contacts", () => {
  it("creates notes for new objects, resolves collisions, updates state", () => {
    const r = applyDelta({
      profile: defaultContactProfile(),
      source: "acc/kon",
      now: NOW,
      state: emptyState("acc/kon"),
      lookup: lookupOf([{ path: "Contacts/Alex Aguado.md", frontmatter: {}, body: "" }]),
      delta: delta({ changed: [{ href: "https://s/k/c3.vcf", etag: '"1"', data: fx("vcard", "v3-full.vcf") }, { href: "https://s/k/c4.vcf", etag: '"2"', data: fx("vcard", "v4-min.vcf") }], snapshot: { etags: { "/k/c3.vcf": '"1"', "/k/c4.vcf": '"2"' } } }),
    });
    expect(r.errors).toEqual([]);
    expect(r.plans.map((p) => [p.op, p.path])).toEqual([["create", "Contacts/Dr. Florian Brandes.md"], ["create", "Contacts/Alex Aguado (2).md"]]);
    expect(r.state.objects["/k/c3.vcf"]).toMatchObject({ uid: "c3-1@test", etag: '"1"', notes: { "": { path: "Contacts/Dr. Florian Brandes.md" } } });
    expect(r.state.snapshot.etags["/k/c4.vcf"]).toBe('"2"');
    expect(r.counts).toEqual({ created: 2, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 });
  });
  it("unparsable object → error, others proceed; snapshot keeps no etag for the bad href (or the previous one, if given)", () => {
    const r = applyDelta({
      profile: defaultContactProfile(),
      source: "acc/kon",
      now: NOW,
      state: emptyState("acc/kon"),
      lookup: lookupOf([]),
      delta: delta({ changed: [{ href: "https://s/k/bad.vcf", etag: '"1"', data: "BEGIN:VCALENDAR\nEND:VCALENDAR" }, { href: "https://s/k/c4.vcf", etag: '"2"', data: fx("vcard", "v4-min.vcf") }], snapshot: { etags: { "/k/bad.vcf": '"1"', "/k/c4.vcf": '"2"' } } }),
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.href).toContain("bad.vcf");
    expect(r.plans).toHaveLength(1);
    expect(r.counts.errors).toBe(1);
    expect(r.state.snapshot.etags["/k/bad.vcf"]).toBeUndefined();
    expect(r.state.snapshot.etags["/k/c4.vcf"]).toBe('"2"');
  });
  it("unparsable object with a previous etag in state → snapshot keeps the previous etag, not the new one", () => {
    const st = upsertObject(emptyState("acc/kon"), "/k/bad.vcf", { uid: "u", etag: '"old"', raw: "x", written: {}, hash: "h", notePath: "Contacts/X.md", at: "t" });
    const stWithSnap = { ...st, snapshot: { etags: { "/k/bad.vcf": '"old"' } } };
    const r = applyDelta({
      profile: defaultContactProfile(),
      source: "acc/kon",
      now: NOW,
      state: stWithSnap,
      lookup: lookupOf([]),
      delta: delta({ changed: [{ href: "https://s/k/bad.vcf", etag: '"new"', data: "BEGIN:VCALENDAR\nEND:VCALENDAR" }], snapshot: { etags: { "/k/bad.vcf": '"new"' } } }),
    });
    expect(r.errors).toHaveLength(1);
    expect(r.state.snapshot.etags["/k/bad.vcf"]).toBe('"old"');
  });
  it("deleted: trash vs mark, object removed from state", () => {
    const st = upsertObject(emptyState("acc/kon"), "/k/c4.vcf", { uid: "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001", etag: '"2"', raw: "x", written: {}, hash: "h", notePath: "Contacts/Alex Aguado.md", at: "t" });
    const note = { path: "Contacts/Alex Aguado.md", frontmatter: { dav_uid: "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001", dav_source: "acc/kon" }, body: "" };
    const r = applyDelta({ profile: defaultContactProfile(), source: "acc/kon", now: NOW, state: st, lookup: lookupOf([note], ["Contacts/Alex Aguado.md"]), delta: delta({ deleted: ["https://s/k/c4.vcf"] }) });
    expect(r.plans).toEqual([{ op: "delete", path: "Contacts/Alex Aguado.md", uid: note.frontmatter.dav_uid, mode: "mark", set: { dav_state: "deleted" } }]);
    expect(r.state.objects["/k/c4.vcf"]).toBeUndefined();
  });
  it("deleted: note missing on disk → error recorded, object still removed from state", () => {
    const st = upsertObject(emptyState("acc/kon"), "/k/c4.vcf", { uid: "u", etag: '"2"', raw: "x", written: {}, hash: "h", notePath: "Contacts/Gone.md", at: "t" });
    const r = applyDelta({ profile: defaultContactProfile(), source: "acc/kon", now: NOW, state: st, lookup: lookupOf([]), delta: delta({ deleted: ["https://s/k/c4.vcf"] }) });
    expect(r.plans).toEqual([]);
    expect(r.errors).toEqual([{ href: "https://s/k/c4.vcf", message: "Notiz nicht auffindbar: Contacts/Gone.md" }]);
    expect(r.counts.errors).toBe(1);
    expect(r.state.objects["/k/c4.vcf"]).toBeUndefined();
  });
  it("outOfWindow: note missing on disk → error recorded", () => {
    const st = upsertObject(emptyState("acc/kon"), "/k/c4.vcf", { uid: "u", etag: '"2"', raw: "x", written: {}, hash: "h", notePath: "Contacts/Gone.md", at: "t" });
    const r = applyDelta({ profile: defaultContactProfile(), source: "acc/kon", now: NOW, state: st, lookup: lookupOf([]), delta: delta({ outOfWindow: ["https://s/k/c4.vcf"] }) });
    expect(r.plans).toEqual([]);
    expect(r.errors).toEqual([{ href: "https://s/k/c4.vcf", message: "Notiz nicht auffindbar: Contacts/Gone.md" }]);
    expect(r.counts.errors).toBe(1);
  });
});
describe("applyDelta — events", () => {
  const p = defaultEventProfile();
  it("master + override become two notes; out-of-window existing note is archived; out-of-window new is not created", () => {
    const win = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") };
    const r = applyDelta({
      profile: p,
      source: "acc/kal",
      now: NOW,
      state: emptyState("acc/kal"),
      lookup: lookupOf([{ path: "Events/old.md", frontmatter: { dav_uid: "allday-1@test", dav_source: "acc/kal", dav_state: "live" }, body: "" }]),
      timeWindow: win,
      delta: delta({ changed: [{ href: "https://s/c/ov.ics", etag: '"1"', data: fx("ical", "override.ics") }, { href: "https://s/c/x.ics", etag: '"2"', data: fx("ical", "allday.ics") }, { href: "https://s/c/s.ics", etag: '"3"', data: fx("ical", "simple.ics") }] }),
    });
    const ops = r.plans.map((x) => [x.op, x.path]);
    expect(ops).toContainEqual(["create", "Events/2026-09-01 Standup.md"]);
    expect(ops).toContainEqual(["create", "Events/2026-09-03 Standup (verschoben).md"]);
    expect(ops).toContainEqual(["archive", "Events/old.md"]); // Weihnachten außerhalb, Notiz existiert
    expect(ops).toContainEqual(["create", "Events/2026-09-01 Zahnärztin Dr. Müller.md"]);
    expect(r.state.objects["/c/ov.ics"]!.notes).toMatchObject({ "": { path: "Events/2026-09-01 Standup.md" }, "2026-09-03T07:00:00Z": { path: "Events/2026-09-03 Standup (verschoben).md" } });
    const ovPlan = r.plans.find((x) => x.path.includes("verschoben"));
    expect(ovPlan && ovPlan.op === "create" ? ovPlan.frontmatter["dav_recurrence_id"] : null).toBe("2026-09-03T07:00:00Z");
  });
  it("outOfWindow hrefs archive their notes but stay in state (kein timeWindow im Input → alte Auswahl-Regel)", () => {
    const st = upsertObject(emptyState("acc/kal"), "/c/s.ics", { uid: "simple-1@test", etag: '"3"', raw: "x", written: {}, hash: "h", notePath: "Events/S.md", at: "t" });
    const r = applyDelta({ profile: p, source: "acc/kal", now: NOW, state: st, lookup: lookupOf([{ path: "Events/S.md", frontmatter: { dav_uid: "simple-1@test", dav_source: "acc/kal" }, body: "" }]), delta: delta({ outOfWindow: ["https://s/c/s.ics"] }) });
    expect(r.plans).toEqual([{ op: "archive", path: "Events/S.md", uid: "simple-1@test", set: { dav_state: "archived" } }]);
    expect(r.state.objects["/c/s.ics"]).toBeDefined();
  });
  it("outOfWindow href, dessen gespeichertes raw NOCH im Fenster liegt → echte Loeschung (delete:trash), Objekt raus aus dem State", () => {
    const win = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") };
    const st = upsertObject(emptyState("acc/kal"), "/c/s.ics", { uid: "simple-1@test", etag: '"3"', raw: fx("ical", "simple.ics"), written: {}, hash: "h", notePath: "Events/S.md", at: "t" });
    const r = applyDelta({
      profile: p,
      source: "acc/kal",
      now: NOW,
      state: st,
      timeWindow: win,
      lookup: lookupOf([{ path: "Events/S.md", frontmatter: { dav_uid: "simple-1@test", dav_source: "acc/kal", dav_state: "live" }, body: "" }]),
      delta: delta({ outOfWindow: ["https://s/c/s.ics"] }),
    });
    expect(r.plans).toEqual([{ op: "delete", path: "Events/S.md", uid: "simple-1@test", mode: "trash" }]);
    expect(r.state.objects["/c/s.ics"]).toBeUndefined();
  });
  it("outOfWindow href, dessen gespeichertes raw AUSSERHALB des Fensters liegt → weiterhin archive, Objekt bleibt im State", () => {
    const win = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") };
    const st = upsertObject(emptyState("acc/kal"), "/c/x.ics", { uid: "allday-1@test", etag: '"2"', raw: fx("ical", "allday.ics"), written: {}, hash: "h", notePath: "Events/X.md", at: "t" });
    const r = applyDelta({
      profile: p,
      source: "acc/kal",
      now: NOW,
      state: st,
      timeWindow: win,
      lookup: lookupOf([{ path: "Events/X.md", frontmatter: { dav_uid: "allday-1@test", dav_source: "acc/kal", dav_state: "live" }, body: "" }]),
      delta: delta({ outOfWindow: ["https://s/c/x.ics"] }),
    });
    expect(r.plans).toEqual([{ op: "archive", path: "Events/X.md", uid: "allday-1@test", set: { dav_state: "archived" } }]);
    expect(r.state.objects["/c/x.ics"]).toBeDefined();
  });
  it("attendees resolved through resolver", () => {
    const r = applyDelta({
      profile: p,
      source: "acc/kal",
      now: NOW,
      state: emptyState("acc/kal"),
      lookup: lookupOf([]),
      resolveAttendee: (m) => (m === "alex@example.test" ? { path: "Contacts/Alex Aguado", display: "Alex Aguado" } : undefined),
      delta: delta({ changed: [{ href: "https://s/c/a.ics", etag: '"1"', data: fx("ical", "attendees.ics") }] }),
    });
    const pl = r.plans[0]!;
    if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["attendees"]).toEqual(["[[Contacts/Alex Aguado|Alex Aguado]]", "sam@example.test"]);
  });
  it("override.ics synced twice with no changes → second run plans are all skip and no handEdited", () => {
    const win = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") };
    const input1 = {
      profile: p,
      source: "acc/kal",
      now: NOW,
      state: emptyState("acc/kal"),
      lookup: lookupOf([]),
      timeWindow: win,
      delta: delta({ changed: [{ href: "https://s/c/ov.ics", etag: '"1"', data: fx("ical", "override.ics") }] }),
    };
    const r1 = applyDelta(input1);
    for (const pl of r1.plans) expect(pl.op).toBe("create");
    const notesFromRun1: ExistingNote[] = r1.plans.map((pl) => {
      if (pl.op !== "create") throw new Error();
      return { path: pl.path, frontmatter: pl.frontmatter, body: pl.body };
    });
    const r2 = applyDelta({
      profile: p,
      source: "acc/kal",
      now: NOW,
      state: r1.state,
      lookup: lookupOf(notesFromRun1),
      timeWindow: win,
      delta: delta({ changed: [{ href: "https://s/c/ov.ics", etag: '"1"', data: fx("ical", "override.ics") }] }),
    });
    for (const pl of r2.plans) {
      expect(pl.op).toBe("skip");
      if (pl.op === "update") expect(pl.handEdited).toEqual([]);
    }
  });
});
describe("applyDelta — todos", () => {
  it("legt fuer eine offene Aufgabe eine Notiz an", () => {
    const p = defaultTodoProfile();
    const out = applyDelta({
      profile: p,
      source: "acc/tasks",
      now: NOW,
      state: emptyState("acc/tasks"),
      lookup: lookupOf([]),
      delta: delta({ changed: [{ href: "https://s/cal/t1.ics", data: fx("ical", "todo-simple.ics"), etag: '"e1"' }] }),
    });
    expect(out.plans.filter((x) => x.op === "create")).toHaveLength(1);
  });
  it("beansprucht die genannte Notiz fuer eine neue UID, statt eine zweite anzulegen", () => {
    // Der Fall: eine im Vault entstandene Aufgabe wurde gerade auf den Server geschrieben.
    // Sie traegt noch keine dav_uid, `byUid` findet sie also nicht — ohne `claim` entstuende
    // "Tasks/Steuererklärung vorbereiten (2).md" daneben, und die Ausgangsnotiz waere beim
    // naechsten Lauf wieder "neu" (gemessen als P28 des GUI-Smokes, 2026-09-05).
    const eigene = { path: "Tasks/Eigene Aufgabe.md", frontmatter: { title: "Steuererklärung vorbereiten" }, body: "Belege suchen." };
    const out = applyDelta({
      profile: defaultTodoProfile(),
      source: "acc/tasks",
      now: NOW,
      state: emptyState("acc/tasks"),
      lookup: lookupOf([eigene]),
      claim: { path: eigene.path, uid: "todo-1@test" },
      delta: delta({ changed: [{ href: "https://s/cal/t1.ics", data: fx("ical", "todo-simple.ics"), etag: '"e1"' }] }),
    });
    expect(out.plans.map((x) => [x.op, x.path])).toEqual([["update", "Tasks/Eigene Aufgabe.md"]]);
    const pl = out.plans[0]!;
    if (pl.op !== "update") throw new Error("erwartet: update");
    expect(pl.set["dav_uid"]).toBe("todo-1@test");
    expect(pl.set["dav_source"]).toBe("acc/tasks");
    expect(out.state.objects["/cal/t1.ics"]!.notes[""]!.path).toBe("Tasks/Eigene Aufgabe.md");
  });

  it("ignoriert den Anspruch fuer eine ANDERE UID", () => {
    // Sonst risse ein Anspruch eine beliebige fremde Aufgabe an sich, sobald zwei Objekte im
    // selben Delta ankommen — der Anspruch gilt fuer genau eine UID.
    const fremde = { path: "Tasks/Fremde Notiz.md", frontmatter: {}, body: "" };
    const out = applyDelta({
      profile: defaultTodoProfile(),
      source: "acc/tasks",
      now: NOW,
      state: emptyState("acc/tasks"),
      lookup: lookupOf([fremde]),
      claim: { path: fremde.path, uid: "eine-ganz-andere@test" },
      delta: delta({ changed: [{ href: "https://s/cal/t1.ics", data: fx("ical", "todo-simple.ics"), etag: '"e1"' }] }),
    });
    expect(out.plans.map((x) => x.op)).toEqual(["create"]);
    expect(out.plans[0]!.path).not.toBe(fremde.path);
  });

  it("laesst eine bereits gespiegelte Notiz gegen den Anspruch gewinnen", () => {
    // byUid vor claim: waere es umgekehrt, verschoebe ein Anspruch eine schon zugeordnete
    // Aufgabe auf eine andere Notiz.
    const gespiegelt = { path: "Tasks/Schon da.md", frontmatter: { dav_uid: "todo-1@test", dav_source: "acc/tasks" }, body: "" };
    const andere = { path: "Tasks/Anspruch.md", frontmatter: {}, body: "" };
    const out = applyDelta({
      profile: defaultTodoProfile(),
      source: "acc/tasks",
      now: NOW,
      state: emptyState("acc/tasks"),
      lookup: lookupOf([gespiegelt, andere]),
      claim: { path: andere.path, uid: "todo-1@test" },
      delta: delta({ changed: [{ href: "https://s/cal/t1.ics", data: fx("ical", "todo-simple.ics"), etag: '"e1"' }] }),
    });
    expect(out.plans.map((x) => x.path)).toEqual(["Tasks/Schon da.md"]);
  });

  it("archiviert eine lange erledigte Aufgabe statt sie anzulegen", () => {
    const p = defaultTodoProfile();
    const alt = fx("ical", "todo-done.ics").replace("COMPLETED:20260814T183000Z", "COMPLETED:20200101T000000Z");
    const out = applyDelta({
      profile: p,
      source: "acc/tasks",
      now: NOW,
      state: emptyState("acc/tasks"),
      lookup: lookupOf([]),
      timeWindow: { start: new Date("2026-06-01T00:00:00Z"), end: new Date("2027-06-01T00:00:00Z") },
      delta: delta({ changed: [{ href: "https://s/cal/t2.ics", data: alt, etag: '"e2"' }] }),
    });
    expect(out.plans.some((x) => x.op === "create")).toBe(false);
  });
});
