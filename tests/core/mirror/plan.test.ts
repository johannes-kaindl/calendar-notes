import { describe, it, expect } from "vitest";
import { planUpsert, planRemoval, planArchive } from "../../../src/core/mirror/plan";
import { defaultContactProfile } from "../../../src/core/mirror/profile";
import { BLOCK_BEGIN, BLOCK_END } from "../../../src/core/mirror/body";

const p = defaultContactProfile();
const base = { profile: p, source: "acc/kontakte", uid: "u1", etag: '"e1"', values: { fn: "Kim Test", email: "kim@example.test", tel_cell: null }, block: "- 📧 —: kim@example.test", path: "Contacts/Kim Test.md" };
const wrap = (s: string) => `${BLOCK_BEGIN}\n${s}\n${BLOCK_END}\n`;

describe("planUpsert", () => {
  it("create: onCreate + identity + mapped; body block", () => {
    const pl = planUpsert(base);
    expect(pl.op).toBe("create");
    if (pl.op !== "create") return;
    expect(pl.path).toBe("Contacts/Kim Test.md");
    expect(pl.frontmatter).toEqual({ type: "contact", dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e1"', dav_state: "live", title: "Kim Test", email: "kim@example.test" });
    expect(pl.body).toBe(wrap("- 📧 —: kim@example.test"));
    expect(pl.written).toEqual({ dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e1"', dav_state: "live", title: "Kim Test", email: "kim@example.test" });
    expect(pl.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("create: managed wins over onCreate on collision; body none", () => {
    const pl = planUpsert({ ...base, profile: { ...p, body: "none", onCreate: { type: "x", title: "ignored" } } });
    if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["title"]).toBe("Kim Test");
    expect(pl.body).toBe("");
  });
  it("update: only differing keys, unset only present keys, free keys untouched, body merged", () => {
    const existing = { path: "Contacts/Kim Test.md", frontmatter: { type: "👤 Kontakt", bereich: "privat", dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e0"', dav_state: "live", title: "Kim Test", email: "alt@example.test", phone_mobile: "123" }, body: `Meine Notizen\n\n${wrap("alt")}` };
    const pl = planUpsert({ ...base, existing });
    if (pl.op !== "update") throw new Error(pl.op);
    expect(pl.set).toEqual({ dav_etag: '"e1"', email: "kim@example.test" });
    expect(pl.unset).toEqual(["phone_mobile"]);
    expect(pl.body).toBe(`Meine Notizen\n\n${wrap("- 📧 —: kim@example.test")}`);
    expect(pl.handEdited).toEqual([]);
    expect(Object.keys(pl.set)).not.toContain("bereich");
  });
  it("skip when nothing differs (same etag, same values, same block)", () => {
    const existing = { path: base.path, frontmatter: { dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e1"', dav_state: "live", title: "Kim Test", email: "kim@example.test" }, body: wrap("- 📧 —: kim@example.test") };
    expect(planUpsert({ ...base, existing }).op).toBe("skip");
  });
  it("handEdited lists managed keys the user changed since last write", () => {
    const existing = { path: base.path, frontmatter: { dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e0"', dav_state: "live", title: "Kim Test", email: "hand@example.test" }, body: "" };
    const pl = planUpsert({ ...base, existing, prevWritten: { dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e0"', dav_state: "live", title: "Kim Test", email: "server-old@example.test" } });
    if (pl.op !== "update") throw new Error();
    expect(pl.handEdited).toEqual(["email"]);
    expect(pl.set["email"]).toBe("kim@example.test"); // Server gewinnt (Spec §3), Hinweis via handEdited
  });
  it("recurrenceId sets the field; without it the field is unset", () => {
    const pl = planUpsert({ ...base, recurrenceId: "2026-09-03T07:00:00Z" });
    if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["dav_recurrence_id"]).toBe("2026-09-03T07:00:00Z");
    const ex = { path: base.path, frontmatter: { dav_uid: "u1", dav_recurrence_id: "x" }, body: "" };
    const up = planUpsert({ ...base, existing: ex });
    if (up.op !== "update") throw new Error();
    expect(up.unset).toContain("dav_recurrence_id");
  });
  it("state archived is written when requested", () => {
    const pl = planUpsert({ ...base, state: "archived" });
    if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["dav_state"]).toBe("archived");
  });
});
describe("planRemoval / planArchive", () => {
  const note = (fm: Record<string, unknown>, body = "") => ({ path: "Contacts/X.md", frontmatter: fm, body });
  it("trash when no backlinks and no user content", () => {
    expect(planRemoval(p, note({ dav_uid: "u" }, wrap("srv")), { hasBacklinks: false })).toEqual({ op: "delete", path: "Contacts/X.md", uid: "u", mode: "trash" });
  });
  it("mark when backlinks or user content", () => {
    expect(planRemoval(p, note({ dav_uid: "u" }, "mein text"), { hasBacklinks: false })).toMatchObject({ op: "delete", mode: "mark", set: { dav_state: "deleted" } });
    expect(planRemoval(p, note({ dav_uid: "u" }), { hasBacklinks: true })).toMatchObject({ op: "delete", mode: "mark" });
  });
  it("already deleted/archived → skip", () => {
    expect(planRemoval(p, note({ dav_uid: "u", dav_state: "deleted" }), { hasBacklinks: false })).toMatchObject({ op: "skip", reason: "already-deleted" });
    expect(planArchive(p, note({ dav_uid: "u", dav_state: "archived" }))).toMatchObject({ op: "skip", reason: "already-archived" });
    expect(planArchive(p, note({ dav_uid: "u" }))).toEqual({ op: "archive", path: "Contacts/X.md", uid: "u", set: { dav_state: "archived" } });
  });
});
