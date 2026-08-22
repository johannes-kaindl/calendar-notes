import { describe, it, expect } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { propfindBody, syncCollectionBody, calendarMultigetBody, addressbookMultigetBody, calendarQueryBody, xmlEscape } from "../../../src/core/dav/requests";

const wellFormed = (xml: string) => { new XMLParser().parse(xml); return true; };

describe("request bodies", () => {
  it("propfind lists props with correct namespaces", () => {
    const b = propfindBody(["d:displayname", "cs:getctag", "c:supported-calendar-component-set", "cr:addressbook-home-set", "ical:calendar-color"]);
    expect(wellFormed(b)).toBe(true);
    expect(b).toContain('xmlns:d="DAV:"');
    expect(b).toContain("<c:supported-calendar-component-set/>");
    expect(b).toContain("<ical:calendar-color/>");
    expect(b).toContain("<cr:addressbook-home-set/>");
  });
  it("sync-collection: leerer token bei Erstlauf, sync-level 1", () => {
    const b = syncCollectionBody(undefined);
    expect(b).toContain("<d:sync-token></d:sync-token>");
    expect(b).toContain("<d:sync-level>1</d:sync-level>");
    expect(syncCollectionBody("http://x/1")).toContain("<d:sync-token>http://x/1</d:sync-token>");
  });
  it("multiget escapes hrefs", () => {
    const b = calendarMultigetBody(["/k/a&b.ics"]);
    expect(b).toContain("<d:href>/k/a&amp;b.ics</d:href>");
    expect(b).toContain("<c:calendar-data/>");
    expect(addressbookMultigetBody(["/c/1.vcf"])).toContain("<cr:address-data/>");
  });
  it("calendar-query with time-range on VEVENT", () => {
    const b = calendarQueryBody({ start: "20260101T000000Z", end: "20261231T000000Z" });
    expect(b).toContain('<c:comp-filter name="VEVENT">');
    expect(b).toContain('<c:time-range start="20260101T000000Z" end="20261231T000000Z"/>');
    expect(calendarQueryBody()).not.toContain("time-range");
  });
  it("calendar-query: ungültiges time-range-Format wirft", () => {
    expect(() => calendarQueryBody({ start: "2026-01-01T00:00:00Z", end: "20261231T000000Z" })).toThrow("time-range erwartet UTC-Zeitstempel YYYYMMDDTHHMMSSZ");
    expect(() => calendarQueryBody({ start: "20260101T000000Z", end: "not-a-date" })).toThrow("time-range erwartet UTC-Zeitstempel YYYYMMDDTHHMMSSZ");
  });
  it("xmlEscape", () => { expect(xmlEscape(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;"); });
});
