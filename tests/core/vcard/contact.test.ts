import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseContact, primaryEmail, primaryTel } from "../../../src/core/vcard/contact";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/vcard/${n}`, import.meta.url), "utf8");

describe("parseContact v3", () => {
  const c = parseContact(fx("v3-full.vcf"));
  it("kernfelder", () => {
    expect(c).toMatchObject({ uid: "c3-1@test", version: "3.0", fn: "Dr. Florian Brandes", nickname: "Flo", title: "Hausarzt", org: ["MVZ am Marktplatz", "Allgemeinmedizin"], bday: "1975-04-12", note: "Blutbild nur vormittags, Karte mitbringen", categories: ["arzt", "gesundheit"], rev: "2026-08-01T10:00:00Z" });
    expect(c.n).toEqual({ family: "Brandes", given: "Florian", prefix: "Dr." });
  });
  it("typed emails/tels mit pref", () => {
    expect(c.emails).toEqual([{ value: "praxis@example.test", types: ["internet", "work"], pref: true }, { value: "flo@example.test", types: ["home"], pref: false }]);
    expect(c.tels[0]).toEqual({ value: "+49 171 1234567", types: ["cell"], pref: false });
    expect(primaryEmail(c)).toBe("praxis@example.test");
    expect(primaryTel(c, "cell")).toBe("+49 171 1234567");
    expect(primaryTel(c, "work")).toBe("+49 821 555 0");
  });
  it("adresse strukturiert", () => {
    expect(c.adrs[0]).toMatchObject({ types: ["work"], street: "Marktplatz 1", city: "Augsburg", zip: "86150", country: "Deutschland" });
  });
  it("url + photo", () => {
    expect(c.urls[0]!.value).toBe("https://mvz.example.test");
    expect(c.photo).toMatchObject({ mediaType: "image/jpeg", data: "/9j/4AAQSkZJRgABAQAAAQABAAD" });
  });
});
describe("parseContact v4", () => {
  const c = parseContact(fx("v4-min.vcf"));
  it("tel: uri gestrippt, pref=1, bday ohne bindestriche normalisiert", () => {
    expect(c.version).toBe("4.0");
    expect(c.tels[0]).toEqual({ value: "+34696386907", types: ["cell"], pref: true });
    expect(c.emails[0]!.pref).toBe(true);
    expect(c.bday).toBe("1990-02-15");
    expect(c.n).toEqual({ family: "Aguado", given: "Alex" });
  });
  it("wirft bei müll", () => { expect(() => parseContact("BEGIN:VCALENDAR\nEND:VCALENDAR")).toThrow(/VCARD/); });
});
