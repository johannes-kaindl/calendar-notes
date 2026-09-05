import { describe, it, expect } from "vitest";
import { applyTodoMutation, newTodoIcs } from "../../../src/core/ical/mutate";
import { parseTodos, primaryTodo } from "../../../src/core/ical/todo";

const NOW = new Date("2026-09-05T10:00:00Z");

const BASIS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//DE",
  "BEGIN:VTODO", "UID:t1@test", "DTSTAMP:20260901T080000Z", "SEQUENCE:3",
  "SUMMARY:Steuer vorbereiten", "STATUS:NEEDS-ACTION", "DUE:20260930T120000Z",
  "END:VTODO", "END:VCALENDAR",
].join("\r\n");

function todoAus(ics: string) {
  const t = primaryTodo(parseTodos(ics));
  if (!t) throw new Error("kein VTODO");
  return t;
}

describe("applyTodoMutation", () => {
  it("setzt den Titel und bumpt SEQUENCE", () => {
    const out = applyTodoMutation(BASIS, { kind: "summary", summary: "Steuer fertig machen" }, { now: NOW });
    expect(todoAus(out).summary).toBe("Steuer fertig machen");
    expect(out).toContain("SEQUENCE:4");
  });

  it("aktualisiert LAST-MODIFIED und DTSTAMP", () => {
    const out = applyTodoMutation(BASIS, { kind: "summary", summary: "X" }, { now: NOW });
    expect(out).toContain("LAST-MODIFIED:20260905T100000Z");
    expect(out).toContain("DTSTAMP:20260905T100000Z");
  });

  it("setzt bei STATUS:COMPLETED auch COMPLETED und PERCENT-COMPLETE", () => {
    // Die Nebenwirkung gehoert in die Mutation, nicht in den Aufrufer — sonst entstehen
    // widerspruechliche Zustaende (erledigt ohne Abschlusszeitpunkt).
    const out = applyTodoMutation(BASIS, { kind: "status", status: "COMPLETED" }, { now: NOW });
    expect(out).toContain("STATUS:COMPLETED");
    expect(out).toContain("COMPLETED:20260905T100000Z");
    expect(out).toContain("PERCENT-COMPLETE:100");
  });

  it("entfernt COMPLETED beim Weg von COMPLETED", () => {
    const erledigt = applyTodoMutation(BASIS, { kind: "status", status: "COMPLETED" }, { now: NOW });
    const wieder = applyTodoMutation(erledigt, { kind: "status", status: "NEEDS-ACTION" }, { now: NOW });
    expect(wieder).toContain("STATUS:NEEDS-ACTION");
    expect(wieder).not.toContain("COMPLETED:2026");
    expect(wieder).not.toContain("PERCENT-COMPLETE:100");
  });

  it("setzt CANCELLED ohne COMPLETED-Zeitstempel", () => {
    // CANCELLED ist kein Abschluss im Sinne von COMPLETED (RFC 5545 3.8.1.1).
    const out = applyTodoMutation(BASIS, { kind: "status", status: "CANCELLED" }, { now: NOW });
    expect(out).toContain("STATUS:CANCELLED");
    expect(out).not.toContain("COMPLETED:2026");
  });

  it("setzt und entfernt DUE", () => {
    const gesetzt = applyTodoMutation(BASIS, { kind: "due", due: "2026-10-07" }, { now: NOW });
    expect(todoAus(gesetzt).due).toContain("2026-10-07");
    const weg = applyTodoMutation(BASIS, { kind: "due", due: null }, { now: NOW });
    expect(todoAus(weg).due).toBeUndefined();
  });

  it("entfernt PRIORITY bei null", () => {
    const mit = applyTodoMutation(BASIS, { kind: "priority", priority: 1 }, { now: NOW });
    expect(mit).toContain("PRIORITY:1");
    const ohne = applyTodoMutation(mit, { kind: "priority", priority: null }, { now: NOW });
    expect(ohne).not.toContain("PRIORITY:");
  });

  it("wirft bei einem ICS ohne VTODO", () => {
    const nurEvent = BASIS.replace(/VTODO/g, "VEVENT");
    expect(() => applyTodoMutation(nurEvent, { kind: "summary", summary: "X" }, { now: NOW })).toThrow(/VTODO/);
  });
});

describe("newTodoIcs", () => {
  it("erzeugt ein gueltiges VCALENDAR mit VTODO und SEQUENCE 0", () => {
    const ics = newTodoIcs({ uid: "neu-1@cn", summary: "Rueckruf Werkstatt", due: "2026-10-01" }, { now: NOW });
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toContain("UID:neu-1@cn");
    expect(ics).toContain("SEQUENCE:0");
    const t = todoAus(ics);
    expect(t.summary).toBe("Rueckruf Werkstatt");
    expect(t.due).toContain("2026-10-01");
  });

  it("laesst weg, was nicht angegeben ist", () => {
    const ics = newTodoIcs({ uid: "neu-2@cn", summary: "Ohne alles" }, { now: NOW });
    expect(ics).not.toContain("DUE");
    expect(ics).not.toContain("PRIORITY");
  });

  it("faellt ohne Status auf NEEDS-ACTION zurueck", () => {
    const ics = newTodoIcs({ uid: "neu-3@cn", summary: "Ohne Status" }, { now: NOW });
    expect(ics).toContain("STATUS:NEEDS-ACTION");
  });
});
