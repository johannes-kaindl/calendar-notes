import { describe, it, expect } from "vitest";
import { vorbelegung, gewaehlte, type Entscheidung } from "../../src/obsidian/todo-sync-modal";
import type { ClassifiedTodo } from "../../src/core/sync/todo-collect";

function c(group: ClassifiedTodo["group"], path = "Tasks/X.md"): ClassifiedTodo {
  return { note: { path, frontmatter: {}, prevWritten: {} }, group, changedKeys: [] };
}

describe("vorbelegung", () => {
  it("hakt an, was der Nutzer erkennbar gewollt hat", () => {
    expect(vorbelegung(c("vault-only"))).toBe("vault");
    expect(vorbelegung(c("new"))).toBe("vault");
  });

  it("entscheidet einen Konflikt NICHT vor", () => {
    // Ein Konflikt ist kein Wunsch, sondern eine Lage — dort hat noch niemand entschieden.
    // "server" waere besonders falsch: es verwirft Nutzerarbeit.
    expect(vorbelegung(c("conflict"))).toBe("skip");
  });
});

describe("gewaehlte", () => {
  const eintraege = [c("vault-only", "Tasks/A.md"), c("new", "Tasks/B.md"), c("conflict", "Tasks/C.md")];

  it("laesst uebersprungene Zeilen weg und haengt die Entscheidung an", () => {
    const auswahl = new Map<string, Entscheidung>([
      ["Tasks/A.md", "vault"], ["Tasks/B.md", "skip"], ["Tasks/C.md", "server"],
    ]);
    expect(gewaehlte(eintraege, auswahl).map((a) => [a.note.note.path, a.entscheidung]))
      .toEqual([["Tasks/A.md", "vault"], ["Tasks/C.md", "server"]]);
  });

  it("behandelt eine fehlende Entscheidung als 'ueberspringen'", () => {
    // Sicherheitsrichtung: was die Karte nicht kennt, wird nicht gesendet.
    expect(gewaehlte(eintraege, new Map())).toEqual([]);
  });

  it("ist die Quelle der Zahl im Senden-Knopf", () => {
    // Deshalb pur und exportiert: der Knopf muss sie nach JEDER Auswahlaenderung neu ziehen,
    // sonst zeigt er die Zahl vom Aufbau des Modals.
    const auswahl = new Map<string, Entscheidung>([["Tasks/A.md", "vault"]]);
    expect(gewaehlte(eintraege, auswahl)).toHaveLength(1);
    auswahl.set("Tasks/B.md", "vault");
    expect(gewaehlte(eintraege, auswahl)).toHaveLength(2);
  });
});
