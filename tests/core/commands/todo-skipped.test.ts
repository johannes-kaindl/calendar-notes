import { describe, it, expect } from "vitest";
import { nichtUebertragbareKeys, todoServerFeld } from "../../../src/core/commands/todo-commands";
import { planPushHandEdits } from "../../../src/core/commands/push-hand-edits";
import { defaultTodoProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//DE",
  "BEGIN:VTODO", "UID:t1@test", "DTSTAMP:20260901T080000Z", "SEQUENCE:1",
  "SUMMARY:Steuer vorbereiten", "STATUS:NEEDS-ACTION",
  "END:VTODO", "END:VCALENDAR",
].join("\r\n");

describe("nichtUebertragbareKeys", () => {
  it("nennt genau die Felder, die kein TODO_SUPPORTED-Feld traegt", () => {
    // Im Default-Profil bilden `completed`/`rrule`/`allday` auf Frontmatter ab, stehen aber
    // bewusst NICHT in TODO_SUPPORTED (Spec §4: der Status leitet sie ab bzw. Nicht-Ziel).
    const p = defaultTodoProfile();
    expect(nichtUebertragbareKeys(p, ["status", "completedDate", "recurrence", "all_day"]))
      .toEqual(["completedDate", "recurrence", "all_day"]);
  });

  it("meldet ein voellig unbekanntes Frontmatter-Feld", () => {
    expect(nichtUebertragbareKeys(defaultTodoProfile(), ["irgendwas"])).toEqual(["irgendwas"]);
  });

  it("meldet nichts, wenn alle Felder abgebildet sind", () => {
    expect(nichtUebertragbareKeys(defaultTodoProfile(), ["title", "due", "tags"])).toEqual([]);
  });

  it("stimmt mit dem ueberein, was planPushHandEdits tatsaechlich ueberspringt", () => {
    // Der Grund, warum es diese Funktion gibt: die Anzeige VOR dem Senden und die Regel BEIM
    // Senden duerfen nicht auseinanderlaufen. Beide fragen jetzt `todoServerFeld`.
    const ctx: CommandContext = {
      now: new Date("2026-09-05T10:00:00Z"), profile: defaultTodoProfile(),
      collection: { id: "c1", href: "https://dav.example/cal/todo/", kind: "calendar", enabled: true } as never,
      account: { id: "a1" } as never,
      target: { kind: "todo", source: "a1:c1", href: "https://dav.example/cal/todo/t1.ics", uid: "t1@test" },
      raw: ICS, etag: '"e1"', rand: () => 0.5,
    };
    // `tags` ist Absicht: sein Server-Feld heisst `categories`. Ein Feld, das auf beiden
    // Seiten gleich heisst, taugt hier NICHT — eine Regel, die versehentlich die Server-
    // Feldnamen prueft statt der Frontmatter-Schluessel, antwortet dort trotzdem richtig
    // (in der Gegenprobe gemessen: mit genau diesem Fehler blieb der Test gruen).
    const r = planPushHandEdits(ctx, { tags: ["steuer"], recurrence: "FREQ=WEEKLY" }, { tags: [], recurrence: "" });
    expect(r.skipped.map((s) => s.key)).toEqual(["recurrence"]);
    expect(r.skipped.map((s) => s.key)).toEqual(nichtUebertragbareKeys(defaultTodoProfile(), ["tags", "recurrence"]));
  });
});

describe("todoServerFeld", () => {
  it("loest den Frontmatter-Schluessel zum Server-Feld auf", () => {
    expect(todoServerFeld(defaultTodoProfile(), "tags")).toBe("categories");
    expect(todoServerFeld(defaultTodoProfile(), "scheduled")).toBe("start");
    expect(todoServerFeld(defaultTodoProfile(), "recurrence")).toBeUndefined();
  });
});
