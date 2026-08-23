import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyMutation, newEventIcs } from "../../../src/core/ical/mutate";
import { parseEvents } from "../../../src/core/ical/event";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/ical/${n}`, import.meta.url), "utf8");
const NOW = { now: new Date("2026-08-22T12:00:00Z") };

describe("applyMutation", () => {
  it("times mit tzid: setzt DTSTART/DTEND, bumped SEQUENCE, erhält X-Props und VTIMEZONE", () => {
    const out = applyMutation(fx("simple.ics"), { kind: "times", start: "2026-09-02T14:00:00", end: "2026-09-02T15:00:00", tzid: "Europe/Berlin" }, NOW);
    expect(out).toContain("X-CUSTOM-KEEP:ja");
    expect(out).toContain("BEGIN:VTIMEZONE");
    const [e] = parseEvents(out);
    expect(e).toMatchObject({ start: "2026-09-02T14:00:00", end: "2026-09-02T15:00:00", tzid: "Europe/Berlin", sequence: 3, lastModified: "2026-08-22T12:00:00Z" });
  });
  it("times nach allday", () => {
    const [e] = parseEvents(applyMutation(fx("simple.ics"), { kind: "times", start: "2026-09-02", end: "2026-09-03", allDay: true }, NOW));
    expect(e).toMatchObject({ allDay: true, start: "2026-09-02", end: "2026-09-03" });
  });
  it("summary/location/description/url — null entfernt", () => {
    let ics = applyMutation(fx("simple.ics"), { kind: "summary", summary: "Neu" }, NOW);
    ics = applyMutation(ics, { kind: "location", location: null }, NOW);
    ics = applyMutation(ics, { kind: "url", url: "https://x.test" }, NOW);
    const [e] = parseEvents(ics);
    expect(e).toMatchObject({ summary: "Neu", url: "https://x.test" });
    expect(e!.location).toBeUndefined();
  });
  it("addAttendee / removeAttendee / partstat", () => {
    let ics = applyMutation(fx("attendees.ics"), { kind: "addAttendee", attendee: { email: "kim@example.test", name: "Kim", rsvp: true } }, NOW);
    expect(parseEvents(ics)[0]!.attendees.map((a) => a.email)).toEqual(["alex@example.test", "sam@example.test", "kim@example.test"]);
    ics = applyMutation(ics, { kind: "removeAttendee", email: "SAM@example.test" }, NOW);
    expect(parseEvents(ics)[0]!.attendees.map((a) => a.email)).toEqual(["alex@example.test", "kim@example.test"]);
    const before = parseEvents(ics)[0]!.sequence;
    ics = applyMutation(ics, { kind: "partstat", email: "kim@example.test", partstat: "ACCEPTED" }, NOW);
    const e = parseEvents(ics)[0]!;
    expect(e.attendees.find((a) => a.email === "kim@example.test")!.partstat).toBe("ACCEPTED");
    expect(e.sequence).toBe(before);   // partstat bumped nicht
  });
  it("mutation trifft nur den master bei override.ics", () => {
    const evs = parseEvents(applyMutation(fx("override.ics"), { kind: "summary", summary: "Daily" }, NOW));
    expect(evs[0]!.summary).toBe("Daily");
    expect(evs[1]!.summary).toBe("Standup (verschoben)");
  });
});
describe("newEventIcs", () => {
  it("erzeugt parsbares VCALENDAR mit UID/DTSTAMP", () => {
    const ics = newEventIcs({ uid: "n1@cn", summary: "Neu", start: "2026-10-01T09:00:00", end: "2026-10-01T10:00:00", tzid: "Europe/Berlin", location: "Büro" }, NOW);
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics).toContain("PRODID:");
    const [e] = parseEvents(ics);
    expect(e).toMatchObject({ uid: "n1@cn", summary: "Neu", start: "2026-10-01T09:00:00", tzid: "Europe/Berlin", location: "Büro", sequence: 0 });
  });
});

// Fix C1 (Review-Runde 3): `parseIsoParts` band Stunde/Minute/Sekunde bisher an EIN
// gemeinsames `(?:T..:..:..)?` — fehlten Sekunden ODER stand ein Leerzeichen statt `T`
// (das Formular-Placeholder-Format ist `YYYY-MM-DD HH:MM`, Obsidians eigene
// datetime-Frontmatter-Properties liefern `T14:00` ohne Sekunden), griff die Gruppe NICHT
// und die Uhrzeit wurde still auf 00:00 gerundet. Tabellengetrieben ueber alle akzeptierten
// Formen (s. `DATE_TIME_RE` in `src/core/commands/schema.ts`).
describe("parseIsoParts via applyMutation — C1: alle akzeptierten Zeit-Formen behalten die Uhrzeit", () => {
  it.each([
    ["2026-09-02T14:00:00", "2026-09-02T14:00:00"],
    ["2026-09-02T14:00", "2026-09-02T14:00:00"],
    ["2026-09-02 14:00", "2026-09-02T14:00:00"],
    ["2026-09-02 14:00:00", "2026-09-02T14:00:00"],
  ])("start=%j -> EventData.start=%j (nicht 00:00)", (input, expected) => {
    const out = applyMutation(fx("simple.ics"), { kind: "times", start: input, end: "2026-09-02T15:00:00", tzid: "Europe/Berlin" }, NOW);
    const [e] = parseEvents(out);
    expect(e!.start).toBe(expected);
    expect(e!.start.startsWith("2026-09-02T00:00")).toBe(false);
  });

  it("Z-Suffix (UTC) bleibt ueber alle Zeit-Formen erhalten", () => {
    const out = applyMutation(fx("simple.ics"), { kind: "times", start: "2026-09-02T14:00Z", end: "2026-09-02T15:00Z" }, NOW);
    const [e] = parseEvents(out);
    expect(e!.start).toBe("2026-09-02T14:00:00Z");
  });
});
