import { describe, it, expect } from "vitest";
import { diffRows } from "../../src/obsidian/plan-preview-modal";
import type { CommandPlan } from "../../src/core/commands/types";

function plan(diff: CommandPlan["diff"]): CommandPlan {
  return {
    commandId: "event.set-title", target: { kind: "event", source: "a1/c1", href: "https://dav.example/cal/e.ics", uid: "u1" },
    summary: "Titel geändert", diff, newRaw: "", contentType: "text/calendar", hrefForPut: "https://dav.example/cal/e.ics", createsNew: false,
  };
}

describe("diffRows", () => {
  it("passes field/before/after through unchanged", () => {
    const rows = diffRows(plan([{ field: "title", before: "Alt", after: "Neu" }]));
    expect(rows).toEqual([{ field: "title", before: "Alt", after: "Neu" }]);
  });

  it("shows an em dash for missing before/after values (e.g. a newly-set field)", () => {
    const rows = diffRows(plan([{ field: "location", after: "Büro" }, { field: "url", before: "https://old" }]));
    expect(rows).toEqual([
      { field: "location", before: "—", after: "Büro" },
      { field: "url", before: "https://old", after: "—" },
    ]);
  });
});
