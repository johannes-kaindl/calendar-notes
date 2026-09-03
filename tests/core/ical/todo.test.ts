import { describe, it, expect } from "vitest";
import { parseTodos, isOpen } from "../../../src/core/ical/todo";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fx = (n: string): string => readFileSync(join(__dirname, "../../fixtures/ical", n), "utf8");

describe("parseTodos", () => {
  it("liest alle Felder einer vollstaendigen Aufgabe", () => {
    const [t] = parseTodos(fx("todo-simple.ics"));
    expect(t).toMatchObject({
      uid: "todo-1@test",
      summary: "Steuererklärung vorbereiten",
      description: "Belege sortieren",
      start: "2026-09-02T09:00:00",
      due: "2026-09-30T17:00:00",
      tzid: "Europe/Berlin",
      status: "IN-PROCESS",
      percentComplete: 40,
      priority: 2,
      allDay: false,
      sequence: 3,
      lastModified: "2026-09-02T12:00:00Z",
    });
    expect(t!.categories).toEqual(["Finanzen", "Privat"]);
  });

  it("kommt ohne DTSTART und ohne DUE aus", () => {
    const [t] = parseTodos(fx("todo-minimal.ics"));
    expect(t).toMatchObject({ uid: "todo-min@test", start: undefined, due: undefined, allDay: false, sequence: 0 });
    expect(t!.status).toBeUndefined();
  });

  it("erkennt ein Datum ohne Uhrzeit als ganztaegig und liest COMPLETED", () => {
    const [t] = parseTodos(fx("todo-done.ics"));
    expect(t).toMatchObject({ due: "2026-08-15", allDay: true, status: "COMPLETED", percentComplete: 100, completed: "2026-08-14T18:30:00Z" });
  });

  it("gibt RRULE ohne Praefix zurueck", () => {
    const [t] = parseTodos(fx("todo-recurring.ics"));
    expect(t!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("liefert ein leeres Array fuer einen Kalender ohne VTODO", () => {
    expect(parseTodos(fx("simple.ics"))).toEqual([]);
  });

  it("wirft bei Muell", () => {
    expect(() => parseTodos("hallo")).toThrow();
  });
});

describe("isOpen", () => {
  it("fehlendes STATUS gilt als offen", () => {
    expect(isOpen(parseTodos(fx("todo-minimal.ics"))[0]!)).toBe(true);
  });
  it("IN-PROCESS ist offen, COMPLETED nicht", () => {
    expect(isOpen(parseTodos(fx("todo-simple.ics"))[0]!)).toBe(true);
    expect(isOpen(parseTodos(fx("todo-done.ics"))[0]!)).toBe(false);
  });
  it("CANCELLED ist nicht offen", () => {
    expect(isOpen({ uid: "x", summary: "s", allDay: false, status: "CANCELLED", categories: [], sequence: 0 })).toBe(false);
  });
});
