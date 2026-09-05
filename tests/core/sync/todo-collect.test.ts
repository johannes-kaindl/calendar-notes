import { describe, it, expect } from "vitest";
import { classifyTodos, type TodoNoteState } from "../../../src/core/sync/todo-collect";

/** Schluessel-Vertrag: `serverEtags` ist auf href-PFADE verschluesselt, nicht auf volle URLs —
 *  so liefert es `listEtags` (dav/sync.ts). Hier stehen beide Seiten auf demselben Wert; die
 *  Normalisierung stellt der Adapter her, nicht diese Funktion. */
const H = "/cal/todo/t1.ics";

function note(over: Partial<TodoNoteState> = {}): TodoNoteState {
  return {
    path: "Tasks/Steuer.md",
    frontmatter: { status: "done" },
    prevWritten: { status: "open" },
    uid: "t1@test", href: H, etag: '"e1"', collectionId: "c1",
    ...over,
  };
}

describe("classifyTodos", () => {
  it("erkennt eine nur im Vault geaenderte Aufgabe", () => {
    const r = classifyTodos([note()], new Map([[H, '"e1"']]));
    expect(r).toHaveLength(1);
    expect(r[0]?.group).toBe("vault-only");
    expect(r[0]?.changedKeys).toEqual(["status"]);
  });

  it("erkennt eine im Vault neu entstandene Aufgabe an der fehlenden uid", () => {
    const r = classifyTodos([note({ uid: undefined, href: undefined, etag: undefined })], new Map());
    expect(r[0]?.group).toBe("new");
  });

  it("erkennt den Konflikt: ETag veraltet UND Frontmatter geaendert", () => {
    const r = classifyTodos([note()], new Map([[H, '"e2"']]));
    expect(r[0]?.group).toBe("conflict");
    expect(r[0]?.serverEtag).toBe('"e2"');
  });

  it("laesst eine unveraenderte Notiz ganz weg", () => {
    const r = classifyTodos([note({ frontmatter: { status: "open" } })], new Map([[H, '"e1"']]));
    expect(r).toHaveLength(0);
  });

  it("laesst eine NUR serverseitig geaenderte Notiz weg — das erledigt der normale Sync", () => {
    const r = classifyTodos([note({ frontmatter: { status: "open" } })], new Map([[H, '"e2"']]));
    expect(r).toHaveLength(0);
  });

  it("behandelt eine Notiz als Konflikt, wenn der Server sie gar nicht mehr fuehrt", () => {
    // Kein ETag in der Serverliste, aber die Notiz kennt eine uid: die Ressource ist weg
    // oder ausserhalb des Fensters. Nicht stillschweigend hochladen.
    const r = classifyTodos([note()], new Map());
    expect(r[0]?.group).toBe("conflict");
    expect(r[0]?.serverEtag).toBeUndefined();
  });

  it("ist auch dann ein Konflikt, wenn WEDER Notiz NOCH Server ein ETag haben", () => {
    // Traegt die Bedingung `serverEtag !== undefined`: ohne sie waere hier
    // `undefined === undefined` wahr und die Notiz liefe als "nur im Vault geaendert"
    // durch — es wuerde blind ueber einen unbekannten Serverstand geschrieben.
    const r = classifyTodos([note({ etag: undefined })], new Map());
    expect(r[0]?.group).toBe("conflict");
  });

  it("meldet mehrere geaenderte Schluessel", () => {
    const n = note({ frontmatter: { status: "done", title: "Neu" }, prevWritten: { status: "open", title: "Alt" } });
    const r = classifyTodos([n], new Map([[H, '"e1"']]));
    expect(r[0]?.changedKeys.sort()).toEqual(["status", "title"]);
  });

  it("nimmt eine neue Notiz auch dann auf, wenn sie nichts Geschriebenes hat", () => {
    // Eine frisch in TaskNotes angelegte Aufgabe hat kein `prevWritten` — sie ist trotzdem
    // der Hauptfall der Gruppe "neu", nicht ein Sonderfall.
    const r = classifyTodos([note({ uid: undefined, href: undefined, etag: undefined, prevWritten: {} })], new Map());
    expect(r).toHaveLength(1);
    expect(r[0]?.group).toBe("new");
  });
});
