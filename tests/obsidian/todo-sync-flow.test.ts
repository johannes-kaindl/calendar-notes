import { describe, it, expect, vi } from "vitest";
import { planlisteAus } from "../../src/obsidian/command-flow";
import type { TodoSyncAuswahl } from "../../src/obsidian/todo-sync-modal";

// Getestet wird die pure Umsetzung Auswahl -> Plaene, nicht das DOM.
describe("planlisteAus", () => {
  it("macht aus 'vault' bei einer bestehenden Aufgabe einen Hand-Edit-Plan", () => {
    const bauHandEdit = vi.fn().mockReturnValue({ commandId: "push-hand-edits" });
    const bauCreate = vi.fn();
    const a: TodoSyncAuswahl[] = [{
      note: { note: { path: "Tasks/A.md", frontmatter: {}, prevWritten: {}, uid: "u1" }, group: "vault-only", changedKeys: ["status"] },
      entscheidung: "vault",
    }];
    const r = planlisteAus(a, bauHandEdit, bauCreate);
    expect(bauHandEdit).toHaveBeenCalledTimes(1);
    expect(bauCreate).not.toHaveBeenCalled();
    expect(r.plaene).toHaveLength(1);
  });

  it("macht aus 'vault' bei einer neuen Aufgabe einen Create-Plan", () => {
    const bauHandEdit = vi.fn();
    const bauCreate = vi.fn().mockReturnValue({ commandId: "todo.create" });
    const a: TodoSyncAuswahl[] = [{
      note: { note: { path: "Tasks/B.md", frontmatter: {}, prevWritten: {} }, group: "new", changedKeys: [] },
      entscheidung: "vault",
    }];
    const r = planlisteAus(a, bauHandEdit, bauCreate);
    expect(bauCreate).toHaveBeenCalledTimes(1);
    expect(bauHandEdit).not.toHaveBeenCalled();
    expect(r.plaene).toHaveLength(1);
  });

  it("erzeugt fuer 'server' KEINEN Plan, sondern eine Resync-Aufgabe", () => {
    // "Server gewinnt" schreibt nicht nach DAV — es holt den Serverstand in die Notiz.
    const a: TodoSyncAuswahl[] = [{
      note: { note: { path: "Tasks/C.md", frontmatter: {}, prevWritten: {}, uid: "u3", href: "/dav/e.ics", collectionId: "c1" }, group: "conflict", changedKeys: ["status"] },
      entscheidung: "server",
    }];
    const r = planlisteAus(a, vi.fn(), vi.fn());
    expect(r.plaene).toHaveLength(0);
    expect(r.resync).toEqual([{ collectionId: "c1", href: "/dav/e.ics" }]);
  });

  it("laesst eine Zeile weg, fuer die kein Plan gebaut werden konnte", () => {
    // Ein Bauer darf `null` liefern (fehlende Rohdaten, kein Kontext, nichts zu aendern).
    // Das ist kein Fehler, aber es darf auch kein `null` in die Ausfuehrung wandern.
    const a: TodoSyncAuswahl[] = [{
      note: { note: { path: "Tasks/D.md", frontmatter: {}, prevWritten: {}, uid: "u4" }, group: "vault-only", changedKeys: ["status"] },
      entscheidung: "vault",
    }];
    const r = planlisteAus(a, () => null, () => null);
    expect(r.plaene).toEqual([]);
    expect(r.resync).toEqual([]);
  });

  it("ueberspringt 'server' ohne href oder collectionId, statt einen halben Resync zu bauen", () => {
    // Eine neue, nie gespiegelte Aufgabe hat beides nicht. `resyncObject` braucht beides —
    // ein Eintrag mit leerem href wuerde erst zur Laufzeit auffallen.
    const a: TodoSyncAuswahl[] = [{
      note: { note: { path: "Tasks/E.md", frontmatter: {}, prevWritten: {} }, group: "new", changedKeys: [] },
      entscheidung: "server",
    }];
    expect(planlisteAus(a, vi.fn(), vi.fn())).toEqual({ plaene: [], resync: [] });
  });
});
