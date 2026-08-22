import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseEvents, primaryEvent } from "../../../src/core/ical/event";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/ical/${n}`, import.meta.url), "utf8");

describe("parseEvents", () => {
  it("simple: felder, tzid, escapes, kategorien", () => {
    const [e] = parseEvents(fx("simple.ics"));
    expect(e).toMatchObject({
      uid: "simple-1@test", summary: "Zahnärztin Dr. Müller",
      location: "Praxis am Markt, Hauptstraße 1", description: "Kontrolle\nBitte Karte mitbringen",
      url: "https://example.test/termin", start: "2026-09-01T10:00:00", end: "2026-09-01T11:30:00",
      allDay: false, tzid: "Europe/Berlin", status: "CONFIRMED", categories: ["arzt", "privat"], sequence: 2,
      lastModified: "2026-08-02T09:00:00Z", exdates: [], attendees: [],
    });
    expect(e!.rrule).toBeUndefined();
    expect(e!.recurrenceId).toBeUndefined();
  });
  it("recurring: rrule als string, exdates utc", () => {
    const [e] = parseEvents(fx("recurring-exdate.ics"));
    expect(e!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO;COUNT=10");
    expect(e!.exdates).toEqual(["2026-09-21T07:00:00Z", "2026-10-05T07:00:00Z"]);
    expect(e!.start).toBe("2026-09-07T07:00:00Z");
    expect(e!.tzid).toBeUndefined();
  });
  it("allday", () => {
    const [e] = parseEvents(fx("allday.ics"));
    expect(e).toMatchObject({ allDay: true, start: "2026-12-24", end: "2026-12-27" });
  });
  it("attendees + organizer", () => {
    const [e] = parseEvents(fx("attendees.ics"));
    expect(e!.organizer).toEqual({ email: "mail@jkaindl.de", name: "Jay Kaindl" });
    expect(e!.attendees).toEqual([
      { email: "alex@example.test", name: "Alex Aguado", partstat: "ACCEPTED", role: "REQ-PARTICIPANT", rsvp: true },
      { email: "sam@example.test", partstat: "NEEDS-ACTION" },
    ]);
  });
  it("override: master + recurrence-id instanz; primaryEvent wählt master", () => {
    const evs = parseEvents(fx("override.ics"));
    expect(evs).toHaveLength(2);
    expect(evs[1]!.recurrenceId).toBe("2026-09-03T07:00:00Z");
    expect(primaryEvent(evs)!.summary).toBe("Standup");
  });
  it("wirft bei müll", () => { expect(() => parseEvents("hallo")).toThrow(); });
  it("fehlende DTEND: end undefined, kein crash", () => {
    const ics = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:x\nDTSTART:20260101T100000Z\nSUMMARY:X\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseEvents(ics)[0]).toMatchObject({ uid: "x", end: undefined, sequence: 0 });
  });
});
