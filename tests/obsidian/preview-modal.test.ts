import { describe, it, expect } from "vitest";
import { summarizeRun } from "../../src/obsidian/preview-modal";
import type { RunResult, CollectionRunResult } from "../../src/core/sync/types";
import type { NotePlan } from "../../src/core/mirror/plan";

function counts(overrides: Partial<CollectionRunResult["counts"]> = {}): CollectionRunResult["counts"] {
  return { created: 0, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0, ...overrides };
}

describe("summarizeRun", () => {
  it("groups plans by op and totals them across collections", () => {
    const plans: NotePlan[] = [
      { op: "create", path: "Events/a.md", uid: "u1", frontmatter: {}, body: "", written: {}, hash: "h1" },
      { op: "skip", path: "Events/b.md", uid: "u2", reason: "unchanged" },
      { op: "archive", path: "Events/c.md", uid: "u3", set: { dav_state: "archived" } },
    ];
    const r: RunResult = {
      startedAt: "2026-08-22T10:00:00Z",
      finishedAt: "2026-08-22T10:00:01Z",
      collections: [
        { collectionId: "c1", ok: true, dryRun: true, plans, counts: counts({ created: 1, archived: 1, skipped: 1 }), handEdited: [] },
        { collectionId: "c2", ok: false, dryRun: true, plans: [], counts: counts({ errors: 1 }), handEdited: [], error: "boom" },
      ],
    };
    const s = summarizeRun(r);
    expect(s.total).toBe(3);
    expect(s.byOp.create).toHaveLength(1);
    expect(s.byOp.skip).toHaveLength(1);
    expect(s.byOp.archive).toHaveLength(1);
    expect(s.byOp.update).toHaveLength(0);
    expect(s.byOp.delete).toHaveLength(0);
    expect(s.perCollection).toEqual([
      { id: "c1", counts: counts({ created: 1, archived: 1, skipped: 1 }) },
      { id: "c2", counts: counts({ errors: 1 }), error: "boom" },
    ]);
  });

  it("carries a collection's skippedReason through", () => {
    const r: RunResult = {
      startedAt: "t0",
      finishedAt: "t1",
      collections: [{ collectionId: "c1", ok: true, dryRun: true, plans: [], counts: counts(), handEdited: [], skippedReason: "disabled" }],
    };
    expect(summarizeRun(r).perCollection).toEqual([{ id: "c1", counts: counts(), skippedReason: "disabled" }]);
  });

  it("detail for update = set/unset keys + Body when the body changed", () => {
    const plan: NotePlan = { op: "update", path: "Events/a.md", uid: "u1", set: { title: "Neu" }, unset: ["dav_recurrence_id"], body: "…", written: {}, hash: "h", handEdited: [] };
    const r: RunResult = { startedAt: "t0", finishedAt: "t1", collections: [{ collectionId: "c1", ok: true, dryRun: true, plans: [plan], counts: counts({ updated: 1 }), handEdited: [] }] };
    const s = summarizeRun(r);
    expect(s.byOp.update).toEqual([{ path: "Events/a.md", detail: "set: title; unset: dav_recurrence_id; Body" }]);
  });

  it("detail for update omits Body when the body did not change", () => {
    const plan: NotePlan = { op: "update", path: "Events/a.md", uid: "u1", set: { title: "Neu" }, unset: [], written: {}, hash: "h", handEdited: [] };
    const r: RunResult = { startedAt: "t0", finishedAt: "t1", collections: [{ collectionId: "c1", ok: true, dryRun: true, plans: [plan], counts: counts({ updated: 1 }), handEdited: [] }] };
    expect(summarizeRun(r).byOp.update).toEqual([{ path: "Events/a.md", detail: "set: title" }]);
  });

  it("detail for delete = mode", () => {
    const plan: NotePlan = { op: "delete", path: "Events/a.md", uid: "u1", mode: "trash" };
    const r: RunResult = { startedAt: "t0", finishedAt: "t1", collections: [{ collectionId: "c1", ok: true, dryRun: true, plans: [plan], counts: counts({ deleted: 1 }), handEdited: [] }] };
    expect(summarizeRun(r).byOp.delete).toEqual([{ path: "Events/a.md", detail: "trash" }]);
  });

  it("create/skip/archive plans carry no detail", () => {
    const plans: NotePlan[] = [{ op: "create", path: "a.md", uid: "u1", frontmatter: {}, body: "", written: {}, hash: "h" }];
    const r: RunResult = { startedAt: "t0", finishedAt: "t1", collections: [{ collectionId: "c1", ok: true, dryRun: true, plans, counts: counts({ created: 1 }), handEdited: [] }] };
    expect(summarizeRun(r).byOp.create).toEqual([{ path: "a.md" }]);
  });
});
