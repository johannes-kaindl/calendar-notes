import { describe, it, expect } from "vitest";
import { suggestStatusMap, suggestPriorityMap } from "../../../src/core/mirror/tasknotes-map";

const S = (value: string, isCompleted: boolean, order: number) => ({ value, isCompleted, order });
const P = (value: string, weight: number) => ({ value, weight });

// Gemessene Standardkonfiguration (docs/tasknotes-api.md): ein `none`-Eintrag pro Liste, der
// *nicht gesetzt* bedeutet, kein Arbeitszustand — und ohne `defaults` faelschlich gewaehlt wuerde.
const STANDARD_STATUSES = [S("none", false, 0), S("open", false, 1), S("in-progress", false, 2), S("done", true, 3)];
const STANDARD_PRIORITIES = [P("none", 0), P("low", 1), P("normal", 2), P("high", 3)];
const STANDARD_DEFAULTS = { status: "open", priority: "normal" };

describe("suggestStatusMap", () => {
  it("bildet die gemessene Standardkonfiguration ab und ueberspringt none", () => {
    const r = suggestStatusMap(STANDARD_STATUSES, STANDARD_DEFAULTS);
    expect(r!.map).toEqual({ needsAction: "open", inProcess: "in-progress", completed: "done", cancelled: "done" });
    // Die gemessene Standardkonfiguration hat nur EINEN abgeschlossenen Status — completed und
    // cancelled fallen deshalb zusammen, das ist hier kein Fehler in der Regel, sondern die Lage.
    expect(r!.warnings).toEqual(["cancelled-collides-with-completed"]);
  });

  it("waehlt needsAction ueber defaults.status, nicht ueber Namensgleichheit oder kleinste order", () => {
    const r = suggestStatusMap(
      [S("erledigt", true, 9), S("angefangen", false, 5), S("neu", false, 1)],
      { status: "angefangen", priority: "x" },
    );
    expect(r!.map.needsAction).toBe("angefangen");
    // "neu" hat die kleinere order, liegt aber UNTER dem Default und wird nicht inProcess.
    expect(r!.map.inProcess).toBe("angefangen");
    expect(r!.warnings).toContain("single-open-status");
  });

  it("faellt auf die kleinste order unter den offenen zurueck, wenn defaults.status fehlt, und warnt", () => {
    const r = suggestStatusMap([S("open", false, 1), S("in-progress", false, 2), S("done", true, 3)], { status: "unbekannt", priority: "x" });
    expect(r!.map.needsAction).toBe("open");
    expect(r!.warnings).toContain("default-status-unknown");
  });

  it("faellt zurueck und warnt, wenn defaults.status auf einen abgeschlossenen Status zeigt", () => {
    const r = suggestStatusMap([S("open", false, 1), S("done", true, 2)], { status: "done", priority: "x" });
    expect(r!.map.needsAction).toBe("open");
    expect(r!.warnings).toContain("default-status-unknown");
  });

  it("inProcess ist der naechste offene oberhalb von needsAction, nicht der naechste ueberhaupt", () => {
    const r = suggestStatusMap(
      [S("none", false, 0), S("open", false, 1), S("in-progress", false, 2), S("done", true, 3)],
      { status: "open", priority: "x" },
    );
    expect(r!.map.inProcess).toBe("in-progress");
  });

  it("nutzt bei zwei abgeschlossenen Status den groessten order fuer cancelled", () => {
    const r = suggestStatusMap([S("open", false, 1), S("done", true, 2), S("abgebrochen", true, 3)], STANDARD_DEFAULTS);
    expect(r!.map.completed).toBe("done");
    expect(r!.map.cancelled).toBe("abgebrochen");
    expect(r!.warnings).not.toContain("cancelled-collides-with-completed");
  });

  it("warnt, wenn COMPLETED und CANCELLED zusammenfallen", () => {
    const r = suggestStatusMap([S("open", false, 1), S("done", true, 2)], STANDARD_DEFAULTS);
    expect(r!.map.completed).toBe(r!.map.cancelled);
    expect(r!.warnings).toContain("cancelled-collides-with-completed");
  });

  it("faellt fuer IN-PROCESS auf NEEDS-ACTION zurueck, wenn es nur einen offenen Status gibt, und warnt", () => {
    const r = suggestStatusMap([S("offen", false, 1), S("fertig", true, 2)], { status: "offen", priority: "x" });
    expect(r!.map.inProcess).toBe("offen");
    expect(r!.warnings).toContain("single-open-status");
  });

  it("gibt undefined zurueck, wenn gar kein abgeschlossener Status existiert", () => {
    const r = suggestStatusMap([S("a", false, 1), S("b", false, 2)], STANDARD_DEFAULTS);
    expect(r).toBeUndefined();
  });

  it("gibt undefined zurueck, wenn gar kein offener Status existiert", () => {
    expect(suggestStatusMap([S("done", true, 1)], STANDARD_DEFAULTS)).toBeUndefined();
  });

  it("gibt undefined zurueck bei leerer Liste", () => {
    expect(suggestStatusMap([], STANDARD_DEFAULTS)).toBeUndefined();
  });
});

describe("suggestPriorityMap", () => {
  it("bildet die gemessene Standardkonfiguration ab und ueberspringt none", () => {
    const r = suggestPriorityMap(STANDARD_PRIORITIES, STANDARD_DEFAULTS);
    expect(r!.map).toEqual({ high: "high", normal: "normal", low: "low" });
    expect(r!.warnings).toEqual([]);
  });

  it("waehlt normal ueber defaults.priority, low/high als naechste Nachbarn nach weight", () => {
    const r = suggestPriorityMap([P("p1", 1), P("p2", 2), P("p3", 3), P("p4", 4), P("p5", 5)], { status: "x", priority: "p3" });
    expect(r!.map).toEqual({ high: "p4", normal: "p3", low: "p2" });
  });

  it("faellt auf den mittleren weight zurueck und warnt, wenn defaults.priority fehlt", () => {
    const r = suggestPriorityMap([P("low", 1), P("normal", 2), P("high", 3)], { status: "x", priority: "unbekannt" });
    expect(r!.map.normal).toBe("normal");
    expect(r!.warnings).toContain("default-priority-unknown");
  });

  it("low faellt auf normal zurueck, wenn nichts unterhalb liegt", () => {
    const r = suggestPriorityMap([P("normal", 2), P("high", 3)], { status: "x", priority: "normal" });
    expect(r!.map).toEqual({ high: "high", normal: "normal", low: "normal" });
  });

  it("high faellt auf normal zurueck, wenn nichts oberhalb liegt", () => {
    const r = suggestPriorityMap([P("low", 1), P("normal", 2)], { status: "x", priority: "normal" });
    expect(r!.map).toEqual({ high: "normal", normal: "normal", low: "low" });
  });

  it("kommt mit einer einzigen Stufe aus", () => {
    const r = suggestPriorityMap([P("nur-eine", 1)], { status: "x", priority: "nur-eine" });
    expect(r!.map).toEqual({ high: "nur-eine", normal: "nur-eine", low: "nur-eine" });
    expect(r!.warnings).toEqual([]);
  });

  it("gibt undefined zurueck bei leerer Liste", () => {
    expect(suggestPriorityMap([], STANDARD_DEFAULTS)).toBeUndefined();
  });
});
