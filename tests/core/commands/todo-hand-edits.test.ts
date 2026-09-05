import { describe, it, expect } from "vitest";
import { planPushHandEdits } from "../../../src/core/commands/push-hand-edits";
import { defaultTodoProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//DE",
  "BEGIN:VTODO", "UID:t1@test", "DTSTAMP:20260901T080000Z", "SEQUENCE:1",
  "SUMMARY:Steuer vorbereiten", "STATUS:NEEDS-ACTION", "DUE:20260930T120000Z",
  "END:VTODO", "END:VCALENDAR",
].join("\r\n");

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    now: new Date("2026-09-05T10:00:00Z"),
    profile: defaultTodoProfile(),
    collection: { id: "c1", href: "https://dav.example/cal/todo/", kind: "calendar", enabled: true } as never,
    account: { id: "a1" } as never,
    target: { kind: "todo", source: "a1:c1", href: "https://dav.example/cal/todo/t1.ics", uid: "t1@test" },
    raw: ICS,
    etag: '"e1"',
    rand: () => 0.5,
    ...over,
  };
}

describe("planPushHandEdits fuer Aufgaben", () => {
  it("schreibt einen Statuswechsel als STATUS:COMPLETED", () => {
    const r = planPushHandEdits(ctx(), { status: "done" }, { status: "open" });
    expect(r.plan).not.toBeNull();
    expect(r.plan?.newRaw).toContain("STATUS:COMPLETED");
    expect(r.plan?.createsNew).toBe(false);
    expect(r.plan?.contentType).toBe("text/calendar");
    expect(r.plan?.etag).toBe('"e1"');
    expect(r.plan?.hrefForPut).toBe("https://dav.example/cal/todo/t1.ics");
  });

  it("erzeugt KEINEN Plan, wenn die Bewahrungsregel greift", () => {
    // Server steht auf CANCELLED, das Frontmatter zeigt weiter "done" — nichts zu tun.
    // Ohne die Regel aus Task 1 entstuende hier ein Plan, der CANCELLED zu COMPLETED macht.
    const c = ctx({ raw: ICS.replace("STATUS:NEEDS-ACTION", "STATUS:CANCELLED") });
    const r = planPushHandEdits(c, { status: "done" }, { status: "in-progress" });
    expect(r.plan).toBeNull();
  });

  it("schreibt einen geaenderten Titel", () => {
    const r = planPushHandEdits(ctx(), { title: "Steuer fertig machen" }, { title: "Steuer vorbereiten" });
    expect(r.plan?.newRaw).toContain("Steuer fertig machen");
  });

  it("schreibt eine geaenderte Faelligkeit", () => {
    const r = planPushHandEdits(ctx(), { due: "2026-10-07" }, { due: "2026-09-30" });
    expect(r.plan?.newRaw).toContain("20261007");
  });

  it("meldet ein nicht unterstuetztes Feld als skipped, statt es still zu verwerfen", () => {
    const r = planPushHandEdits(ctx(), { dav_etag: "geaendert" }, { dav_etag: "alt" });
    expect(r.plan).toBeNull();
    expect(r.skipped.map((s) => s.key)).toContain("dav_etag");
  });

  it("gibt null zurueck, wenn sich gar nichts geaendert hat", () => {
    const r = planPushHandEdits(ctx(), { status: "open" }, { status: "open" });
    expect(r.plan).toBeNull();
    expect(r.skipped).toHaveLength(0);
  });

  it("traegt einen Diff, der das geaenderte Feld nennt", () => {
    const r = planPushHandEdits(ctx(), { status: "done" }, { status: "open" });
    expect(r.plan?.diff.some((d) => d.field === "status")).toBe(true);
  });
});
