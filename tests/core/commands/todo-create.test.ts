import { describe, it, expect } from "vitest";
import { planTodoCreate } from "../../../src/core/commands/todo-commands";
import { defaultTodoProfile } from "../../../src/core/mirror/profile";
import { parseTodos, primaryTodo } from "../../../src/core/ical/todo";
import type { CommandContext } from "../../../src/core/commands/types";

function ctx(): CommandContext {
  return {
    now: new Date("2026-09-05T10:00:00Z"),
    profile: defaultTodoProfile(),
    collection: { id: "c1", href: "https://dav.example/cal/todo/", kind: "calendar", enabled: true } as never,
    account: { id: "a1" } as never,
    // Erstanlage: das Target traegt `new: true` statt href/uid — beides gibt es noch nicht.
    target: { kind: "todo", source: "a1:c1", new: true },
    rand: () => 0.5,
  };
}

describe("planTodoCreate", () => {
  it("erzeugt einen Plan mit createsNew und ohne etag", () => {
    // `createsNew` waehlt in executeCommandPlanLocked den If-None-Match-Header — der Schutz
    // davor, eine zwischenzeitlich entstandene gleichnamige Ressource zu ueberschreiben.
    const p = planTodoCreate(ctx(), { title: "Rueckruf Werkstatt", due: "2026-10-01" });
    expect(p.createsNew).toBe(true);
    expect(p.etag).toBeUndefined();
    expect(p.contentType).toBe("text/calendar");
  });

  it("legt den href unter der Collection an und endet auf .ics", () => {
    const p = planTodoCreate(ctx(), { title: "X" });
    expect(p.hrefForPut.startsWith("https://dav.example/cal/todo/")).toBe(true);
    expect(p.hrefForPut.endsWith(".ics")).toBe(true);
  });

  it("traegt dieselbe UID im Body wie im Dateinamen", () => {
    // CalDAV verlangt die UID im Body; der Ressourcenname leitet sich davon ab. Laufen die
    // beiden auseinander, findet der naechste Sync die Notiz nicht wieder.
    const p = planTodoCreate(ctx(), { title: "X" });
    const uid = primaryTodo(parseTodos(p.newRaw))?.uid;
    expect(uid).toBeTruthy();
    expect(p.hrefForPut.endsWith(`${uid}.ics`)).toBe(true);
  });

  it("uebernimmt Titel und Faelligkeit ins VTODO", () => {
    const p = planTodoCreate(ctx(), { title: "Rueckruf", due: "2026-10-01" });
    expect(p.newRaw).toContain("BEGIN:VTODO");
    expect(p.newRaw).toContain("SUMMARY:Rueckruf");
    expect(p.newRaw).toContain("SEQUENCE:0");
    expect(primaryTodo(parseTodos(p.newRaw))?.due).toContain("2026-10-01");
  });

  it("faellt ohne Status auf NEEDS-ACTION zurueck", () => {
    const p = planTodoCreate(ctx(), { title: "Ohne Status" });
    expect(p.newRaw).toContain("STATUS:NEEDS-ACTION");
  });

  it("liest den Frontmatter ueber die Profil-Felder, nicht ueber feste Namen", () => {
    // `start` heisst im Default-Profil "scheduled" — wer den Server-Feldnamen als
    // Frontmatter-Key erwartet, findet nichts.
    const p = planTodoCreate(ctx(), { title: "Mit Beginn", scheduled: "2026-10-02" });
    expect(primaryTodo(parseTodos(p.newRaw))?.start).toContain("2026-10-02");
  });

  it("zeigt im Diff nur Nachher-Werte, weil es kein Vorher gibt", () => {
    const p = planTodoCreate(ctx(), { title: "Neu" });
    expect(p.diff.every((d) => d.before === undefined)).toBe(true);
    expect(p.diff.some((d) => d.after === "Neu")).toBe(true);
  });
});
