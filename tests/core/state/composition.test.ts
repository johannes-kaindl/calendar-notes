import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { countEventComposition } from "../../../src/core/state/composition";
import { emptyState, upsertObject } from "../../../src/core/state/collection-state";
import { defaultEventProfile, defaultContactProfile, profileTemplates } from "../../../src/core/mirror/profile";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/ical/${n}`, import.meta.url), "utf8");
const at = "2026-10-14T00:00:00Z";
const put = (s: ReturnType<typeof emptyState>, href: string, raw: string) => upsertObject(s, href, { uid: href, etag: '"1"', raw, written: {}, hash: "h", notePath: `${href}.md`, at });

describe("countEventComposition", () => {
  it("zaehlt ganztaegige und Termine mit Uhrzeit getrennt", () => {
    let s = emptyState("src");
    s = put(s, "/a", fx("allday.ics"));
    s = put(s, "/b", fx("simple.ics"));
    s = put(s, "/c", fx("simple.ics"));
    expect(countEventComposition(s)).toEqual({ allDay: 1, timed: 2 });
  });
  it("ueberspringt unlesbare Rohdaten, statt zu werfen", () => {
    const s = put(put(emptyState("src"), "/x", "kein ical"), "/b", fx("simple.ics"));
    expect(countEventComposition(s)).toEqual({ allDay: 0, timed: 1 });
  });
  it("leerer Zustand: 0 und 0", () => {
    expect(countEventComposition(emptyState("src"))).toEqual({ allDay: 0, timed: 0 });
  });
});

describe("profileTemplates", () => {
  it("bietet Termin, ganztaegigen Kalender, Kontakt und Aufgaben, jede Vorlage besteht validateProfile", async () => {
    const { validateProfile } = await import("../../../src/core/mirror/profile");
    const ts = profileTemplates();
    expect(ts.map((x) => x.key)).toEqual(["event", "allday", "contact", "todo"]);
    for (const x of ts) expect(validateProfile(x.build()).ok, x.key).toBe(true);
  });
  it("die Vorlagen sind unabhaengig voneinander und tragen unterschiedliche Ordner", () => {
    const [a, b] = profileTemplates().map((x) => x.build());
    expect(a!.id).not.toBe(b!.id) ;
    expect(b!.kind).toBe("event");
    expect(b!.folder).not.toBe(defaultEventProfile().folder);
    expect(profileTemplates()[2]!.build().folder).toBe(defaultContactProfile().folder);
  });
  it("die Ganztags-Vorlage schreibt keine Uhrzeit-Felder (kein Ende, kein tzid)", () => {
    const allday = profileTemplates().find((x) => x.key === "allday")!.build();
    expect(allday.fields.end).toBeNull();
    expect(allday.fields.tzid).toBeNull();
    expect(allday.fields.allday).toBeTruthy();
  });
});
