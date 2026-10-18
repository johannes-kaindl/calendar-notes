import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { filenameSubs, noteBasename, notePath } from "../../../src/core/mirror/filename";
import { defaultContactProfile, defaultEventProfile, defaultTodoProfile } from "../../../src/core/mirror/profile";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";
import { parseTodos } from "../../../src/core/ical/todo";
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
  it("der Dateiname folgt dem Server-FN wörtlich: ein FN „Buni Buni“ bleibt so, aus Vor- und Nachname setzt das Plugin nichts zusammen (Rollout Teil B, Befund 4)", () => {
    const doppelt = parseContact("BEGIN:VCARD\nVERSION:3.0\nUID:u-2\nFN:Buni Buni\nN:Mustermann;Buni;;;\nEND:VCARD");
    expect(noteBasename(defaultContactProfile(), doppelt)).toBe("Buni Buni");
    const nurN = parseContact("BEGIN:VCARD\nVERSION:3.0\nUID:u-3\nN:Mustermann;Erika;;;\nEND:VCARD");
    expect(noteBasename(defaultContactProfile(), nurN)).toBe("u-3");
  });
  it("eine Aufgabe ohne DTSTART und ohne DUE bekommt einen Namen statt eines Wurfs", () => {
    const [t] = parseTodos(fx("ical", "todo-minimal.ics"));
    expect(noteBasename(defaultTodoProfile(), t!)).toBe("Irgendwann mal aufräumen");
  });
  it("eine Aufgabe ohne SUMMARY faellt auf die UID zurueck", () => {
    const t = { uid: "todo-ohne@test", summary: "", allDay: false, categories: [], sequence: 0 };
    expect(noteBasename(defaultTodoProfile(), t)).toBe("todo-ohne@test");
  });
  // Namenskonvention des Vaults: YYYY-MM-DD_kategorie_kuerzel_betreff. Kategorie und Kuerzel stehen
  // als Literale in `onCreate` ({fm:schluessel}), der Betreff als Slug ({title_slug}).
  it("{fm:key} liest ein onCreate-Literal, {title_slug} ist der Betreff als Slug", () => {
    const [e] = parseEvents(fx("ical", "simple.ics"));
    const p = { ...defaultEventProfile(), filename: "{start_date}_{fm:termin_kategorie}_{fm:kuerzel}_{title_slug}", onCreate: { termin_kategorie: "arzt", kuerzel: "ZA" } };
    expect(noteBasename(p, e!)).toBe("2026-09-01_arzt_ZA_zahnaerztin-dr-mueller");
  });
  it("{fm:key} ohne onCreate-Wert ist leer und wirft nicht; ein unbekannter Name bleibt literal", () => {
    const [e] = parseEvents(fx("ical", "simple.ics"));
    const p = { ...defaultEventProfile(), filename: "{start_date}_{fm:fehlt}_{title_slug}" };
    expect(noteBasename(p, e!)).toBe("2026-09-01__zahnaerztin-dr-mueller");
    expect(noteBasename({ ...p, filename: "{fm:__proto__}{start_date}" }, e!)).toBe("2026-09-01");
  });
  it("{fm:key} nimmt nur Strings und Zahlen, keine Listen", () => {
    const [e] = parseEvents(fx("ical", "simple.ics"));
    const p = { ...defaultEventProfile(), filename: "{fm:tags}{fm:n}{title_slug}", onCreate: { tags: ["a", "b"], n: 3 } };
    expect(noteBasename(p, e!)).toBe("3zahnaerztin-dr-mueller");
  });
  it("{title_slug} gibt es auch fuer Aufgaben, {fn_slug} fuer Kontakte", () => {
    const [t] = parseTodos(fx("ical", "todo-minimal.ics"));
    expect(noteBasename({ ...defaultTodoProfile(), filename: "{title_slug}" }, t!)).toBe("irgendwann-mal-aufraeumen");
    const c = parseContact(fx("vcard", "v3-full.vcf"));
    expect(noteBasename({ ...defaultContactProfile(), filename: "{fn_slug}" }, c)).toBe("dr-florian-brandes");
  });
  it("notePath", () => {
    const p = { ...defaultContactProfile(), folder: "A/B" };
    expect(notePath(p, "X")).toBe("A/B/X.md");
    expect(notePath(p, "X", 2)).toBe("A/B/X (2).md");
    expect(notePath({ ...p, folder: "" }, "X")).toBe("X.md");
  });
});
