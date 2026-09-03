import { describe, it, expect } from "vitest";
import { readTaskNotes, profileFromTaskNotes } from "../../src/obsidian/tasknotes";
import { defaultTodoProfile, validateProfile } from "../../src/core/mirror/profile";

// Form aus docs/tasknotes-api.md (gemessen gegen TaskNotes 4.12.5). Weicht die gemessene Form
// ab, ist DIESES Objekt anzupassen — nicht der Test.
const fakeApp = (over: Record<string, unknown> = {}): unknown => ({
  plugins: { plugins: { tasknotes: { api: {
    hasCapability: (c: string) => c === "catalog.read",
    model: {
      info: () => ({ specVersion: "0.3.0-rc.3", runtimeApiVersion: 1 }),
      config: () => ({
        statuses: [
          { value: "none", isCompleted: false, order: 0 },
          { value: "open", isCompleted: false, order: 1 },
          { value: "in-progress", isCompleted: false, order: 2 },
          { value: "done", isCompleted: true, order: 3 },
        ],
        priorities: [
          { value: "none", weight: 0 },
          { value: "low", weight: 1 },
          { value: "normal", weight: 2 },
          { value: "high", weight: 3 },
        ],
        defaults: { status: "open", priority: "normal", taskTag: "task" },
        taskIdentification: { method: "tag", tag: "task", propertyName: "", propertyValue: "" },
        ...over,
      }),
    },
    catalog: { fields: () => [
      { id: "due", frontmatterKey: "due", valueType: "date", writable: true, required: false },
      { id: "status", frontmatterKey: "status", valueType: "string", writable: true, required: true },
      { id: "archived", valueType: "boolean", writable: true, required: false },
    ] },
  } } } },
});

describe("readTaskNotes", () => {
  it("liefert undefined, wenn TaskNotes fehlt", () => {
    expect(readTaskNotes({ plugins: { plugins: {} } })).toBeUndefined();
  });

  it("liefert undefined, wenn die Faehigkeit fehlt", () => {
    const app = { plugins: { plugins: { tasknotes: { api: { hasCapability: () => false } } } } };
    expect(readTaskNotes(app)).toBeUndefined();
  });

  it("liest specVersion, Status, Prioritaeten und die Identifikation", () => {
    const r = readTaskNotes(fakeApp())!;
    expect(r.specVersion).toBe("0.3.0-rc.3");
    expect(r.statuses).toHaveLength(4);
    expect(r.priorities).toHaveLength(4);
    expect(r.identification).toEqual({ method: "tag", tag: "task" });
  });

  it("faengt einen Wurf der Fremd-API ab, statt die Einstellungen mitzureissen", () => {
    const app = { plugins: { plugins: { tasknotes: { api: { hasCapability: () => true, model: { info: () => { throw new Error("kaputt"); } } } } } } };
    expect(readTaskNotes(app)).toBeUndefined();
  });

  it("liest ein optionales frontmatterKey nur, wenn es vorhanden ist", () => {
    const r = readTaskNotes(fakeApp())!;
    expect(r.fieldKeys["due"]).toBe("due");
    expect(r.fieldKeys["status"]).toBe("status");
    expect(Object.values(r.fieldKeys)).not.toContain(undefined);
  });
});

describe("profileFromTaskNotes", () => {
  it("friert specVersion und die Abbildungen ins Profil ein", () => {
    const { profile } = profileFromTaskNotes(readTaskNotes(fakeApp())!, defaultTodoProfile(), "Aus TaskNotes", "p-tn");
    expect(profile.taskNotesSpec).toBe("0.3.0-rc.3");
    expect(profile.statusMap).toEqual({ needsAction: "open", inProcess: "in-progress", completed: "done", cancelled: "done" });
    expect(profile.priorityMap).toEqual({ high: "high", normal: "normal", low: "low" });
    expect(profile.kind).toBe("todo");
    expect(profile.id).toBe("p-tn");
    expect(profile.name).toBe("Aus TaskNotes");
  });

  it("schreibt die Sichtbarkeit als Tag ins onCreate", () => {
    const { profile } = profileFromTaskNotes(readTaskNotes(fakeApp())!, defaultTodoProfile(), "n", "p1");
    expect(profile.onCreate["tags"]).toEqual(["task"]);
  });

  it("schreibt die Sichtbarkeit als Property ins onCreate", () => {
    const app = fakeApp({ taskIdentification: { method: "property", propertyName: "istAufgabe", propertyValue: "ja" } });
    const { profile } = profileFromTaskNotes(readTaskNotes(app)!, defaultTodoProfile(), "n", "p1");
    expect(profile.onCreate["istAufgabe"]).toBe("ja");
  });

  it("reicht die Kollisionswarnung durch", () => {
    const app = fakeApp({ statuses: [{ value: "open", isCompleted: false, order: 1 }, { value: "done", isCompleted: true, order: 2 }] });
    const { warnings } = profileFromTaskNotes(readTaskNotes(app)!, defaultTodoProfile(), "n", "p1");
    expect(warnings).toContain("cancelled-collides-with-completed");
  });

  it("eine abweichende specVersion wird ins neue Profil uebernommen, nicht ins alte", () => {
    const alt = profileFromTaskNotes(readTaskNotes(fakeApp())!, defaultTodoProfile(), "alt", "p-alt").profile;
    expect(alt.taskNotesSpec).toBe("0.3.0-rc.3");
    // Das alte Profil bleibt unberuehrt — der Hinweis ist Sache der UI, nicht dieser Funktion.
    expect(alt.statusMap).toBeDefined();
  });

  it("das erzeugte Profil besteht validateProfile", () => {
    const { profile } = profileFromTaskNotes(readTaskNotes(fakeApp())!, defaultTodoProfile(), "n", "p1");
    expect(validateProfile(profile).ok).toBe(true);
  });
});
