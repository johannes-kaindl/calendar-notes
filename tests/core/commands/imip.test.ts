import { describe, it, expect } from "vitest";
import ICAL from "ical.js";
import { buildImip, insertMethod } from "../../../src/core/commands/imip";
import type { CommandPlan } from "../../../src/core/commands/types";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Johannes Kaindl//calendar-notes//DE",
  "BEGIN:VEVENT",
  "UID:evt-1",
  "DTSTAMP:20260822T120000Z",
  "SUMMARY:Teamrunde",
  "LOCATION:Raum 3",
  "DESCRIPTION:Sprint-Planung",
  "DTSTART:20260901T100000Z",
  "DTEND:20260901T110000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

function plan(overrides: Partial<CommandPlan> = {}): CommandPlan {
  return {
    commandId: "event.set-invite",
    target: { kind: "event", source: "acc1/cal1", href: "https://dav.example/cal1/evt-1.ics", uid: "evt-1" },
    summary: "Test",
    diff: [],
    newRaw: ICS,
    etag: '"e1"',
    contentType: "text/calendar",
    hrefForPut: "https://dav.example/cal1/evt-1.ics",
    createsNew: false,
    invite: { attendees: ["alice@example.test", "bob@example.test"], method: "REQUEST" },
    ...overrides,
  };
}

describe("insertMethod", () => {
  it("fuegt METHOD direkt nach PRODID ein", () => {
    const out = insertMethod(ICS, "REQUEST");
    const lines = out.split("\r\n");
    const prodidIdx = lines.findIndex((l) => l.startsWith("PRODID"));
    expect(lines[prodidIdx + 1]).toBe("METHOD:REQUEST");
  });

  it("bleibt mit ical.js parseierbar", () => {
    const out = insertMethod(ICS, "CANCEL");
    expect(() => ICAL.parse(out)).not.toThrow();
    const jcal = ICAL.parse(out);
    const root = new ICAL.Component(jcal);
    expect(root.getFirstPropertyValue("method")).toBe("CANCEL");
  });

  it("wirft ohne PRODID", () => {
    expect(() => insertMethod("BEGIN:VCALENDAR\r\nEND:VCALENDAR", "REQUEST")).toThrow();
  });
});

describe("buildImip", () => {
  it("baut Betreff/Text/ics fuer REQUEST", () => {
    const msg = buildImip(plan(), "REQUEST", "acc-mail", { now: new Date("2026-08-22T12:00:00Z") });
    expect(msg.method).toBe("REQUEST");
    expect(msg.from).toBe("acc-mail");
    expect(msg.to).toEqual(["alice@example.test", "bob@example.test"]);
    expect(msg.subject).toContain("Einladung: Teamrunde");
    expect(msg.text).toContain("Titel: Teamrunde");
    expect(msg.text).toContain("Ort: Raum 3");
    expect(msg.text).toContain("Beschreibung: Sprint-Planung");
    expect(msg.ics).toContain("METHOD:REQUEST");
    expect(() => ICAL.parse(msg.ics)).not.toThrow();
  });

  it("baut Betreff fuer CANCEL", () => {
    const msg = buildImip(plan({ invite: { attendees: ["alice@example.test"], method: "CANCEL" } }), "CANCEL", "acc-mail", { now: new Date() });
    expect(msg.subject).toContain("Absage: Teamrunde");
    expect(msg.ics).toContain("METHOD:CANCEL");
  });

  it("wirft ohne invite am Plan", () => {
    const p = plan();
    delete p.invite;
    expect(() => buildImip(p, "REQUEST", "acc-mail", { now: new Date() })).toThrow();
  });
});
