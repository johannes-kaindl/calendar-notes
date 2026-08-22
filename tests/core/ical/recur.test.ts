import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { eventOccursWithin } from "../../../src/core/ical/recur";
const fx = (n: string) => readFileSync(new URL(`../../fixtures/ical/${n}`, import.meta.url), "utf8");
const d = (s: string) => new Date(s);

describe("eventOccursWithin", () => {
  it("single event inside/outside", () => {
    const ics = fx("simple.ics"); // 2026-09-01 10:00 Europe/Berlin
    expect(eventOccursWithin(ics, d("2026-08-01T00:00:00Z"), d("2026-09-30T00:00:00Z"))).toBe(true);
    expect(eventOccursWithin(ics, d("2026-10-01T00:00:00Z"), d("2026-12-31T00:00:00Z"))).toBe(false);
  });
  it("allday: DTEND exclusive", () => {
    const ics = fx("allday.ics"); // 24.–26.12.
    expect(eventOccursWithin(ics, d("2026-12-26T00:00:00Z"), d("2026-12-26T23:59:59Z"))).toBe(true);
    expect(eventOccursWithin(ics, d("2026-12-27T00:00:00Z"), d("2026-12-31T00:00:00Z"))).toBe(false);
  });
  it("recurring weekly COUNT=10 from 2026-09-07, EXDATE 09-21", () => {
    const ics = fx("recurring-exdate.ics");
    expect(eventOccursWithin(ics, d("2026-10-10T00:00:00Z"), d("2026-10-13T00:00:00Z"))).toBe(true); // 12.10.
    expect(eventOccursWithin(ics, d("2026-09-20T00:00:00Z"), d("2026-09-22T00:00:00Z"))).toBe(false); // EXDATE
    expect(eventOccursWithin(ics, d("2027-01-01T00:00:00Z"), d("2027-12-31T00:00:00Z"))).toBe(false); // nach COUNT
  });
  it("infinite rrule terminates via range", () => {
    const ics = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:inf\nDTSTART:20260101T080000Z\nDTEND:20260101T090000Z\nRRULE:FREQ=DAILY\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR";
    expect(eventOccursWithin(ics, d("2030-05-05T00:00:00Z"), d("2030-05-06T00:00:00Z"))).toBe(true);
    expect(eventOccursWithin(ics, d("2025-01-01T00:00:00Z"), d("2025-12-31T00:00:00Z"))).toBe(false);
  });
  it("override counts with its own start", () => {
    const ics = fx("override.ics"); // master daily 09-01..05 07:00Z; override 09-03 moved to 09:00Z
    expect(eventOccursWithin(ics, d("2026-09-03T08:30:00Z"), d("2026-09-03T10:00:00Z"))).toBe(true);
  });
});
