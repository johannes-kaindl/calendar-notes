import { describe, it, expect } from "vitest";
import { diffRows } from "../../src/obsidian/plan-preview-modal";
import type { CommandPlan } from "../../src/core/commands/types";

function plan(diff: CommandPlan["diff"]): CommandPlan {
  return {
    commandId: "event.set-title", target: { kind: "event", source: "a1/c1", href: "https://dav.example/cal/e.ics", uid: "u1" },
    summary: "Titel geändert", summaryKey: "test.summary", summaryArgs: [], diff, newRaw: "", contentType: "text/calendar", hrefForPut: "https://dav.example/cal/e.ics", createsNew: false,
  };
}

describe("diffRows", () => {
  it("translates the field key via fieldLabel and passes before/after through unchanged", () => {
    const rows = diffRows(plan([{ field: "title", before: "Alt", after: "Neu" }]));
    expect(rows).toEqual([{ field: "Title", before: "Alt", after: "Neu" }]);
  });

  it("humanizes a camelCase field key (e.g. allDay) without an i18n dictionary loaded", () => {
    const rows = diffRows(plan([{ field: "allDay", before: "false", after: "true" }]));
    expect(rows).toEqual([{ field: "All day", before: "false", after: "true" }]);
  });

  it("shows an em dash for missing before/after values (e.g. a newly-set field)", () => {
    const rows = diffRows(plan([{ field: "location", after: "Büro" }, { field: "url", before: "https://old" }]));
    expect(rows).toEqual([
      { field: "Location", before: "—", after: "Büro" },
      { field: "Url", before: "https://old", after: "—" },
    ]);
  });
});
