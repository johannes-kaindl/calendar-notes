import { describe, it, expect } from "vitest";
import { todoValues, todoInWindow } from "../../../src/core/mirror/todo-values";
import { parseTodos } from "../../../src/core/ical/todo";
import { defaultTodoProfile } from "../../../src/core/mirror/profile";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fx = (n: string): string => readFileSync(join(__dirname, "../../fixtures/ical", n), "utf8");
const P = defaultTodoProfile();

describe("todoValues", () => {
  it("bildet STATUS ueber die statusMap ab, nicht ueber den Rohwert", () => {
    const v = todoValues(parseTodos(fx("todo-simple.ics"))[0]!, P);
    expect(v["status"]).toBe("in-progress");
    expect(v["status"]).not.toBe("IN-PROCESS");
  });

  it("bildet PRIORITY nach RFC 5545 auf die priorityMap ab", () => {
    const hoch = todoValues({ uid: "a", summary: "s", allDay: false, categories: [], sequence: 0, priority: 2 }, P);
    const normal = todoValues({ uid: "b", summary: "s", allDay: false, categories: [], sequence: 0, priority: 5 }, P);
    const niedrig = todoValues({ uid: "c", summary: "s", allDay: false, categories: [], sequence: 0, priority: 8 }, P);
    expect([hoch["priority"], normal["priority"], niedrig["priority"]]).toEqual(["high", "normal", "low"]);
  });

  it("PRIORITY 0 und fehlende PRIORITY schreiben nichts", () => {
    expect(todoValues({ uid: "a", summary: "s", allDay: false, categories: [], sequence: 0, priority: 0 }, P)["priority"]).toBeUndefined();
    expect(todoValues({ uid: "a", summary: "s", allDay: false, categories: [], sequence: 0 }, P)["priority"]).toBeUndefined();
  });

  it("COMPLETED und CANCELLED laufen beide in den abgeschlossenen Statuswert", () => {
    expect(todoValues(parseTodos(fx("todo-done.ics"))[0]!, P)["status"]).toBe("done");
    expect(todoValues({ uid: "x", summary: "s", allDay: false, categories: [], sequence: 0, status: "CANCELLED" }, P)["status"]).toBe("done");
  });

  it("ohne statusMap wird kein Status geschrieben statt einer geratenen Vokabel", () => {
    const ohne = { ...P };
    delete ohne.statusMap;
    expect(todoValues(parseTodos(fx("todo-simple.ics"))[0]!, ohne)["status"]).toBeUndefined();
  });
});

describe("todoInWindow", () => {
  const w = { start: new Date("2026-06-01T00:00:00Z"), end: new Date("2027-06-01T00:00:00Z") };

  it("eine offene Aufgabe liegt immer im Fenster, auch ohne jedes Datum", () => {
    expect(todoInWindow(parseTodos(fx("todo-minimal.ics"))[0]!, w)).toBe(true);
  });

  it("eine kuerzlich erledigte Aufgabe liegt im Fenster", () => {
    expect(todoInWindow(parseTodos(fx("todo-done.ics"))[0]!, w)).toBe(true);
  });

  it("eine lange erledigte Aufgabe liegt ausserhalb", () => {
    const alt = { ...parseTodos(fx("todo-done.ics"))[0]!, completed: "2020-01-01T00:00:00Z" };
    expect(todoInWindow(alt, w)).toBe(false);
  });

  it("faellt auf LAST-MODIFIED zurueck, wenn COMPLETED fehlt", () => {
    const t = { uid: "x", summary: "s", allDay: false, categories: [], sequence: 0, status: "COMPLETED", lastModified: "2020-01-01T00:00:00Z" };
    expect(todoInWindow(t, w)).toBe(false);
  });

  it("erledigt ohne jedes Datum wird gespiegelt statt archiviert", () => {
    const t = { uid: "x", summary: "s", allDay: false, categories: [], sequence: 0, status: "COMPLETED" };
    expect(todoInWindow(t, w)).toBe(true);
  });
});
