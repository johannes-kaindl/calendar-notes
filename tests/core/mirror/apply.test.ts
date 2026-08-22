import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyDelta, type NoteLookup } from "../../../src/core/mirror/apply";
import { emptyState, upsertObject } from "../../../src/core/state/collection-state";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
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
      kind: "contact",
      profile: defaultContactProfile(),
      source: "acc/kon",
      now: NOW,
      state: emptyState("acc/kon"),
      lookup: lookupOf([{ path: "Contacts/Alex Aguado.md", frontmatter: {}, body: "" }]),
      delta: delta({ changed: [{ href: "https://s/k/c3.vcf", etag: '"1"', data: fx("vcard", "v3-full.vcf") }, { href: "https://s/k/c4.vcf", etag: '"2"', data: fx("vcard", "v4-min.vcf") }], snapshot: { etags: { "/k/c3.vcf": '"1"', "/k/c4.vcf": '"2"' } } }),
    });
    expect(r.errors).toEqual([]);
    expect(r.plans.map((p) => [p.op, p.path])).toEqual([["create", "Contacts/Dr. Florian Brandes.md"], ["create", "Contacts/Alex Aguado (2).md"]]);
    expect(r.state.objects["/k/c3.vcf"]).toMatchObject({ uid: "c3-1@test", etag: '"1"', notePaths: { "": "Contacts/Dr. Florian Brandes.md" } });
    expect(r.state.snapshot.etags["/k/c4.vcf"]).toBe('"2"');
    expect(r.counts).toEqual({ created: 2, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 });
  });
  it("unparsable object → error, others proceed", () => {
    const r = applyDelta({
      kind: "contact",
      profile: defaultContactProfile(),
      source: "acc/kon",
      now: NOW,
      state: emptyState("acc/kon"),
      lookup: lookupOf([]),
      delta: delta({ changed: [{ href: "https://s/k/bad.vcf", etag: '"1"', data: "BEGIN:VCALENDAR\nEND:VCALENDAR" }, { href: "https://s/k/c4.vcf", etag: '"2"', data: fx("vcard", "v4-min.vcf") }] }),
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.href).toContain("bad.vcf");
    expect(r.plans).toHaveLength(1);
    expect(r.counts.errors).toBe(1);
  });
  it("deleted: trash vs mark, object removed from state", () => {
    const st = upsertObject(emptyState("acc/kon"), "/k/c4.vcf", { uid: "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001", etag: '"2"', raw: "x", written: {}, hash: "h", notePath: "Contacts/Alex Aguado.md", at: "t" });
    const note = { path: "Contacts/Alex Aguado.md", frontmatter: { dav_uid: "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001", dav_source: "acc/kon" }, body: "" };
    const r = applyDelta({ kind: "contact", profile: defaultContactProfile(), source: "acc/kon", now: NOW, state: st, lookup: lookupOf([note], ["Contacts/Alex Aguado.md"]), delta: delta({ deleted: ["https://s/k/c4.vcf"] }) });
    expect(r.plans).toEqual([{ op: "delete", path: "Contacts/Alex Aguado.md", uid: note.frontmatter.dav_uid, mode: "mark", set: { dav_state: "deleted" } }]);
    expect(r.state.objects["/k/c4.vcf"]).toBeUndefined();
  });
});
describe("applyDelta — events", () => {
  const p = defaultEventProfile();
  it("master + override become two notes; out-of-window existing note is archived; out-of-window new is not created", () => {
    const win = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") };
    const r = applyDelta({
      kind: "event",
      profile: p,
      source: "acc/kal",
      now: NOW,
      state: emptyState("acc/kal"),
      lookup: lookupOf([{ path: "Events/old.md", frontmatter: { dav_uid: "allday-1@test", dav_source: "acc/kal", dav_state: "live" }, body: "" }]),
      window: win,
      delta: delta({ changed: [{ href: "https://s/c/ov.ics", etag: '"1"', data: fx("ical", "override.ics") }, { href: "https://s/c/x.ics", etag: '"2"', data: fx("ical", "allday.ics") }, { href: "https://s/c/s.ics", etag: '"3"', data: fx("ical", "simple.ics") }] }),
    });
    const ops = r.plans.map((x) => [x.op, x.path]);
    expect(ops).toContainEqual(["create", "Events/2026-09-01 Standup.md"]);
    expect(ops).toContainEqual(["create", "Events/2026-09-03 Standup (verschoben).md"]);
    expect(ops).toContainEqual(["archive", "Events/old.md"]); // Weihnachten außerhalb, Notiz existiert
    expect(ops).toContainEqual(["create", "Events/2026-09-01 Zahnärztin Dr. Müller.md"]);
    expect(r.state.objects["/c/ov.ics"]!.notePaths).toEqual({ "": "Events/2026-09-01 Standup.md", "2026-09-03T07:00:00Z": "Events/2026-09-03 Standup (verschoben).md" });
    const ovPlan = r.plans.find((x) => x.path.includes("verschoben"));
    expect(ovPlan && ovPlan.op === "create" ? ovPlan.frontmatter["dav_recurrence_id"] : null).toBe("2026-09-03T07:00:00Z");
  });
  it("outOfWindow hrefs archive their notes but stay in state", () => {
    const st = upsertObject(emptyState("acc/kal"), "/c/s.ics", { uid: "simple-1@test", etag: '"3"', raw: "x", written: {}, hash: "h", notePath: "Events/S.md", at: "t" });
    const r = applyDelta({ kind: "event", profile: p, source: "acc/kal", now: NOW, state: st, lookup: lookupOf([{ path: "Events/S.md", frontmatter: { dav_uid: "simple-1@test", dav_source: "acc/kal" }, body: "" }]), delta: delta({ outOfWindow: ["https://s/c/s.ics"] }) });
    expect(r.plans).toEqual([{ op: "archive", path: "Events/S.md", uid: "simple-1@test", set: { dav_state: "archived" } }]);
    expect(r.state.objects["/c/s.ics"]).toBeDefined();
  });
  it("attendees resolved through resolver", () => {
    const r = applyDelta({
      kind: "event",
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
});
