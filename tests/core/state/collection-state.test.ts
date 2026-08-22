import { describe, it, expect } from "vitest";
import { emptyState, upsertObject, removeObject, withSnapshot, parseState, HISTORY_MAX } from "../../../src/core/state/collection-state";
describe("collection-state", () => {
  const base = { uid: "u", etag: '"1"', raw: "RAW1", written: { a: 1 }, hash: "h1", notePath: "N.md", at: "2026-08-22T10:00:00Z" };
  it("upsert creates entry with empty history and notePaths[''] for master", () => {
    const s = upsertObject(emptyState("src"), "/k/a.ics", base);
    expect(s.objects["/k/a.ics"]).toMatchObject({ uid: "u", etag: '"1"', raw: "RAW1", notePaths: { "": "N.md" }, history: [] });
    expect(emptyState("src").objects).toEqual({}); // pure
  });
  it("etag change pushes previous raw to history (capped), override notePath keyed by recurrenceId", () => {
    let s = upsertObject(emptyState("src"), "/k/a.ics", base);
    for (let i = 2; i <= HISTORY_MAX + 3; i++) s = upsertObject(s, "/k/a.ics", { ...base, etag: `"${i}"`, raw: `RAW${i}`, at: `2026-08-22T10:0${i % 10}:00Z` });
    const o = s.objects["/k/a.ics"]!;
    expect(o.history).toHaveLength(HISTORY_MAX);
    expect(o.history[0]!.raw).toBe(`RAW${HISTORY_MAX + 2}`); // neueste zuerst
    expect(o.raw).toBe(`RAW${HISTORY_MAX + 3}`);
    s = upsertObject(s, "/k/a.ics", { ...base, etag: o.etag, raw: o.raw, notePath: "N (ov).md", recurrenceId: "2026-09-03T07:00:00Z" });
    expect(s.objects["/k/a.ics"]!.notePaths).toEqual({ "": "N.md", "2026-09-03T07:00:00Z": "N (ov).md" });
    expect(s.objects["/k/a.ics"]!.history).toHaveLength(HISTORY_MAX); // same etag → no push
  });
  it("remove, snapshot, parse tolerant", () => {
    let s = upsertObject(emptyState("src"), "/k/a.ics", base);
    s = removeObject(s, "/k/a.ics");
    expect(s.objects).toEqual({});
    s = withSnapshot(s, { etags: { "/k/b.ics": '"x"' }, syncToken: "t" });
    expect(s.snapshot.syncToken).toBe("t");
    expect(parseState(JSON.parse(JSON.stringify(s)), "src")).toEqual(s);
    expect(parseState("garbage", "src")).toEqual(emptyState("src"));
    expect(parseState({ version: 99 }, "src")).toEqual(emptyState("src"));
  });
});
