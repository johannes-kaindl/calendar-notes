import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contactValues, eventValues, toFrontmatter, formatAddress, isOnline } from "../../../src/core/mirror/fields";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";

const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");

describe("contactValues", () => {
  it("v3-full", () => {
    const v = contactValues(parseContact(fx("vcard", "v3-full.vcf")));
    expect(v).toMatchObject({ fn: "Dr. Florian Brandes", given: "Florian", family: "Brandes", nickname: "Flo", email: "praxis@example.test", email_home: "flo@example.test", email_work: "praxis@example.test",
      tel_cell: "+49 171 1234567", tel_work: "+49 821 555 0", org: "MVZ am Marktplatz / Allgemeinmedizin", title: "Hausarzt", url: "https://mvz.example.test",
      adr: "Marktplatz 1, 86150 Augsburg, Deutschland", bday: "1975-04-12", note: "Blutbild nur vormittags, Karte mitbringen", categories: ["arzt", "gesundheit"], photo: "vorhanden" });
    expect(v["tel_home"]).toBeNull();
    expect(v["role"]).toBeNull();
  });
  it("v4-min: missing fields are null, not undefined", () => {
    const v = contactValues(parseContact(fx("vcard", "v4-min.vcf")));
    expect(v["org"]).toBeNull(); expect(v["adr"]).toBeNull(); expect(v["categories"]).toBeNull();
    expect(v["tel_cell"]).toBe("+34696386907");
  });
});
describe("formatAddress / isOnline", () => {
  it("formats sparse address", () => {
    expect(formatAddress({ types: [], pref: false, city: "Augsburg", country: "DE" })).toBe("Augsburg, DE");
  });
  it("online heuristics", () => {
    expect(isOnline({ location: "https://meet.jit.si/x" })).toBe(true);
    expect(isOnline({ location: "Zoom-Meeting", url: undefined })).toBe(true);
    expect(isOnline({ location: "Praxis am Markt" })).toBe(false);
  });
  it("does not false-positive on 'Teamsitzung' but recognizes Microsoft Teams", () => {
    expect(isOnline({ location: "Teamsitzung im Büro" })).toBe(false);
    expect(isOnline({ location: "Microsoft Teams" })).toBe(true);
    expect(isOnline({ location: "Zoom-Meeting" })).toBe(true);
    expect(isOnline({ location: "Praxis am Markt" })).toBe(false);
    expect(isOnline({ url: "https://x" })).toBe(true);
  });
});
describe("eventValues", () => {
  it("simple.ics", () => {
    const [e] = parseEvents(fx("ical", "simple.ics"));
    const v = eventValues(e!);
    expect(v).toMatchObject({ title: "Zahnärztin Dr. Müller", start: "2026-09-01T10:00:00", end: "2026-09-01T11:30:00", allday: false, tzid: "Europe/Berlin", location: "Praxis am Markt, Hauptstraße 1", url: "https://example.test/termin", online: true, status: "CONFIRMED", categories: ["arzt", "privat"], last_modified: "2026-08-02T09:00:00Z" });
    expect(v["rrule"]).toBeNull(); expect(v["attendees"]).toBeNull(); expect(v["organizer"]).toBeNull();
  });
  it("attendees resolved to wikilinks when resolver knows the email, else Name <email>", () => {
    const [e] = parseEvents(fx("ical", "attendees.ics"));
    const v = eventValues(e!, { resolveAttendee: (m) => (m === "alex@example.test" ? { path: "Kontakte/Alex Aguado", display: "Alex Aguado" } : undefined) });
    expect(v["attendees"]).toEqual(["[[Kontakte/Alex Aguado|Alex Aguado]]", "sam@example.test"]);
    expect(v["organizer"]).toBe("Jay Kaindl <mail@jkaindl.de>");
    const plain = eventValues(e!, { attendeeLinks: false, resolveAttendee: () => ({ path: "x" }) });
    expect(plain["attendees"]).toEqual(["Alex Aguado <alex@example.test>", "sam@example.test"]);
  });
  it("allday + rrule", () => {
    const [a] = parseEvents(fx("ical", "allday.ics")); const [r] = parseEvents(fx("ical", "recurring-exdate.ics"));
    expect(eventValues(a!)).toMatchObject({ allday: true, start: "2026-12-24", end: "2026-12-27" });
    expect(eventValues(r!)["rrule"]).toBe("FREQ=WEEKLY;BYDAY=MO;COUNT=10");
  });
});
describe("toFrontmatter", () => {
  it("maps via profile; null → unset; unmapped ignored", () => {
    const p = defaultContactProfile();
    const { set, unset } = toFrontmatter({ fn: "A", email: null, note: "x", tel_cell: "1" }, p);
    expect(set).toEqual({ title: "A", phone_mobile: "1" });
    expect(unset).toEqual(["email"]);
  });
  it("event default maps allday→all_day", () => {
    const { set } = toFrontmatter({ allday: true, title: "T" }, defaultEventProfile());
    expect(set).toEqual({ all_day: true, title: "T" });
  });
});
