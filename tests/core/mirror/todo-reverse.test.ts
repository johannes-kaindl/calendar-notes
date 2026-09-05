import { describe, it, expect } from "vitest";
import { reverseStatus, reversePriority } from "../../../src/core/mirror/todo-reverse";
import { defaultTodoProfile } from "../../../src/core/mirror/profile";

const P = defaultTodoProfile(); // statusMap: completed und cancelled zeigen BEIDE auf "done"

describe("reverseStatus", () => {
  it("bewahrt CANCELLED, wenn der Frontmatter-Wert weiter dazu passt", () => {
    // Der Kern: "done" bildet auf COMPLETED UND CANCELLED ab. Der Nutzer hat nichts
    // geaendert, also darf sich der Serverzustand nicht bewegen.
    expect(reverseStatus(P, "CANCELLED", "done")).toBeUndefined();
  });

  it("bewahrt COMPLETED ebenso", () => {
    expect(reverseStatus(P, "COMPLETED", "done")).toBeUndefined();
  });

  it("erkennt den echten Wechsel offen -> erledigt", () => {
    expect(reverseStatus(P, "NEEDS-ACTION", "done")).toBe("COMPLETED");
  });

  it("erkennt den echten Wechsel erledigt -> offen", () => {
    expect(reverseStatus(P, "COMPLETED", "open")).toBe("NEEDS-ACTION");
  });

  it("loest die Kollision zugunsten von COMPLETED auf", () => {
    // Bei echtem Wechsel auf einen Wert, den zwei Zustaende bedienen, gewinnt der
    // haeufigere: abhaken ist der Normalfall, abbrechen die bewusste Ausnahme.
    expect(reverseStatus(P, "IN-PROCESS", "done")).toBe("COMPLETED");
  });

  it("behandelt fehlendes STATUS auf dem Server als NEEDS-ACTION", () => {
    expect(reverseStatus(P, undefined, "open")).toBeUndefined(); // bildet bereits auf "open" ab
    expect(reverseStatus(P, undefined, "done")).toBe("COMPLETED");
  });

  it("gibt undefined bei einem Wert, den die Abbildung nicht kennt", () => {
    expect(reverseStatus(P, "NEEDS-ACTION", "voellig-fremd")).toBeUndefined();
  });

  it("gibt undefined ohne statusMap im Profil", () => {
    expect(reverseStatus({ ...P, statusMap: undefined }, "NEEDS-ACTION", "done")).toBeUndefined();
  });
});

describe("reversePriority", () => {
  it("bewahrt den genauen Zahlenwert, solange er weiter passt", () => {
    // 2 bildet auf "high" ab; "high" bleibt -> die 2 darf nicht auf den Repraesentanten 1 springen.
    expect(reversePriority(P, 2, "high")).toBeUndefined();
  });

  it("setzt den Repraesentanten bei echtem Wechsel", () => {
    expect(reversePriority(P, 2, "low")).toBe(9);
    expect(reversePriority(P, 9, "normal")).toBe(5);
    expect(reversePriority(P, 5, "high")).toBe(1);
  });

  it("entfernt die Property bei einem Wert ausserhalb der Abbildung", () => {
    expect(reversePriority(P, 5, "none")).toBeNull();
    expect(reversePriority(P, 5, undefined)).toBeNull();
  });

  it("laesst eine fehlende Prioritaet fehlen, wenn nichts gesetzt wird", () => {
    expect(reversePriority(P, undefined, "none")).toBeUndefined();
  });

  it("gibt undefined ohne priorityMap im Profil", () => {
    expect(reversePriority({ ...P, priorityMap: undefined }, 5, "high")).toBeUndefined();
  });
});
