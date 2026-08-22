import { describe, it, expect } from "vitest";
import { emptyState, upsertObject, removeObject, withSnapshot, parseState, HISTORY_MAX } from "../../../src/core/state/collection-state";
describe("collection-state", () => {
  const base = { uid: "u", etag: '"1"', raw: "RAW1", written: { a: 1 }, hash: "h1", notePath: "N.md", at: "2026-08-22T10:00:00Z" };
  it("upsert creates entry with empty history and notes[''] for master", () => {
    const s = upsertObject(emptyState("src"), "/k/a.ics", base);
    expect(s.objects["/k/a.ics"]).toMatchObject({ uid: "u", etag: '"1"', raw: "RAW1", notes: { "": { path: "N.md", written: { a: 1 }, hash: "h1" } }, history: [] });
    expect(emptyState("src").objects).toEqual({}); // pure
  });
  it("etag change pushes previous raw to history (capped), override note keyed by recurrenceId, other keys untouched", () => {
    let s = upsertObject(emptyState("src"), "/k/a.ics", base);
    for (let i = 2; i <= HISTORY_MAX + 3; i++) s = upsertObject(s, "/k/a.ics", { ...base, etag: `"${i}"`, raw: `RAW${i}`, at: `2026-08-22T10:0${i % 10}:00Z` });
    const o = s.objects["/k/a.ics"]!;
    expect(o.history).toHaveLength(HISTORY_MAX);
    expect(o.history[0]!.raw).toBe(`RAW${HISTORY_MAX + 2}`); // neueste zuerst
    expect(o.raw).toBe(`RAW${HISTORY_MAX + 3}`);
    s = upsertObject(s, "/k/a.ics", { ...base, etag: o.etag, raw: o.raw, notePath: "N (ov).md", written: { b: 2 }, hash: "h2", recurrenceId: "2026-09-03T07:00:00Z" });
    expect(s.objects["/k/a.ics"]!.notes).toEqual({
      "": { path: "N.md", written: { a: 1 }, hash: "h1" },
      "2026-09-03T07:00:00Z": { path: "N (ov).md", written: { b: 2 }, hash: "h2" },
    });
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
  it("migrates the old notePaths+written+hash shape to notes, assigning the old written/hash to every path entry", () => {
    const legacy = {
      version: 1, source: "src",
      snapshot: { etags: {} },
      objects: {
        "/k/a.ics": {
          uid: "u", etag: '"1"', raw: "RAW1",
          written: { a: 1 }, hash: "h1",
          notePaths: { "": "N.md", "2026-09-03T07:00:00Z": "N (ov).md" },
          history: [],
        },
      },
    };
    const s = parseState(legacy, "src");
    expect(s.objects["/k/a.ics"]!.notes).toEqual({
      "": { path: "N.md", written: { a: 1 }, hash: "h1" },
      "2026-09-03T07:00:00Z": { path: "N (ov).md", written: { a: 1 }, hash: "h1" },
    });
  });
  it("guards malformed object entries (missing notes and notePaths → empty notes)", () => {
    const legacy = { version: 1, source: "src", snapshot: { etags: {} }, objects: { "/k/a.ics": { uid: "u", etag: '"1"', raw: "RAW1" } } };
    const s = parseState(legacy, "src");
    expect(s.objects["/k/a.ics"]!.notes).toEqual({});
  });
});
