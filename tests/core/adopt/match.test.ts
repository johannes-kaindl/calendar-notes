import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { candidateNotes, countTypeExcluded, matchItems, nameSimilarity, type CandidateNote, type ServerItem } from "../../../src/core/adopt/match";

const FIXTURES = join(__dirname, "../../fixtures");
const read = (rel: string): string => readFileSync(join(FIXTURES, rel), "utf8");

function contactItem(vcf: string, href = "/dav/contacts/c1.vcf"): ServerItem {
  const data = parseContact(vcf);
  return { uid: data.uid, href, kind: "contact", data, raw: vcf, etag: "\"e1\"" };
}
function eventItem(ics: string, href = "/dav/events/e1.ics"): ServerItem {
  const data = parseEvents(ics)[0];
  if (!data) throw new Error("kein Event in Fixture");
  return { uid: data.uid, href, kind: "event", data, raw: ics, etag: "\"e1\"" };
}
function note(path: string, frontmatter: Record<string, unknown>, body = ""): CandidateNote {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return { path, basename, frontmatter, body };
}

const vcardFull = read("vcard/v3-full.vcf");

describe("nameSimilarity", () => {
  it("is 1 for identical names", () => {
    expect(nameSimilarity("Florian Brandes", "Florian Brandes")).toBe(1);
  });
  it("is 1 for two empty strings (trivial equality)", () => {
    expect(nameSimilarity("", "")).toBe(1);
  });
  it("is 0 when one side is empty and the other is not", () => {
    expect(nameSimilarity("", "Florian Brandes")).toBe(0);
  });
  it("ignores diacritics", () => {
    expect(nameSimilarity("Björn Müller", "Bjorn Muller")).toBeGreaterThanOrEqual(0.95);
  });
  it("honorifics don't sink an otherwise-identical name below the likely threshold", () => {
    const sim = nameSimilarity("Dr. Florian Brandes", "Florian Brandes");
    expect(sim).toBeGreaterThanOrEqual(0.85);
  });
  it("unrelated names score low", () => {
    expect(nameSimilarity("Florian Brandes", "Sandra Meier")).toBeLessThan(0.3);
  });
  it("bigram Dice reaches at least 0.7 for a short name that is a substring of a longer one (\"Zahnärztin\" ⊂ \"Zahnärztin Dr. Müller\") — no separate containment term exists", () => {
    expect(nameSimilarity("Zahnärztin Dr. Müller", "Zahnärztin")).toBeGreaterThanOrEqual(0.7);
  });
});

describe("candidateNotes", () => {
  const profile = { ...defaultContactProfile(), folder: "Contacts", uidField: "vcard_uid", onCreate: { type: "👤 Kontakt" } };
  const notes: CandidateNote[] = [
    note("Contacts/Florian Brandes.md", { title: "Florian Brandes", type: "👤 Kontakt" }),
    note("Contacts/Sub/Alex Aguado.md", { title: "Alex Aguado", type: "👤 Kontakt" }),
    // Legacy vcard_uid (16-Hex-Hash, KEINE Server-UID) ohne dav_source: bleibt Kandidat — die
    // Verknuepfung ueberschreibt uidField anschliessend mit der echten Server-UID.
    note("Contacts/Legacy Uid.md", { title: "Legacy Uid", type: "👤 Kontakt", vcard_uid: "a4843c7a6d3005dd" }),
    // Bereits verknuepft (dav_source gesetzt) → kein Kandidat mehr, unabhaengig vom uidField-Wert.
    note("Contacts/Already Linked.md", { title: "Already Linked", type: "👤 Kontakt", vcard_uid: "c3-1@test", dav_source: "acc/col1" }),
    note("Other/Not In Folder.md", { title: "Not In Folder", type: "👤 Kontakt" }),
    note("Contacts/Wrong Type.md", { title: "Wrong Type", type: "📄 Note" }),
  ];

  it("keeps notes in the profile folder (including subfolders) that carry no sourceField yet, with matching onCreate.type", () => {
    const out = candidateNotes(notes, profile);
    expect(out.map((n) => n.path)).toEqual(["Contacts/Florian Brandes.md", "Contacts/Sub/Alex Aguado.md", "Contacts/Legacy Uid.md"]);
  });
  it("keeps a note with a legacy uidField value as long as sourceField is unset", () => {
    const legacy = note("Contacts/Real.md", { type: "👤 Kontakt", vcard_uid: "a4843c7a6d3005dd", telefon: "+34 696 386 907" });
    const out = candidateNotes([legacy], profile);
    expect(out).toEqual([legacy]);
  });
  it("excludes a note once sourceField (the dav_source link marker) is set, even with the same uidField value", () => {
    const linked = note("Contacts/Real.md", { type: "👤 Kontakt", vcard_uid: "a4843c7a6d3005dd", telefon: "+34 696 386 907", dav_source: "acc/col" });
    const out = candidateNotes([linked], profile);
    expect(out).toEqual([]);
  });
  it("keeps everything when folder is empty", () => {
    const out = candidateNotes(notes, { ...profile, folder: "" });
    expect(out.map((n) => n.path)).toContain("Other/Not In Folder.md");
  });
  it("keeps notes regardless of type when onCreate has no type", () => {
    const out = candidateNotes(notes, { ...profile, onCreate: {} });
    expect(out.map((n) => n.path)).toContain("Contacts/Wrong Type.md");
  });
});

describe("countTypeExcluded", () => {
  const profile = { ...defaultContactProfile(), folder: "Contacts", uidField: "vcard_uid", onCreate: { type: "👤 Kontakt" } };
  const notes: CandidateNote[] = [
    note("Contacts/Florian Brandes.md", { title: "Florian Brandes", type: "👤 Kontakt" }),
    note("Contacts/Wrong Type.md", { title: "Wrong Type", type: "🏢 Organisation" }),
    note("Contacts/Also Wrong.md", { title: "Also Wrong", type: "📄 Note" }),
    // Bereits verknuepft — zaehlt nicht mit, unabhaengig vom Typ.
    note("Contacts/Already Linked.md", { title: "Already Linked", type: "🏢 Organisation", dav_source: "acc/col1" }),
    note("Other/Not In Folder.md", { title: "Not In Folder", type: "🏢 Organisation" }),
  ];

  it("counts notes in the profile folder, without sourceField, whose type differs from onCreate.type", () => {
    expect(countTypeExcluded(notes, profile)).toBe(2);
  });
  it("is 0 when onCreate has no type (nothing is excluded by type)", () => {
    expect(countTypeExcluded(notes, { ...profile, onCreate: {} })).toBe(0);
  });
  it("ignores notes outside the profile folder", () => {
    const only = [note("Other/X.md", { type: "🏢 Organisation" })];
    expect(countTypeExcluded(only, profile)).toBe(0);
  });
});

describe("matchItems — contacts", () => {
  const profile = defaultContactProfile();

  it("matches by exact email (case-insensitive) with sure confidence", () => {
    const item = contactItem(vcardFull);
    const n = note("Contacts/Florian.md", { email: "PRAXIS@example.test" });
    const { suggestions, unmatchedItems, unmatchedNotes } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.reason).toBe("email");
    expect(suggestions[0]?.confidence).toBe("sure");
    expect(unmatchedItems).toHaveLength(0);
    expect(unmatchedNotes).toHaveLength(0);
  });

  it("matches by normalized phone regardless of formatting", () => {
    const item = contactItem(vcardFull);
    const n = note("Contacts/Florian.md", { telefon: "0171/1234567" });
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.reason).toBe("phone");
    expect(suggestions[0]?.confidence).toBe("sure");
  });

  it("matches by fuzzy name (title honorific dropped) as likely/sure", () => {
    const item = contactItem(vcardFull); // FN: Dr. Florian Brandes
    const n = note("Contacts/Florian Brandes.md", {});
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.reason).toBe("name");
    expect(["sure", "likely"]).toContain(suggestions[0]?.confidence);
  });

  it("does not match unrelated notes", () => {
    const item = contactItem(vcardFull);
    const n = note("Contacts/Someone Else.md", { email: "other@example.test" });
    const { suggestions, unmatchedItems, unmatchedNotes } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(0);
    expect(unmatchedItems).toHaveLength(1);
    expect(unmatchedNotes).toHaveLength(1);
  });

  it("assigns the note to the best-confidence item when two items compete for one note", () => {
    const sureItem = contactItem(vcardFull, "/dav/c1.vcf"); // email praxis@example.test
    const otherVcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:other@test\r\nFN:Sandra Meier\r\nEND:VCARD\r\n`;
    const weakItem = contactItem(otherVcf, "/dav/c2.vcf");
    const n = note("Contacts/Florian Brandes.md", { email: "praxis@example.test" });
    const { suggestions, unmatchedItems } = matchItems([weakItem, sureItem], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.item.href).toBe("/dav/c1.vcf");
    expect(suggestions[0]?.reason).toBe("email");
    expect(unmatchedItems.map((i) => i.href)).toEqual(["/dav/c2.vcf"]);
  });

  it("each note and item matches at most once (ties resolved by item order)", () => {
    const vcf1 = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:u1@test\r\nFN:Florian Brandes\r\nEND:VCARD\r\n`;
    const vcf2 = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:u2@test\r\nFN:Florian Brandes\r\nEND:VCARD\r\n`;
    const item1 = contactItem(vcf1, "/dav/c1.vcf");
    const item2 = contactItem(vcf2, "/dav/c2.vcf");
    const n = note("Contacts/Florian Brandes.md", {});
    const { suggestions, unmatchedItems } = matchItems([item1, item2], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.item.href).toBe("/dav/c1.vcf");
    expect(unmatchedItems.map((i) => i.href)).toEqual(["/dav/c2.vcf"]);
  });
});

describe("matchItems — events", () => {
  const profile = defaultEventProfile();
  const ics = read("ical/attendees.ics"); // UID att-1@test, SUMMARY Planung, DTSTART 20260910T120000Z

  it("matches start+title as likely when both align", () => {
    const item = eventItem(ics);
    const n = note("Events/2026-09-10 Planung.md", { start: "2026-09-10 12:00" });
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.reason).toBe("start+title");
    expect(suggestions[0]?.confidence).toBe("likely");
  });

  it("matches start only as weak when the title diverges", () => {
    const item = eventItem(ics);
    const n = note("Events/2026-09-10 Unrelated.md", { title: "Zahnarzttermin", start: "2026-09-10T12:00" });
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.confidence).toBe("weak");
  });

  it("accepts datum+uhrzeit as an alternative to start", () => {
    const item = eventItem(ics);
    const n = note("Events/Planung.md", { datum: "2026-09-10", uhrzeit: "12:00" });
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
  });

  it("does not match when start differs", () => {
    const item = eventItem(ics);
    const n = note("Events/Planung.md", { start: "2026-09-11 12:00" });
    const { suggestions, unmatchedItems } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(0);
    expect(unmatchedItems).toHaveLength(1);
  });

  it("matches same date within 120 minutes as weak, regardless of title, with the offset in the detail", () => {
    const item = eventItem(ics); // DTSTART 2026-09-10T12:00:00Z, SUMMARY Planung
    const n = note("Events/Planung.md", { start: "2026-09-10 14:00" }); // Δ120min, same date
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.confidence).toBe("weak");
    expect(suggestions[0]?.detail).toContain("120");
  });

  it("does not match same date beyond the 120-minute window", () => {
    const item = eventItem(ics); // DTSTART 2026-09-10T12:00:00Z
    const n = note("Events/Planung.md", { start: "2026-09-10 09:00" }); // Δ180min
    const { suggestions, unmatchedItems } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(0);
    expect(unmatchedItems).toHaveLength(1);
  });

  it("strips a date-prefixed basename before comparing titles, so a same-start event matches as likely", () => {
    const dentistIcs = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//DE\r\nBEGIN:VEVENT\r\nUID:zahn-1@test\r\nDTSTAMP:20260801T100000Z\r\nDTSTART:20260901T090000Z\r\nDTEND:20260901T093000Z\r\nSUMMARY:Zahnärztin Dr. Müller\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const item = eventItem(dentistIcs);
    // Notiz-Basename ist datumsgepraegt ("2026-09-01 Zahnärztin"), wie es Pallas-Terminnotizen sind.
    const n = note("Events/2026-09-01 Zahnärztin.md", { start: "2026-09-01 09:00" });
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.reason).toBe("start+title");
    expect(suggestions[0]?.confidence).toBe("likely");
  });

  it("also considers frontmatter title/titel (not just the basename) for the title comparison", () => {
    const dentistIcs = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//DE\r\nBEGIN:VEVENT\r\nUID:zahn-2@test\r\nDTSTAMP:20260801T100000Z\r\nDTSTART:20260901T090000Z\r\nDTEND:20260901T093000Z\r\nSUMMARY:Zahnärztin Dr. Müller\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const item = eventItem(dentistIcs);
    const n = note("Events/Termin.md", { start: "2026-09-01 09:00", titel: "Zahnärztin" });
    const { suggestions } = matchItems([item], [n], { profile });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.confidence).toBe("likely");
  });
});
