import { describe, it, expect } from "vitest";
import { suggestStatusMap, suggestPriorityMap } from "../../../src/core/mirror/tasknotes-map";

const S = (value: string, isCompleted: boolean, order: number) => ({ value, isCompleted, order });

describe("suggestStatusMap", () => {
  it("bildet die gemessene Standardkonfiguration ab", () => {
    const r = suggestStatusMap([S("open", false, 1), S("in-progress", false, 2), S("done", true, 3)]);
    expect(r!.map).toEqual({ needsAction: "open", inProcess: "in-progress", completed: "done", cancelled: "done" });
  });

  it("waehlt nach order, nicht nach Namensgleichheit", () => {
    const r = suggestStatusMap([S("erledigt", true, 9), S("angefangen", false, 5), S("neu", false, 1)]);
    expect(r!.map).toEqual({ needsAction: "neu", inProcess: "angefangen", completed: "erledigt", cancelled: "erledigt" });
  });

  it("nutzt bei zwei abgeschlossenen Status den groessten order fuer cancelled", () => {
    const r = suggestStatusMap([S("open", false, 1), S("done", true, 2), S("abgebrochen", true, 3)]);
    expect(r!.map.completed).toBe("done");
    expect(r!.map.cancelled).toBe("abgebrochen");
    expect(r!.warnings).not.toContain("cancelled-collides-with-completed");
  });

  it("warnt, wenn COMPLETED und CANCELLED zusammenfallen", () => {
    const r = suggestStatusMap([S("open", false, 1), S("done", true, 2)]);
    expect(r!.map.completed).toBe(r!.map.cancelled);
    expect(r!.warnings).toContain("cancelled-collides-with-completed");
  });

  it("faellt fuer IN-PROCESS auf NEEDS-ACTION zurueck, wenn es nur einen offenen Status gibt", () => {
    const r = suggestStatusMap([S("offen", false, 1), S("fertig", true, 2)]);
    expect(r!.map.inProcess).toBe("offen");
    expect(r!.warnings).toContain("single-open-status");
  });

  it("gibt undefined zurueck, wenn gar kein abgeschlossener Status existiert", () => {
    const r = suggestStatusMap([S("a", false, 1), S("b", false, 2)]);
    expect(r).toBeUndefined();
  });

  it("gibt undefined zurueck, wenn gar kein offener Status existiert", () => {
    expect(suggestStatusMap([S("done", true, 1)])).toBeUndefined();
  });

  it("gibt undefined zurueck bei leerer Liste", () => {
    expect(suggestStatusMap([])).toBeUndefined();
  });
});

describe("suggestPriorityMap", () => {
  it("verteilt drei Stufen auf hoch/normal/niedrig nach order", () => {
    const r = suggestPriorityMap([{ value: "low", order: 1 }, { value: "normal", order: 2 }, { value: "high", order: 3 }]);
    expect(r!.map).toEqual({ high: "high", normal: "normal", low: "low" });
  });

  it("kommt mit mehr als drei Stufen aus: Extreme aussen, Mitte in der Mitte", () => {
    const r = suggestPriorityMap([{ value: "p1", order: 1 }, { value: "p2", order: 2 }, { value: "p3", order: 3 }, { value: "p4", order: 4 }, { value: "p5", order: 5 }]);
    expect(r!.map).toEqual({ high: "p5", normal: "p3", low: "p1" });
  });

  it("kommt mit einer einzigen Stufe aus", () => {
    const r = suggestPriorityMap([{ value: "nur-eine", order: 1 }]);
    expect(r!.map).toEqual({ high: "nur-eine", normal: "nur-eine", low: "nur-eine" });
  });

  it("gibt undefined zurueck bei leerer Liste", () => {
    expect(suggestPriorityMap([])).toBeUndefined();
  });
});
