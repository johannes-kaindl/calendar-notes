import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { filenameSubs, noteBasename, notePath } from "../../../src/core/mirror/filename";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";
const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");

describe("filename", () => {
  it("contact default {fn}", () => {
    const c = parseContact(fx("vcard", "v3-full.vcf"));
    expect(filenameSubs("contact", c)).toMatchObject({ fn: "Dr. Florian Brandes", family: "Brandes", given: "Florian", org: "MVZ am Marktplatz", uid: "c3-1@test" });
    expect(noteBasename(defaultContactProfile(), c)).toBe("Dr. Florian Brandes");
  });
  it("event default {start_date} {title}; invalid chars replaced; allday has empty start_time", () => {
    const [e] = parseEvents(fx("ical", "simple.ics"));
    expect(noteBasename(defaultEventProfile(), e!)).toBe("2026-09-01 Zahnärztin Dr. Müller");
    const [a] = parseEvents(fx("ical", "allday.ics"));
    expect(filenameSubs("event", a!)).toMatchObject({ start_date: "2026-12-24", start_time: "" });
    const weird = { ...e!, summary: "A/B: C?" };
    expect(noteBasename(defaultEventProfile(), weird)).not.toMatch(/[/:?]/);
  });
  it("falls back to uid when template renders empty; last resort", () => {
    const c = parseContact("BEGIN:VCARD\nVERSION:3.0\nUID:u-1\nFN:\nEND:VCARD");
    expect(noteBasename(defaultContactProfile(), c)).toBe("u-1");
  });
  it("notePath", () => {
    const p = { ...defaultContactProfile(), folder: "A/B" };
    expect(notePath(p, "X")).toBe("A/B/X.md");
    expect(notePath(p, "X", 2)).toBe("A/B/X (2).md");
    expect(notePath({ ...p, folder: "" }, "X")).toBe("X.md");
  });
});
