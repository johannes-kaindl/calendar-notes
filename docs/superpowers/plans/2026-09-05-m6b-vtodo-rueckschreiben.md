# M6b — Aufgaben zurückschreiben (Vault → Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Änderungen an Aufgaben-Notizen und im Vault neu entstandene Aufgaben gelangen über ein Sammel-Kommando mit Auswahl auf den CalDAV-Server.

**Architecture:** Kein neuer DAV-Code — `putObject` beherrscht `If-Match` und `If-None-Match` bereits, `plan.createsNew` wählt den Header. Neu sind: die Statusabbildung **rückwärts** (mehrdeutig, deshalb bewahrend statt umkehrend), eine VTODO-Mutation als Geschwister zur VEVENT-Mutation, ein Sammler, der Vault- und Serverstand in drei Gruppen klassifiziert, und ein Modal, das die Adoptions-Grammatik mit der Diff-Darstellung kreuzt.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), `ical.js`, vitest, esbuild, Obsidian Plugin API 1.13, Radicale (Integrationstest).

**Spec:** `docs/superpowers/specs/2026-09-05-m6b-vtodo-rueckschreiben-design.md` (Anschluss an `2026-09-02-vtodo-aufgaben-design.md`)

## Global Constraints

- `src/core/**` ist obsidian-, DOM- und node-frei. Geprüft von `npm run check:pure`.
- Nur `api.model` und `api.catalog` von TaskNotes lesen — **niemals `api.tasks.*`** in irgendeiner Form. Zur Laufzeit gibt es gar keine TaskNotes-Kopplung: die Abbildung steckt im eingefrorenen Profil.
- Alle sichtbaren Texte über `src/i18n/strings.ts`, Schlüssel alphabetisch je Bereich, **EN und DE gemeinsam** pflegen. Kein Fachbegriff ohne Auflösung (UI-STANDARD §10).
- Keine absoluten Pfade unter `/Users/…` in getrackten `*.md` — `node scripts/check-no-abs-paths.mjs` läuft als erster Teil von `npm test`.
- Keine `eslint-disable`-Kommentare (`scripts/check-no-inline-disables.mjs`).
- Kit-Module (`src/vendor/**`) nie von Hand ändern, nur über `tools/sync-kit.sh`.
- Volles Gate vor jedem Merge: `npm run gate` (lint, 3× typecheck, test, check:pure, build).
- Commit-Messages: Conventional Commits, deutsch, einzeilige Betreffzeile. Mehrzeilige Messages über `git commit -F <datei>` — direktes Quoten mehrzeiliger Messages löst den CDP-Guard aus.
- **Löschen auf dem Server ist Nicht-Ziel** (Spec §8). Kein Task dieses Plans erzeugt einen `delete`-Plan.

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/core/ical/todo.ts` | **ändern** — `primaryTodo()` ergänzen (Pendant zu `primaryEvent`) |
| `src/core/mirror/todo-values.ts` | **ändern** — `statusValue`/`priorityValue` exportieren; sie sind die Vorwärtsrichtung, die die Rückwärtsregel abfragt |
| `src/core/mirror/todo-reverse.ts` | **neu** — `reverseStatus()`, `reversePriority()`: Frontmatter → VTODO, bewahrend |
| `src/core/ical/mutate.ts` | **ändern** — `TodoMutation`, `applyTodoMutation()`, `newTodoIcs()`; `setTimeProp` um `"due"` erweitern |
| `src/core/commands/todo-commands.ts` | **neu** — `hrefOfTodoTarget()`, `diffTodoFields()`, `planTodoCreate()` |
| `src/core/commands/push-hand-edits.ts` | **ändern** — `planTodoHandEdits` + `TODO_SUPPORTED`, ersetzt `nichtUnterstuetzt` (Zeile 129) |
| `src/core/sync/todo-collect.ts` | **neu** — `classifyTodos()`: Vault- und Serverstand → drei Gruppen |
| `src/core/sync/execute.ts` | **ändern** — `executeCommandPlans()`, Guard einmal statt n-mal |
| `src/obsidian/todo-sync-modal.ts` | **neu** — das Auswahl-Modal |
| `src/obsidian/command-flow.ts` | **ändern** — Einstiegspunkt `runTodoSync()` |
| `src/main.ts` | **ändern** — Kommando registrieren |
| `src/i18n/strings.ts` | **ändern** — neue Schlüssel, EN + DE |

---

### Task 1: Rückwärts-Abbildung — Status und Priorität, bewahrend

Die Härte des Meilensteins. `statusMap` ist nicht injektiv: im **mitgelieferten** Default-Profil zeigen `completed` und `cancelled` beide auf `"done"` (`src/core/mirror/profile.ts:64`). Naiv umgekehrt würde jede abgebrochene Aufgabe zu „erledigt".

**Files:**
- Modify: `src/core/mirror/todo-values.ts` (Zeilen 7 und 16 — `export` ergänzen)
- Create: `src/core/mirror/todo-reverse.ts`
- Test: `tests/core/mirror/todo-reverse.test.ts`

**Interfaces:**
- Consumes: `MappingProfile`, `StatusMap`, `PriorityMap` aus `./profile`; `statusValue`, `priorityValue` aus `./todo-values`
- Produces:
  ```ts
  export type VtodoStatus = "NEEDS-ACTION" | "IN-PROCESS" | "COMPLETED" | "CANCELLED";
  export function reverseStatus(p: MappingProfile, alt: string | undefined, neu: unknown): VtodoStatus | undefined;
  export function reversePriority(p: MappingProfile, alt: number | undefined, neu: unknown): number | null | undefined;
  ```
  `undefined` heißt „nicht abbildbar, Feld überspringen"; `null` bei der Priorität heißt „Property entfernen".

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/mirror/todo-reverse.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/core/mirror/todo-reverse"`

- [ ] **Step 3: Exportiere die Vorwärtsrichtung**

In `src/core/mirror/todo-values.ts` die beiden Funktionen exportierbar machen — sie bleiben die einzige Quelle der Vorwärtsabbildung, die Rückwärtsregel fragt sie nur ab:

```ts
export function priorityValue(p: MappingProfile, prio: number | undefined): string | undefined {
```
```ts
export function statusValue(p: MappingProfile, status: string | undefined): string | undefined {
```

- [ ] **Step 4: Write minimal implementation**

Create `src/core/mirror/todo-reverse.ts`:

```ts
import type { MappingProfile } from "./profile";
import { statusValue, priorityValue } from "./todo-values";

export type VtodoStatus = "NEEDS-ACTION" | "IN-PROCESS" | "COMPLETED" | "CANCELLED";

/** Reihenfolge ist die Vorrangregel bei Kollision: der erste Treffer gewinnt. COMPLETED steht
 *  vor CANCELLED, weil Abhaken der Normalfall und Abbrechen die bewusste Ausnahme ist. */
const KANDIDATEN: readonly VtodoStatus[] = ["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"];

/** RFC 5545 3.8.1.9 — Repraesentanten je Klasse. Nur bei echtem Wechsel gesetzt; ein bereits
 *  passender Zahlenwert bleibt unangetastet (sonst springt eine 2 grundlos auf die 1). */
const REPRAESENTANT = { high: 1, normal: 5, low: 9 } as const;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Frontmatter-Statuswert → VTODO-Zustand, **bewahrend**.
 *
 * Die Abbildung ist rueckwaerts nicht eindeutig: `statusMap` darf zwei VTODO-Zustaende auf
 * denselben Frontmatter-Wert legen, und das mitgelieferte Default-Profil TUT das
 * (`completed` und `cancelled` beide auf `"done"`). Deshalb wird nicht umgekehrt, sondern
 * gefragt: **hat sich ueberhaupt etwas geaendert?** Passt der neue Wert weiter zum alten
 * Serverzustand, bleibt dieser stehen und es wird nichts geschrieben.
 *
 * `undefined` = kein Schreibvorgang (entweder unveraendert oder nicht abbildbar).
 */
export function reverseStatus(p: MappingProfile, alt: string | undefined, neu: unknown): VtodoStatus | undefined {
  if (!p.statusMap) return undefined;
  const ziel = str(neu);
  if (ziel === undefined) return undefined;
  // 1. Bewahren: der alte Zustand bildet weiterhin auf den neuen Wert ab.
  if (statusValue(p, alt) === ziel) return undefined;
  // 2. Echter Wechsel: den ersten Kandidaten nehmen, der auf den Zielwert abbildet.
  return KANDIDATEN.find((k) => statusValue(p, k) === ziel);
}

/**
 * Frontmatter-Prioritaetswert → VTODO-Prioritaet, **bewahrend** (gleiche Begruendung wie
 * `reverseStatus`: `1–4` fallen alle auf `high`, ein passender Wert darf nicht springen).
 *
 * `undefined` = kein Schreibvorgang · `null` = Property entfernen.
 */
export function reversePriority(p: MappingProfile, alt: number | undefined, neu: unknown): number | null | undefined {
  if (!p.priorityMap) return undefined;
  const ziel = str(neu);
  // 1. Bewahren.
  if (priorityValue(p, alt) === ziel) return undefined;
  // 2. Kein Zielwert oder einer ausserhalb der Abbildung → keine Prioritaet mehr.
  if (ziel === undefined) return alt === undefined ? undefined : null;
  const klasse = (Object.keys(REPRAESENTANT) as (keyof typeof REPRAESENTANT)[])
    .find((k) => p.priorityMap?.[k] === ziel);
  if (!klasse) return alt === undefined ? undefined : null;
  return REPRAESENTANT[klasse];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/mirror/todo-reverse.test.ts`
Expected: PASS, 13 Tests

- [ ] **Step 6: Volles Gate**

Run: `npm run gate`
Expected: alle Tests grün, `check:pure` grün (die neue Datei importiert nichts aus obsidian/node)

- [ ] **Step 7: Commit**

```bash
git add src/core/mirror/todo-reverse.ts src/core/mirror/todo-values.ts tests/core/mirror/todo-reverse.test.ts
git commit -m "feat(mirror): Status und Prioritaet rueckwaerts abbilden, bewahrend statt umkehrend"
```

---

### Task 2: VTODO-Mutation und Neuanlage

`mutate.ts` kann heute nur VEVENT (`master()` sucht ein VEVENT, `setTimeProp` kennt nur `dtstart`/`dtend`). VTODO braucht das Geschwister — inklusive `DUE` und der Nebenwirkung, dass ein Statuswechsel `COMPLETED` und `PERCENT-COMPLETE` mitzieht.

**Files:**
- Modify: `src/core/ical/todo.ts` (`primaryTodo` ergänzen)
- Modify: `src/core/ical/mutate.ts`
- Test: `tests/core/ical/todo-mutate.test.ts`

**Interfaces:**
- Consumes: `TodoData`, `parseTodos` aus `./todo`; `VtodoStatus` aus `../mirror/todo-reverse`
- Produces:
  ```ts
  // in todo.ts
  export function primaryTodo(todos: TodoData[]): TodoData | undefined;
  // in mutate.ts
  export type TodoMutation =
    | { kind: "summary"; summary: string }
    | { kind: "description"; description: string | null }
    | { kind: "due"; due: string | null; allDay?: boolean; tzid?: string }
    | { kind: "start"; start: string | null; allDay?: boolean; tzid?: string }
    | { kind: "status"; status: VtodoStatus }
    | { kind: "priority"; priority: number | null }
    | { kind: "categories"; categories: string[] };
  export function applyTodoMutation(ics: string, m: TodoMutation, opts?: { now: Date }): string;
  export function newTodoIcs(
    t: { uid: string; summary: string; due?: string; start?: string; allDay?: boolean; tzid?: string; description?: string; status?: VtodoStatus; priority?: number; categories?: string[] },
    opts: { now: Date; prodId?: string },
  ): string;
  ```

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/ical/todo-mutate.test.ts`
Expected: FAIL — `applyTodoMutation is not exported` und `primaryTodo is not exported`

- [ ] **Step 3: `primaryTodo` in `src/core/ical/todo.ts` ergänzen**

```ts
/** Pendant zu `primaryEvent`: das erste VTODO ohne RECURRENCE-ID, sonst das erste ueberhaupt. */
export function primaryTodo(todos: TodoData[]): TodoData | undefined {
  return todos[0];
}
```

- [ ] **Step 4: `mutate.ts` erweitern**

`setTimeProp` nimmt zusätzlich `"due"` an — die Signatur wird erweitert, der Rumpf bleibt:

```ts
function setTimeProp(ve: ICAL.Component, name: "dtstart" | "dtend" | "due", iso: string, allDay: boolean | undefined, tzid: string | undefined): void {
```

Dazu ein VTODO-Pendant zu `master()` und die Mutation selbst:

```ts
function masterTodo(root: ICAL.Component): ICAL.Component {
  const vt = root.getFirstSubcomponent("vtodo");
  if (!vt) throw new Error("kein VTODO");
  return vt;
}

export type TodoMutation =
  | { kind: "summary"; summary: string }
  | { kind: "description"; description: string | null }
  | { kind: "due"; due: string | null; allDay?: boolean; tzid?: string }
  | { kind: "start"; start: string | null; allDay?: boolean; tzid?: string }
  | { kind: "status"; status: VtodoStatus }
  | { kind: "priority"; priority: number | null }
  | { kind: "categories"; categories: string[] };

function setOderWeg(vt: ICAL.Component, name: string, wert: string | number | null): void {
  vt.removeAllProperties(name);
  if (wert !== null && wert !== "") vt.addPropertyWithValue(name, wert);
}

export function applyTodoMutation(ics: string, m: TodoMutation, opts: { now: Date } = { now: new Date() }): string {
  const root = parseComponent(ics);
  const vt = masterTodo(root);
  switch (m.kind) {
    case "summary": setOderWeg(vt, "summary", m.summary); break;
    case "description": setOderWeg(vt, "description", m.description); break;
    case "priority": setOderWeg(vt, "priority", m.priority); break;
    case "categories":
      vt.removeAllProperties("categories");
      if (m.categories.length) vt.addPropertyWithValue("categories", m.categories.join(","));
      break;
    case "due":
      vt.removeAllProperties("due");
      if (m.due !== null) setTimeProp(vt, "due", m.due, m.allDay ?? DATE_ONLY.test(m.due), m.tzid);
      break;
    case "start":
      vt.removeAllProperties("dtstart");
      if (m.start !== null) setTimeProp(vt, "dtstart", m.start, m.allDay ?? DATE_ONLY.test(m.start), m.tzid);
      break;
    case "status": {
      setOderWeg(vt, "status", m.status);
      // Nebenwirkungen: ein Abschluss braucht seinen Zeitpunkt, ein Wiederoeffnen loescht ihn.
      // CANCELLED ist KEIN Abschluss im Sinne von COMPLETED (RFC 5545 3.8.1.1).
      vt.removeAllProperties("completed");
      vt.removeAllProperties("percent-complete");
      if (m.status === "COMPLETED") {
        vt.addPropertyWithValue("completed", utcNow(opts.now));
        vt.addPropertyWithValue("percent-complete", 100);
      }
      break;
    }
  }
  const seq = Number(vt.getFirstPropertyValue("sequence") ?? 0);
  vt.removeAllProperties("sequence");
  vt.addPropertyWithValue("sequence", seq + 1);
  vt.removeAllProperties("last-modified");
  vt.addPropertyWithValue("last-modified", utcNow(opts.now));
  vt.removeAllProperties("dtstamp");
  vt.addPropertyWithValue("dtstamp", utcNow(opts.now));
  return root.toString();
}

export function newTodoIcs(
  t: { uid: string; summary: string; due?: string; start?: string; allDay?: boolean; tzid?: string; description?: string; status?: VtodoStatus; priority?: number; categories?: string[] },
  opts: { now: Date; prodId?: string },
): string {
  const root = new ICAL.Component("vcalendar");
  root.addPropertyWithValue("version", "2.0");
  root.addPropertyWithValue("prodid", opts.prodId ?? PRODID);
  const vt = new ICAL.Component("vtodo");
  vt.addPropertyWithValue("uid", t.uid);
  vt.addPropertyWithValue("dtstamp", utcNow(opts.now));
  vt.addPropertyWithValue("sequence", 0);
  vt.addPropertyWithValue("summary", t.summary);
  vt.addPropertyWithValue("status", t.status ?? "NEEDS-ACTION");
  if (t.due) setTimeProp(vt, "due", t.due, t.allDay ?? DATE_ONLY.test(t.due), t.tzid);
  if (t.start) setTimeProp(vt, "dtstart", t.start, t.allDay ?? DATE_ONLY.test(t.start), t.tzid);
  if (t.description) vt.addPropertyWithValue("description", t.description);
  if (t.priority !== undefined) vt.addPropertyWithValue("priority", t.priority);
  if (t.categories?.length) vt.addPropertyWithValue("categories", t.categories.join(","));
  root.addSubcomponent(vt);
  return root.toString();
}
```

Import oben in `mutate.ts` ergänzen: `import type { VtodoStatus } from "../mirror/todo-reverse";`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/ical/todo-mutate.test.ts`
Expected: PASS, 10 Tests

- [ ] **Step 6: Sicherstellen, dass VEVENT unberührt ist**

Run: `npx vitest run tests/core/ical/`
Expected: PASS — die Erweiterung von `setTimeProp` ist rein additiv

- [ ] **Step 7: Commit**

```bash
git add src/core/ical/mutate.ts src/core/ical/todo.ts tests/core/ical/todo-mutate.test.ts
git commit -m "feat(ical): VTODO mutieren und neu anlegen, mit Statusnebenwirkungen"
```

---

### Task 3: Handänderungen für Aufgaben planen

Ersetzt das `nichtUnterstuetzt` in `push-hand-edits.ts:129`, das M6a bewusst als Erweiterungspunkt gesetzt hat.

**Files:**
- Create: `src/core/commands/todo-commands.ts`
- Modify: `src/core/commands/push-hand-edits.ts`
- Test: `tests/core/commands/todo-hand-edits.test.ts`

**Interfaces:**
- Consumes: `applyTodoMutation`, `TodoMutation` aus `../ical/mutate`; `parseTodos`, `primaryTodo` aus `../ical/todo`; `reverseStatus`, `reversePriority` aus `../mirror/todo-reverse`; `fmKeyFor` aus `../mirror/profile`
- Produces:
  ```ts
  export function hrefOfTodoTarget(target: CommandTarget): string;
  export function diffTodoFields(before: TodoData | undefined, after: TodoData): { field: string; before?: string; after?: string }[];
  export const TODO_SUPPORTED: readonly ["title", "due", "start", "description", "status", "priority", "categories"];
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { planPushHandEdits } from "../../../src/core/commands/push-hand-edits";
import { defaultTodoProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//DE",
  "BEGIN:VTODO", "UID:t1@test", "DTSTAMP:20260901T080000Z", "SEQUENCE:1",
  "SUMMARY:Steuer vorbereiten", "STATUS:NEEDS-ACTION", "DUE:20260930T120000Z",
  "END:VTODO", "END:VCALENDAR",
].join("\r\n");

function ctx(): CommandContext {
  return {
    now: new Date("2026-09-05T10:00:00Z"),
    profile: defaultTodoProfile(),
    collection: { id: "c1", href: "https://dav.example/cal/todo/", kind: "calendar", enabled: true } as never,
    account: { id: "a1" } as never,
    target: { kind: "todo", source: "a1:c1", href: "https://dav.example/cal/todo/t1.ics", uid: "t1@test" } as never,
    raw: ICS,
    etag: '"e1"',
    rand: () => 0.5,
  };
}

describe("planPushHandEdits fuer Aufgaben", () => {
  it("schreibt einen Statuswechsel als STATUS:COMPLETED", () => {
    const r = planPushHandEdits(ctx(), { status: "done" }, { status: "open" });
    expect(r.plan).not.toBeNull();
    expect(r.plan?.newRaw).toContain("STATUS:COMPLETED");
    expect(r.plan?.createsNew).toBe(false);
    expect(r.plan?.contentType).toBe("text/calendar");
    expect(r.plan?.etag).toBe('"e1"');
  });

  it("erzeugt KEINEN Plan, wenn die Bewahrungsregel greift", () => {
    // Server steht auf CANCELLED, das Frontmatter zeigt weiter "done" — nichts zu tun.
    const c = ctx();
    c.raw = ICS.replace("STATUS:NEEDS-ACTION", "STATUS:CANCELLED");
    const r = planPushHandEdits(c, { status: "done" }, { status: "in-progress" });
    expect(r.plan).toBeNull();
  });

  it("schreibt einen geaenderten Titel", () => {
    const r = planPushHandEdits(ctx(), { title: "Steuer fertig machen" }, { title: "Steuer vorbereiten" });
    expect(r.plan?.newRaw).toContain("Steuer fertig machen");
  });

  it("meldet ein nicht unterstuetztes Feld als skipped, statt es still zu verwerfen", () => {
    const r = planPushHandEdits(ctx(), { dav_etag: "geaendert" }, { dav_etag: "alt" });
    expect(r.plan).toBeNull();
    expect(r.skipped.map((s) => s.key)).toContain("dav_etag");
  });

  it("gibt null zurueck, wenn sich gar nichts geaendert hat", () => {
    const r = planPushHandEdits(ctx(), { status: "open" }, { status: "open" });
    expect(r.plan).toBeNull();
    expect(r.skipped).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/commands/todo-hand-edits.test.ts`
Expected: FAIL — `nichtUnterstuetzt` wirft für `kind: "todo"`

- [ ] **Step 3: `src/core/commands/todo-commands.ts` anlegen**

```ts
import type { TodoData } from "../ical/todo";
import type { CommandTarget } from "./types";

export const TODO_SUPPORTED = ["title", "due", "start", "description", "status", "priority", "categories"] as const;

export function hrefOfTodoTarget(target: CommandTarget): string {
  if (!("href" in target) || !target.href) throw new Error("todo-Kommando ohne href im Target");
  return target.href;
}

function zeile(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

export function diffTodoFields(before: TodoData | undefined, after: TodoData): { field: string; before?: string; after?: string }[] {
  const felder: (keyof TodoData)[] = ["summary", "due", "start", "description", "status", "priority", "categories"];
  const out: { field: string; before?: string; after?: string }[] = [];
  for (const f of felder) {
    const b = zeile(before?.[f]);
    const a = zeile(after[f]);
    if (b !== a) out.push({ field: String(f), ...(b !== undefined ? { before: b } : {}), ...(a !== undefined ? { after: a } : {}) });
  }
  return out;
}
```

- [ ] **Step 4: `planTodoHandEdits` in `push-hand-edits.ts` ergänzen**

```ts
function planTodoHandEdits(ctx: CommandContext, frontmatter: Record<string, unknown>, keys: string[], skipped: SkippedField[]): CommandPlan | null {
  const before = ctx.raw;
  if (before === undefined) throw new Error("push-hand-edits: kein Rohdaten (raw) vorhanden");
  const beforeTodo = primaryTodo(parseTodos(before));
  if (!beforeTodo) throw new Error("push-hand-edits: kein VTODO vorhanden");
  const mutations: TodoMutation[] = [];
  for (const fmKey of keys) {
    const sf = TODO_SUPPORTED.find((f) => fmKeyFor(ctx.profile, f) === fmKey);
    if (!sf) { skipped.push({ key: fmKey, reason: "kein unterstuetztes Server-Feld fuer dieses Frontmatter-Feld" }); continue; }
    const raw = frontmatter[fmKey];
    switch (sf) {
      case "title": mutations.push({ kind: "summary", summary: str(raw) ?? "" }); break;
      case "description": mutations.push({ kind: "description", description: nullableStr(raw) }); break;
      case "due": mutations.push({ kind: "due", due: nullableStr(raw) }); break;
      case "start": mutations.push({ kind: "start", start: nullableStr(raw) }); break;
      case "categories": mutations.push({ kind: "categories", categories: Array.isArray(raw) ? raw.map(String) : [] }); break;
      case "status": {
        // Bewahrend: kein Mutationseintrag, wenn der Serverzustand weiter passt (Task 1).
        const s = reverseStatus(ctx.profile, beforeTodo.status, raw);
        if (s) mutations.push({ kind: "status", status: s });
        break;
      }
      case "priority": {
        const p = reversePriority(ctx.profile, beforeTodo.priority, raw);
        if (p !== undefined) mutations.push({ kind: "priority", priority: p });
        break;
      }
    }
  }
  if (mutations.length === 0) return null;
  const newRaw = mutations.reduce((raw, m) => applyTodoMutation(raw, m, { now: ctx.now }), before);
  const afterTodo = primaryTodo(parseTodos(newRaw));
  if (!afterTodo) throw new Error("push-hand-edits: kein VTODO nach Mutation");
  return {
    commandId: "push-hand-edits", target: ctx.target,
    summary: "Write hand edits to the server", summaryKey: "plan.push-hand-edits.summary", summaryArgs: [],
    diff: diffTodoFields(beforeTodo, afterTodo), newRaw,
    etag: ctx.etag, contentType: "text/calendar", hrefForPut: hrefOfTodoTarget(ctx.target), createsNew: false,
  };
}
```

Und die Verzweigung am Ende von `planPushHandEdits` (Zeile 129) ersetzen:

```ts
  else if (ctx.profile.kind === "todo") plan = planTodoHandEdits(ctx, frontmatter, keys, skipped);
```

Imports ergänzen: `parseTodos`, `primaryTodo` aus `../ical/todo`; `applyTodoMutation`, `type TodoMutation` aus `../ical/mutate`; `reverseStatus`, `reversePriority` aus `../mirror/todo-reverse`; `TODO_SUPPORTED`, `diffTodoFields`, `hrefOfTodoTarget` aus `./todo-commands`.

⚠️ `nichtUnterstuetzt` wird hier nicht mehr für `"todo"` gerufen. Prüfen, ob der Import noch von einer anderen Stelle in der Datei gebraucht wird — falls nicht, entfernen (`npm run lint` meldet ihn sonst als unbenutzt). `assertNever` bleibt.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/core/commands/todo-hand-edits.test.ts`
Expected: PASS, 5 Tests

- [ ] **Step 6: Volles Gate**

Run: `npm run gate`

- [ ] **Step 7: Commit**

```bash
git add src/core/commands/todo-commands.ts src/core/commands/push-hand-edits.ts tests/core/commands/todo-hand-edits.test.ts
git commit -m "feat(commands): Handaenderungen an Aufgaben zurueckschreiben"
```

---

### Task 4: Sammeln und Klassifizieren

Der pure Kern des Sammel-Kommandos: aus Vault- und Serverstand die drei Gruppen bilden. Ohne Transport, ohne Obsidian — der Aufrufer reicht beides hinein.

**Files:**
- Create: `src/core/sync/todo-collect.ts`
- Test: `tests/core/sync/todo-collect.test.ts`

**Interfaces:**
- Consumes: `FmVal` aus `../mirror/profile`
- Produces:
  ```ts
  export interface TodoNoteState {
    path: string;
    frontmatter: Record<string, unknown>;
    prevWritten: Record<string, FmVal>;
    uid?: string;          // fehlt = im Vault neu entstanden
    href?: string;
    etag?: string;         // zuletzt gesehener Serverstand
    collectionId?: string;
  }
  export type TodoGroup = "vault-only" | "new" | "conflict";
  export interface ClassifiedTodo { note: TodoNoteState; group: TodoGroup; serverEtag?: string; changedKeys: string[] }
  export function classifyTodos(notes: TodoNoteState[], serverEtags: Map<string, string>): ClassifiedTodo[];
  ```
  ⚠️ **Vertrag über den Schlüssel:** `serverEtags` ist auf **href-Pfade** verschlüsselt, nicht
  auf volle URLs — so liefert es `listEtags` (`src/core/dav/sync.ts:31`:
  `etags[hrefPath(resolveHref(col.href, r.href))]`). `TodoNoteState.href` muss deshalb
  derselben Normalisierung folgen; der Adapter in Task 9 stellt das her. Wer hier volle URLs
  hineingibt, bekommt lauter Konflikte, weil kein Schlüssel trifft.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { classifyTodos, type TodoNoteState } from "../../../src/core/sync/todo-collect";

const H = "https://dav.example/cal/todo/t1.ics";

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
  });

  it("meldet mehrere geaenderte Schluessel", () => {
    const n = note({ frontmatter: { status: "done", title: "Neu" }, prevWritten: { status: "open", title: "Alt" } });
    const r = classifyTodos([n], new Map([[H, '"e1"']]));
    expect(r[0]?.changedKeys.sort()).toEqual(["status", "title"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/sync/todo-collect.test.ts`
Expected: FAIL — Modul nicht auflösbar

- [ ] **Step 3: Write minimal implementation**

```ts
import type { FmVal } from "../mirror/profile";
import { fmEquals } from "../mirror/hash";

export interface TodoNoteState {
  path: string;
  frontmatter: Record<string, unknown>;
  prevWritten: Record<string, FmVal>;
  /** Fehlt = im Vault entstanden, noch nie auf dem Server. */
  uid?: string;
  href?: string;
  /** Der zuletzt gesehene Serverstand — Grundlage des Konflikt-Vergleichs. */
  etag?: string;
  collectionId?: string;
}

export type TodoGroup = "vault-only" | "new" | "conflict";

export interface ClassifiedTodo {
  note: TodoNoteState;
  group: TodoGroup;
  /** Nur bei "conflict" belegt: der aktuelle Serverstand. */
  serverEtag?: string;
  changedKeys: string[];
}

/** Wie `handEditedKeys` in push-hand-edits, aber ueber eine Menge statt eine Notiz. */
function changedKeys(fm: Record<string, unknown>, prev: Record<string, FmVal>): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(prev)) if (!fmEquals(fm[k], v)) keys.push(k);
  return keys;
}

/**
 * Ordnet jede Notiz genau einer Gruppe zu — oder gar keiner.
 *
 * Weggelassen wird, was hier nichts zu suchen hat: unveraenderte Notizen und solche, die sich
 * NUR serverseitig bewegt haben (die holt der normale Sync). Uebrig bleibt, was der Nutzer
 * entscheiden muss.
 */
export function classifyTodos(notes: TodoNoteState[], serverEtags: Map<string, string>): ClassifiedTodo[] {
  const out: ClassifiedTodo[] = [];
  for (const note of notes) {
    const keys = changedKeys(note.frontmatter, note.prevWritten);
    if (note.uid === undefined) {
      out.push({ note, group: "new", changedKeys: keys });
      continue;
    }
    if (keys.length === 0) continue; // im Vault unveraendert — nicht unser Fall
    const serverEtag = note.href ? serverEtags.get(note.href) : undefined;
    if (serverEtag !== undefined && serverEtag === note.etag) {
      out.push({ note, group: "vault-only", changedKeys: keys });
    } else {
      // Abweichendes ODER fehlendes Server-ETag: beide Seiten sind auseinander. Ein fehlender
      // Eintrag heisst nicht "unveraendert", sondern "der Server fuehrt sie nicht (mehr)" —
      // stillschweigend hochladen waere die falsche Annahme.
      out.push({ note, group: "conflict", ...(serverEtag !== undefined ? { serverEtag } : {}), changedKeys: keys });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/sync/todo-collect.test.ts`
Expected: PASS, 7 Tests

- [ ] **Step 5: Commit**

```bash
git add src/core/sync/todo-collect.ts tests/core/sync/todo-collect.test.ts
git commit -m "feat(sync): Aufgaben-Unterschiede in drei Gruppen klassifizieren"
```

---

### Task 5: Mehrere Pläne unter EINEM Busy-Guard ausführen

Die Falle aus Spec §5: `busy.ts` hat **keinen Reentrancy-Zähler**, und `executeCommandPlan` nimmt den Guard bei jedem Aufruf. Ein Sammellauf über `executeCommandPlan` bekäme n-mal `busy`.

**Files:**
- Modify: `src/core/sync/execute.ts`
- Test: `tests/core/sync/execute-plans.test.ts`

**Interfaces:**
- Consumes: `SyncDeps`, `PluginSettings`, `CommandPlan`, `ExecuteResult` (alle vorhanden)
- Produces:
  ```ts
  export interface PlanOutcome { plan: CommandPlan; result: ExecuteResult }
  export async function executeCommandPlans(deps: SyncDeps, settings: PluginSettings, plans: CommandPlan[]): Promise<PlanOutcome[]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { executeCommandPlans } from "../../../src/core/sync/execute";
import { createBusyGuard } from "../../../src/core/sync/busy";

// Minimal-Fakes: der Test misst NICHT das Schreiben, sondern den Guard und die Bilanz.
function deps(busy = createBusyGuard()) {
  return { busy, now: () => new Date("2026-09-05T10:00:00Z") } as never;
}
/** Liefert Deps, deren Transport die Ausgaenge der Reihe nach durchspielt — fuer den
 *  Abbruch-Test. Die konkrete Verdrahtung folgt dem vorhandenen Muster in
 *  `tests/core/sync/execute.test.ts`; entscheidend ist nur die Reihenfolge der Ausgaenge. */
function depsMitAusgang(ausgaenge: ("ok" | "conflict" | "transport-error")[]) {
  let i = 0;
  return { busy: createBusyGuard(), now: () => new Date("2026-09-05T10:00:00Z"), _ausgang: () => ausgaenge[i++] } as never;
}

function plan(uid: string) {
  return {
    commandId: "push-hand-edits", target: { kind: "todo", uid, href: `https://dav.example/${uid}.ics` },
    summary: "", summaryKey: "", summaryArgs: [], diff: [], newRaw: "X",
    contentType: "text/calendar", hrefForPut: `https://dav.example/${uid}.ics`, createsNew: false,
  } as never;
}

describe("executeCommandPlans", () => {
  it("nimmt den Busy-Guard EINMAL, nicht je Plan", async () => {
    // Der eigentliche Regressionstest: wuerde je Plan `executeCommandPlan` gerufen, meldete
    // ab dem zweiten jeder Plan "busy" — bei intakter API und ohne dass jemand kollidiert.
    const busy = createBusyGuard();
    const spy = vi.spyOn(busy, "tryAcquire");
    await executeCommandPlans(deps(busy), {} as never, [plan("a"), plan("b"), plan("c")]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(busy.isBusy()).toBe(false); // am Ende wieder freigegeben
  });

  it("gibt je Plan ein Ergebnis zurueck, in derselben Reihenfolge", async () => {
    const r = await executeCommandPlans(deps(), {} as never, [plan("a"), plan("b")]);
    expect(r).toHaveLength(2);
    expect(r[0]?.plan.target).toMatchObject({ uid: "a" });
    expect(r[1]?.plan.target).toMatchObject({ uid: "b" });
  });

  it("bricht mit busy ab, wenn ein anderer Lauf den Guard haelt", async () => {
    const busy = createBusyGuard();
    busy.tryAcquire();
    const r = await executeCommandPlans(deps(busy), {} as never, [plan("a")]);
    expect(r[0]?.result).toMatchObject({ ok: false, error: "busy" });
  });

  it("stoppt nach einem Transportfehler, macht aber nach einem Konflikt weiter", async () => {
    // Spec §6: das Netz ist weg → weitere Versuche kosten nur Zeit. Ein 412 dagegen betrifft
    // genau ein Objekt; die uebrigen muessen trotzdem geschrieben werden.
    const r = await executeCommandPlans(depsMitAusgang(["transport-error", "ok"]), {} as never, [plan("a"), plan("b")]);
    expect(r).toHaveLength(1);

    const k = await executeCommandPlans(depsMitAusgang(["conflict", "ok"]), {} as never, [plan("a"), plan("b")]);
    expect(k).toHaveLength(2);
    expect(k[1]?.result.ok).toBe(true);
  });

  it("gibt eine leere Liste ohne Plaene zurueck und nimmt den Guard gar nicht", async () => {
    const busy = createBusyGuard();
    const spy = vi.spyOn(busy, "tryAcquire");
    expect(await executeCommandPlans(deps(busy), {} as never, [])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/sync/execute-plans.test.ts`
Expected: FAIL — `executeCommandPlans is not exported`

- [ ] **Step 3: Write minimal implementation**

In `src/core/sync/execute.ts` ergänzen (unter `executeCommandPlan`):

```ts
export interface PlanOutcome { plan: CommandPlan; result: ExecuteResult }

/**
 * Fuehrt mehrere Plaene unter EINEM Busy-Guard aus.
 *
 * ⚠️ Warum das nicht einfach eine Schleife ueber `executeCommandPlan` ist: `busy.ts` haelt
 * bewusst KEINEN Reentrancy-Zaehler ("ein einfacher gemeinsamer Zustand reicht"). Eine
 * Schleife ueber die oeffentliche Variante bekaeme ab dem zweiten Plan `busy` zurueck — bei
 * intakter API und ohne dass irgendjemand kollidiert. Der Fehler saehe aus wie ein
 * Nebenlaeufigkeitsproblem und waere ein Eigentor.
 *
 * Umgekehrt darf der Guard auch nicht ganz entfallen: sonst faehrt der Intervall-Sync
 * zwischen zwei Plaene und schreibt gegen dieselbe Collection.
 *
 * Teilerfolg ist ein gueltiger Ausgang: jeder Plan bekommt sein eigenes Ergebnis, ein
 * gescheiterter stoppt die uebrigen nicht.
 */
export async function executeCommandPlans(deps: SyncDeps, settings: PluginSettings, plans: CommandPlan[]): Promise<PlanOutcome[]> {
  if (plans.length === 0) return [];
  if (!deps.busy.tryAcquire()) {
    return plans.map((plan) => ({ plan, result: { ok: false, conflict: false, error: "busy" } as ExecuteResult }));
  }
  try {
    const out: PlanOutcome[] = [];
    for (const plan of plans) {
      const result = await executeCommandPlanLocked(deps, settings, plan);
      out.push({ plan, result });
      // Spec §6: ein Transportfehler stoppt den Rest — ist das Netz weg, sind weitere
      // Versuche nur langsam. Ein KONFLIKT stoppt dagegen nichts: der betrifft genau ein
      // Objekt, die uebrigen sind davon unberuehrt.
      if (!result.ok && !result.conflict && result.error === "transport-error") break;
    }
    return out;
  } finally {
    deps.busy.release();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/sync/execute-plans.test.ts`
Expected: PASS, 4 Tests

- [ ] **Step 5: Commit**

```bash
git add src/core/sync/execute.ts tests/core/sync/execute-plans.test.ts
git commit -m "feat(sync): mehrere Plaene unter einem Busy-Guard ausfuehren"
```

---

### Task 6: Erstanlage aus dem Vault

Eine Notiz ohne `dav_uid` wird zu einem `CommandPlan` mit `createsNew: true`. Der DAV-Pfad existiert bereits (`execute.ts:165` wählt `If-None-Match`), es fehlt nur der Planer.

**Files:**
- Modify: `src/core/commands/todo-commands.ts`
- Test: `tests/core/commands/todo-create.test.ts`

**Interfaces:**
- Consumes: `newTodoIcs` aus `../ical/mutate`; `reverseStatus`, `reversePriority` aus `../mirror/todo-reverse`; `fmKeyFor`
- Produces:
  ```ts
  export function planTodoCreate(ctx: CommandContext, frontmatter: Record<string, unknown>): CommandPlan;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { planTodoCreate } from "../../../src/core/commands/todo-commands";
import { defaultTodoProfile } from "../../../src/core/mirror/profile";
import type { CommandContext } from "../../../src/core/commands/types";

function ctx(): CommandContext {
  return {
    now: new Date("2026-09-05T10:00:00Z"),
    profile: defaultTodoProfile(),
    collection: { id: "c1", href: "https://dav.example/cal/todo/", kind: "calendar", enabled: true } as never,
    account: { id: "a1" } as never,
    target: { kind: "todo", source: "a1:c1" } as never,
    rand: () => 0.5,
  };
}

describe("planTodoCreate", () => {
  it("erzeugt einen Plan mit createsNew und ohne etag", () => {
    const p = planTodoCreate(ctx(), { title: "Rueckruf Werkstatt", due: "2026-10-01" });
    expect(p.createsNew).toBe(true);
    expect(p.etag).toBeUndefined();
    expect(p.contentType).toBe("text/calendar");
  });

  it("legt den href unter der Collection an und endet auf .ics", () => {
    const p = planTodoCreate(ctx(), { title: "X" });
    expect(p.hrefForPut.startsWith("https://dav.example/cal/todo/")).toBe(true);
    expect(p.hrefForPut.endsWith(".ics")).toBe(true);
  });

  it("uebernimmt Titel, Faelligkeit und Status ins VTODO", () => {
    const p = planTodoCreate(ctx(), { title: "Rueckruf", due: "2026-10-01", status: "open" });
    expect(p.newRaw).toContain("BEGIN:VTODO");
    expect(p.newRaw).toContain("SUMMARY:Rueckruf");
    expect(p.newRaw).toContain("STATUS:NEEDS-ACTION");
    expect(p.newRaw).toContain("SEQUENCE:0");
  });

  it("faellt ohne Status auf NEEDS-ACTION zurueck", () => {
    const p = planTodoCreate(ctx(), { title: "Ohne Status" });
    expect(p.newRaw).toContain("STATUS:NEEDS-ACTION");
  });

  it("zeigt im Diff nur Nachher-Werte, weil es kein Vorher gibt", () => {
    const p = planTodoCreate(ctx(), { title: "Neu" });
    expect(p.diff.every((d) => d.before === undefined)).toBe(true);
    expect(p.diff.some((d) => d.after === "Neu")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/commands/todo-create.test.ts`
Expected: FAIL — `planTodoCreate is not exported`

- [ ] **Step 3: Write minimal implementation**

In `src/core/commands/todo-commands.ts` ergänzen:

```ts
import { newTodoIcs } from "../ical/mutate";
import { parseTodos, primaryTodo } from "../ical/todo";
import { reverseStatus, reversePriority } from "../mirror/todo-reverse";
import { fmKeyFor } from "../mirror/profile";
import type { CommandContext, CommandPlan } from "./types";

function fmWert(ctx: CommandContext, fm: Record<string, unknown>, serverField: string): unknown {
  const key = fmKeyFor(ctx.profile, serverField);
  return key ? fm[key] : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Eine im Vault entstandene Aufgabe zum Server-Objekt machen.
 *
 * Die UID wird hier erzeugt, nicht vom Server vergeben — CalDAV verlangt sie im Body, und der
 * Dateiname der Ressource leitet sich daraus ab. `ctx.rand` ist injizierbar, damit der Test
 * einen festen Namen bekommt.
 *
 * `createsNew: true` waehlt in `executeCommandPlanLocked` den `If-None-Match: *`-Header — das
 * schuetzt davor, eine gleichnamige Ressource zu ueberschreiben, die zwischen Planung und
 * Ausfuehrung entstanden ist.
 */
export function planTodoCreate(ctx: CommandContext, frontmatter: Record<string, unknown>): CommandPlan {
  const uid = `cn-${Math.floor(ctx.rand() * 1e9).toString(36)}-${ctx.now.getTime().toString(36)}@calendar-notes`;
  const status = reverseStatus(ctx.profile, undefined, fmWert(ctx, frontmatter, "status"));
  const prioRoh = reversePriority(ctx.profile, undefined, fmWert(ctx, frontmatter, "priority"));
  const kategorien = fmWert(ctx, frontmatter, "categories");
  const newRaw = newTodoIcs({
    uid,
    summary: str(fmWert(ctx, frontmatter, "title")) ?? "",
    ...(str(fmWert(ctx, frontmatter, "due")) !== undefined ? { due: str(fmWert(ctx, frontmatter, "due")) as string } : {}),
    ...(str(fmWert(ctx, frontmatter, "start")) !== undefined ? { start: str(fmWert(ctx, frontmatter, "start")) as string } : {}),
    ...(str(fmWert(ctx, frontmatter, "description")) !== undefined ? { description: str(fmWert(ctx, frontmatter, "description")) as string } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof prioRoh === "number" ? { priority: prioRoh } : {}),
    ...(Array.isArray(kategorien) ? { categories: kategorien.map(String) } : {}),
  }, { now: ctx.now });
  const after = primaryTodo(parseTodos(newRaw));
  if (!after) throw new Error("planTodoCreate: erzeugtes ICS enthaelt kein VTODO");
  return {
    commandId: "todo.create", target: ctx.target,
    summary: "Create task on the server", summaryKey: "plan.todo.create.summary", summaryArgs: [],
    diff: diffTodoFields(undefined, after), newRaw,
    contentType: "text/calendar", hrefForPut: `${ctx.collection.href}${uid}.ics`, createsNew: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/commands/todo-create.test.ts`
Expected: PASS, 5 Tests

- [ ] **Step 5: Commit**

```bash
git add src/core/commands/todo-commands.ts tests/core/commands/todo-create.test.ts
git commit -m "feat(commands): im Vault entstandene Aufgabe auf dem Server anlegen"
```

---

### Task 7: i18n-Schlüssel

Alle Texte des Modals, EN und DE gemeinsam. Vor dem Modal, damit Task 8 keine Platzhalter braucht.

**Files:**
- Modify: `src/i18n/strings.ts`
- Test: `tests/i18n/strings.test.ts` (vorhanden — er prüft die Schlüsselgleichheit beider Sprachen)

- [ ] **Step 1: Bestehenden i18n-Test laufen lassen (Baseline)**

Run: `npx vitest run tests/i18n/strings.test.ts`
Expected: PASS — festhalten, dass er VOR der Änderung grün ist

- [ ] **Step 2: Schlüssel ergänzen, alphabetisch im jeweiligen Bereich**

```ts
// EN
"todoSync.title": "Sync tasks with the server",
"todoSync.empty": "Nothing to send — every task matches the server.",
"todoSync.group.vaultOnly": "Changed in the vault ({0})",
"todoSync.group.new": "New, not on the server yet ({0})",
"todoSync.group.conflict": "Changed on both sides ({0})",
"todoSync.conflict.hint": "These tasks changed here AND on the server. Choose per row which side wins — “server” discards your change in the note.",
"todoSync.choice.vault": "Vault wins",
"todoSync.choice.server": "Server wins",
"todoSync.choice.skip": "Skip",
"todoSync.selectAll": "Select all",
"todoSync.selectNone": "Clear selection",
"todoSync.send": "Send {0}",
"todoSync.cancel": "Cancel",
"todoSync.skippedFields": "Not transferable: {0}",
"todoSync.result": "{0} written, {1} failed.",
"todoSync.resultConflict": "{0} could not be written because they changed on the server in the meantime.",
"plan.todo.create.summary": "Create task on the server",

// DE
"todoSync.title": "Aufgaben mit dem Server abgleichen",
"todoSync.empty": "Nichts zu senden — jede Aufgabe stimmt mit dem Server überein.",
"todoSync.group.vaultOnly": "Im Vault geändert ({0})",
"todoSync.group.new": "Neu, noch nicht auf dem Server ({0})",
"todoSync.group.conflict": "Auf beiden Seiten geändert ({0})",
"todoSync.conflict.hint": "Diese Aufgaben haben sich hier UND auf dem Server geändert. Wähle je Zeile, welche Seite gewinnt — „Server“ verwirft deine Änderung in der Notiz.",
"todoSync.choice.vault": "Vault gewinnt",
"todoSync.choice.server": "Server gewinnt",
"todoSync.choice.skip": "Überspringen",
"todoSync.selectAll": "Alle auswählen",
"todoSync.selectNone": "Auswahl aufheben",
"todoSync.send": "{0} senden",
"todoSync.cancel": "Abbrechen",
"todoSync.skippedFields": "Nicht übertragbar: {0}",
"todoSync.result": "{0} geschrieben, {1} fehlgeschlagen.",
"todoSync.resultConflict": "{0} konnten nicht geschrieben werden, weil sie sich zwischenzeitlich auf dem Server geändert haben.",
"plan.todo.create.summary": "Aufgabe auf dem Server anlegen",
```

- [ ] **Step 3: Test laufen lassen**

Run: `npx vitest run tests/i18n/strings.test.ts`
Expected: PASS — beide Sprachen tragen dieselben Schlüssel

- [ ] **Step 4: Commit**

```bash
git add src/i18n/strings.ts
git commit -m "feat(i18n): Texte fuer den Aufgaben-Abgleich, EN und DE"
```

---

### Task 8: Das Auswahl-Modal

Kreuzung aus `AdoptionModal` (Liste, Sammelknöpfe, Bestätigen/Abbrechen) und `PlanPreviewModal` (Diff-Zeilen). Nichts davon wird neu erfunden.

**Files:**
- Create: `src/obsidian/todo-sync-modal.ts`
- Test: `tests/obsidian/todo-sync-modal.test.ts`

**Interfaces:**
- Consumes: `ClassifiedTodo`, `TodoGroup` aus `../core/sync/todo-collect`; `diffRows` aus `./plan-preview-modal`; `t` aus `../i18n/strings`
- Produces:
  ```ts
  export type Entscheidung = "vault" | "server" | "skip";
  export interface TodoSyncAuswahl { note: ClassifiedTodo; entscheidung: Entscheidung }
  export function vorbelegung(c: ClassifiedTodo): Entscheidung;   // pur, deshalb testbar ohne DOM
  export class TodoSyncModal extends Modal { … }
  ```

- [ ] **Step 1: Write the failing test**

Nur die pure Hälfte wird hier getestet — die DOM-Hälfte deckt der Handproben-Treiber (Task 10) ab. Das ist die Arbeitsteilung, die das Repo für UI durchgehend fährt.

```ts
import { describe, it, expect } from "vitest";
import { vorbelegung } from "../../src/obsidian/todo-sync-modal";
import type { ClassifiedTodo } from "../../src/core/sync/todo-collect";

function c(group: ClassifiedTodo["group"]): ClassifiedTodo {
  return { note: { path: "Tasks/X.md", frontmatter: {}, prevWritten: {} }, group, changedKeys: [] };
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/todo-sync-modal.test.ts`
Expected: FAIL — Modul nicht auflösbar

- [ ] **Step 3: Modal implementieren**

```ts
import { Modal, ButtonComponent, DropdownComponent, type App } from "obsidian";
import type { ClassifiedTodo, TodoGroup } from "../core/sync/todo-collect";
import { t } from "../i18n/strings";

export type Entscheidung = "vault" | "server" | "skip";
export interface TodoSyncAuswahl { note: ClassifiedTodo; entscheidung: Entscheidung }

/**
 * Angehakt ist, was der Nutzer erkennbar gewollt hat: wer abhakt oder anlegt, hat gehandelt,
 * und der Upload ist die Fortsetzung dieser Handlung. Ein Konflikt dagegen ist kein Wunsch,
 * sondern eine Lage — dort entscheidet die Vorbelegung nichts, schon gar nicht "server",
 * das Nutzerarbeit verwirft.
 */
export function vorbelegung(c: ClassifiedTodo): Entscheidung {
  return c.group === "conflict" ? "skip" : "vault";
}

const GRUPPEN: { key: TodoGroup; label: string }[] = [
  { key: "vault-only", label: "todoSync.group.vaultOnly" },
  { key: "new", label: "todoSync.group.new" },
  { key: "conflict", label: "todoSync.group.conflict" },
];

export class TodoSyncModal extends Modal {
  private auswahl = new Map<string, Entscheidung>();

  constructor(app: App, private eintraege: ClassifiedTodo[], private onSend: (a: TodoSyncAuswahl[]) => void) {
    super(app);
    for (const e of eintraege) this.auswahl.set(e.note.path, vorbelegung(e));
  }

  onOpen(): void {
    this.titleEl.setText(t("todoSync.title"));
    if (this.eintraege.length === 0) {
      this.contentEl.createEl("p", { text: t("todoSync.empty") });
      new ButtonComponent(this.contentEl.createDiv({ cls: "modal-button-container" }))
        .setButtonText(t("todoSync.cancel")).onClick(() => this.close());
      return;
    }
    for (const g of GRUPPEN) {
      const dieser = this.eintraege.filter((e) => e.group === g.key);
      if (dieser.length === 0) continue;
      this.contentEl.createEl("h3", { text: t(g.label, dieser.length) });
      if (g.key === "conflict") {
        this.contentEl.createEl("p", { text: t("todoSync.conflict.hint"), cls: "calendar-notes-invite-hint" });
      }
      const table = this.contentEl.createEl("table", { cls: "calendar-notes-diff-table" });
      const tbody = table.createEl("tbody");
      for (const e of dieser) {
        const row = tbody.createEl("tr");
        row.createEl("td", { text: e.note.path });
        row.createEl("td", { text: e.changedKeys.join(", ") });
        const dd = new DropdownComponent(row.createEl("td"));
        dd.addOption("vault", t("todoSync.choice.vault"));
        if (g.key === "conflict") dd.addOption("server", t("todoSync.choice.server"));
        dd.addOption("skip", t("todoSync.choice.skip"));
        dd.setValue(this.auswahl.get(e.note.path) ?? "skip");
        dd.onChange((v) => this.auswahl.set(e.note.path, v as Entscheidung));
      }
    }
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("todoSync.selectAll")).onClick(() => {
      for (const e of this.eintraege) if (e.group !== "conflict") this.auswahl.set(e.note.path, "vault");
      this.close(); this.open();
    });
    new ButtonComponent(btns).setButtonText(t("todoSync.selectNone")).onClick(() => {
      for (const e of this.eintraege) this.auswahl.set(e.note.path, "skip");
      this.close(); this.open();
    });
    new ButtonComponent(btns).setButtonText(t("todoSync.cancel")).onClick(() => this.close());
    const gewaehlt = (): TodoSyncAuswahl[] =>
      this.eintraege
        .map((note) => ({ note, entscheidung: this.auswahl.get(note.note.path) ?? "skip" }))
        .filter((a) => a.entscheidung !== "skip");
    new ButtonComponent(btns).setCta().setButtonText(t("todoSync.send", gewaehlt().length)).onClick(() => {
      const a = gewaehlt();
      this.close();
      this.onSend(a);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/obsidian/todo-sync-modal.test.ts`
Expected: PASS, 2 Tests

- [ ] **Step 5: Volles Gate**

Run: `npm run gate`

- [ ] **Step 6: Commit**

```bash
git add src/obsidian/todo-sync-modal.ts tests/obsidian/todo-sync-modal.test.ts
git commit -m "feat(ui): Auswahl-Modal fuer den Aufgaben-Abgleich"
```

---

### Task 9: Verdrahtung — Kommando, Sammeln, Ausführen

Bringt Task 4–8 zusammen: Notizen einlesen, Server-ETags holen, klassifizieren, Modal zeigen, Pläne bauen und ausführen, Ergebnis melden.

**Files:**
- Modify: `src/obsidian/command-flow.ts`
- Modify: `src/main.ts`
- Test: `tests/obsidian/todo-sync-flow.test.ts`

**Interfaces:**
- Consumes: `classifyTodos`, `executeCommandPlans`, `planPushHandEdits`, `planTodoCreate`, `TodoSyncModal`
- Produces:
  ```ts
  export function planlisteAus(
    auswahl: TodoSyncAuswahl[],
    bauHandEdit: (a: TodoSyncAuswahl) => CommandPlan | null,
    bauCreate: (a: TodoSyncAuswahl) => CommandPlan | null,
  ): { plaene: CommandPlan[]; resync: { collectionId: string; href: string }[] };
  // Methode auf CommandFlow:
  runTodoSync(): Promise<void>;
  ```
  `planlisteAus` ist **synchron und pur** — beide Bauer sind Lookups in eine zuvor gefüllte
  Map. Der asynchrone Teil (Rohdaten nachladen) passiert im Aufrufer, damit die
  Zuordnungsregel ohne DOM und ohne Netz testbar bleibt.

- [ ] **Step 1: Write the failing test**

```ts
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
    expect(r.plaene).toHaveLength(1);
  });

  it("erzeugt fuer 'server' KEINEN Plan, sondern eine Resync-Aufgabe", () => {
    // "Server gewinnt" schreibt nicht nach DAV — es holt den Serverstand in die Notiz.
    const a: TodoSyncAuswahl[] = [{
      note: { note: { path: "Tasks/C.md", frontmatter: {}, prevWritten: {}, uid: "u3", href: "https://d/e.ics", collectionId: "c1" }, group: "conflict", changedKeys: ["status"] },
      entscheidung: "server",
    }];
    const r = planlisteAus(a, vi.fn(), vi.fn());
    expect(r.plaene).toHaveLength(0);
    expect(r.resync).toEqual([{ collectionId: "c1", href: "https://d/e.ics" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/obsidian/todo-sync-flow.test.ts`
Expected: FAIL — `planlisteAus is not exported`

- [ ] **Step 3: `planlisteAus` in `command-flow.ts` ergänzen**

```ts
/**
 * Auswahl → Arbeitsliste. Bewusst pur und exportiert, damit die Zuordnung ohne DOM testbar ist:
 * sie trägt die Regel, dass "Server gewinnt" KEIN DAV-Schreibvorgang ist, sondern ein
 * `resyncObject` — der einzige Weg, auf dem in diesem Kommando Vault-Inhalt überschrieben wird.
 */
export function planlisteAus(
  auswahl: TodoSyncAuswahl[],
  bauHandEdit: (a: TodoSyncAuswahl) => CommandPlan | null,
  bauCreate: (a: TodoSyncAuswahl) => CommandPlan | null,
): { plaene: CommandPlan[]; resync: { collectionId: string; href: string }[] } {
  const plaene: CommandPlan[] = [];
  const resync: { collectionId: string; href: string }[] = [];
  for (const a of auswahl) {
    if (a.entscheidung === "server") {
      const { collectionId, href } = a.note.note;
      if (collectionId && href) resync.push({ collectionId, href });
      continue;
    }
    if (a.note.group === "new") { const c = bauCreate(a); if (c) plaene.push(c); continue; }
    const p = bauHandEdit(a);
    if (p) plaene.push(p);
  }
  return { plaene, resync };
}
```

- [ ] **Step 4: `runTodoSync` ergänzen**

```ts
  /**
   * Der Einstiegspunkt des Sammel-Kommandos. Reihenfolge zählt: erst der Serverstand
   * (zwei Requests je Sammlung, nicht einer je Notiz), dann klassifizieren, dann fragen,
   * dann schreiben — unter EINEM Busy-Guard (`executeCommandPlans`, s. dort warum).
   */
  async runTodoSync(): Promise<void> {
    const settings = this.deps.settings();
    const notes = await sammleTodoNotizen(this.app, settings);
    if (notes.length === 0) { new Notice(t("todoSync.empty")); return; }
    const etags = await holeServerEtags(this.deps, settings, notes);
    const klassifiziert = classifyTodos(notes, etags);
    if (klassifiziert.length === 0) { new Notice(t("todoSync.empty")); return; }
    new TodoSyncModal(this.app, klassifiziert, (auswahl) => {
      this.fireAndForget(this.sendeAuswahl(auswahl), t("op.command"));
    }).open();
  }

  private async sendeAuswahl(auswahl: TodoSyncAuswahl[]): Promise<void> {
    const settings = this.deps.settings();
    // Die Plaene werden VORHER gebaut, weil `bauTodoHandEdit` Rohdaten nachlaedt und damit
    // asynchron ist — `planlisteAus` bleibt bewusst synchron und pur, sonst waere die
    // Zuordnungsregel (insbesondere "Server gewinnt" → kein Plan) nicht ohne DOM testbar.
    const vorbereitet = new Map<string, CommandPlan | null>();
    for (const a of auswahl) {
      if (a.entscheidung !== "vault") continue;
      vorbereitet.set(
        a.note.note.path,
        a.note.group === "new" ? this.bauTodoCreate(a, settings) ?? null : await this.bauTodoHandEdit(a, settings),
      );
    }
    const { plaene, resync } = planlisteAus(
      auswahl,
      (a) => vorbereitet.get(a.note.note.path) ?? null,
      (a) => vorbereitet.get(a.note.note.path) ?? null,
    );
    const ergebnisse = await executeCommandPlans(this.deps, settings, plaene);
    for (const r of resync) await resyncObject(this.deps, settings, r.collectionId, r.href);
    const ok = ergebnisse.filter((e) => e.result.ok).length;
    const konflikte = ergebnisse.filter((e) => !e.result.ok && e.result.conflict).length;
    new Notice(t("todoSync.result", ok, ergebnisse.length - ok));
    if (konflikte > 0) new Notice(t("todoSync.resultConflict", konflikte));
  }
```

- [ ] **Step 4a: `listEtags` exportierbar machen**

Der Sammler braucht die ETags einer Sammlung **ohne** die Rohdaten zu holen. Genau das tut
`listEtags` (`src/core/dav/sync.ts:31`) — es ist nur nicht exportiert:

```ts
export async function listEtags(t: Transport, col: DavCollection, opts: SyncOptions): Promise<Record<string, string>> {
```

Kein weiterer Eingriff in die DAV-Schicht: der Rumpf bleibt unverändert.

- [ ] **Step 4b: Die beiden Adapter schreiben**

Sie sind die einzige Stelle, an der Obsidian/DAV auf den puren `classifyTodos` trifft.
In `src/obsidian/command-flow.ts`:

```ts
  /**
   * Alle Notizen der todo-Profile mit ihrem zuletzt geschriebenen Stand.
   *
   * Zwei Quellen, und beide werden gebraucht: der Collection-State kennt die **gespiegelten**
   * Aufgaben (uid/href/etag/written), der Ordner des Profils zusätzlich die **neuen**, die es
   * dort noch nicht gibt. Ohne die zweite Quelle fehlte die Gruppe „neu" komplett.
   */
  private async sammleTodoNotizen(settings: PluginSettings): Promise<TodoNoteState[]> {
    const out: TodoNoteState[] = [];
    const gesehen = new Set<string>();
    for (const profile of settings.profiles.filter((p) => p.kind === "todo")) {
      for (const col of settings.collections.filter((c) => c.enabled && c.profileId === profile.id)) {
        const state = await this.deps.stateStore.load(col.id);
        for (const obj of Object.values(state?.objects ?? {})) {
          for (const [rid, note] of Object.entries(obj.notes)) {
            const file = this.app.vault.getAbstractFileByPath(note.path);
            if (!(file instanceof TFile)) continue;
            gesehen.add(note.path);
            out.push({
              path: note.path,
              frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter ?? {},
              prevWritten: note.written ?? {},
              uid: obj.uid,
              // hrefPath, nicht die volle URL — der Schluessel-Vertrag aus Task 4.
              href: hrefPath(resolveHref(col.href, obj.hrefPath)),
              etag: obj.etag,
              collectionId: col.id,
              ...(rid !== "" ? { recurrenceId: rid } : {}),
            });
          }
        }
        // Die noch nicht gespiegelten: alles im Profilordner, was der State nicht kennt.
        for (const file of this.app.vault.getMarkdownFiles()) {
          if (!file.path.startsWith(`${profile.folder}/`) || gesehen.has(file.path)) continue;
          const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
          if (fm[profile.uidField]) continue; // traegt eine dav_uid → gehoert dem State, nicht hierher
          out.push({ path: file.path, frontmatter: fm, prevWritten: {}, collectionId: col.id });
        }
      }
    }
    return out;
  }

  /**
   * Der Serverstand als ETag-Karte — **ein** Request je Sammlung, nicht einer je Notiz.
   *
   * Das ist der Grund, warum die vollstaendige Konfliktanzeige bezahlbar ist (Spec §3): bei
   * zwanzig geaenderten Aufgaben in einer Sammlung kostet sie einen Request, nicht zwanzig.
   */
  private async holeServerEtags(settings: PluginSettings, notes: TodoNoteState[]): Promise<Map<string, string>> {
    const karte = new Map<string, string>();
    const ids = new Set(notes.map((n) => n.collectionId).filter((x): x is string => !!x));
    for (const id of ids) {
      const col = settings.collections.find((c) => c.id === id);
      if (!col) continue;
      const account = settings.accounts.find((a) => a.id === col.accountId);
      if (!account) continue;
      try {
        const etags = await listEtags(this.deps.transportFor(account), col as unknown as DavCollection, {});
        for (const [href, etag] of Object.entries(etags)) karte.set(href, etag);
      } catch {
        // Eine unerreichbare Sammlung darf den ganzen Lauf nicht toeten: ihre Notizen landen
        // dann in "conflict" (kein ETag gefunden) und werden dem Nutzer vorgelegt, statt
        // stillschweigend ueberschrieben zu werden.
      }
    }
    return karte;
  }
```

- [ ] **Step 4c: Die beiden Planbauer**

```ts
  /** Baut den Kommando-Kontext einer Auswahlzeile — dieselbe Form wie `resolveTarget`, nur
   *  ohne die aktive Datei, weil der Sammellauf ueber viele Notizen geht. */
  private ctxFuer(a: TodoSyncAuswahl, settings: PluginSettings, raw?: string, etag?: string): CommandContext | undefined {
    const n = a.note.note;
    const col = settings.collections.find((c) => c.id === n.collectionId);
    const account = col ? settings.accounts.find((x) => x.id === col.accountId) : undefined;
    const profile = col ? settings.profiles.find((p) => p.id === col.profileId) : undefined;
    if (!col || !account || !profile) return undefined;
    return {
      now: this.deps.now(), profile, collection: col, account,
      target: { kind: "todo", source: `${account.id}:${col.id}`, ...(n.href ? { href: n.href } : {}), ...(n.uid ? { uid: n.uid } : {}) } as CommandTarget,
      ...(raw !== undefined ? { raw } : {}),
      ...(etag !== undefined ? { etag } : {}),
      rand: Math.random,
    };
  }

  private async bauTodoHandEdit(a: TodoSyncAuswahl, settings: PluginSettings): Promise<CommandPlan | null> {
    const n = a.note.note;
    if (!n.collectionId || !n.href) return null;
    const obj = await this.ladeRohdaten(n.collectionId, n.href);
    if (!obj) return null;
    const ctx = this.ctxFuer(a, settings, obj.raw, obj.etag);
    if (!ctx) return null;
    return planPushHandEdits(ctx, n.frontmatter, n.prevWritten).plan;
  }

  private bauTodoCreate(a: TodoSyncAuswahl, settings: PluginSettings): CommandPlan | undefined {
    const ctx = this.ctxFuer(a, settings);
    return ctx ? planTodoCreate(ctx, a.note.note.frontmatter) : undefined;
  }
```

`ladeRohdaten(collectionId, href)` liest das gespeicherte `raw`/`etag` aus dem Collection-State —
denselben Weg geht `resolveTarget` bereits über `resolved.obj`.

⚠️ Beide Bauer sind hier asynchron bzw. kontextabhängig, `planlisteAus` ist es nicht. Die
Auflösung steht in Step 4 (`sendeAuswahl`): erst alle Pläne in eine Map bauen, dann
`planlisteAus` mit zwei Lookups aufrufen. So bleibt die Zuordnungsregel pur und testbar.

- [ ] **Step 5: Kommando in `src/main.ts` registrieren**

```ts
    this.addCommand({
      id: "todo-sync",
      name: t("todoSync.title"),
      checkCallback: (checking: boolean) => {
        // Erscheint nur, wenn es ueberhaupt eine aktivierte Aufgaben-Sammlung gibt.
        const moeglich = this.settings.profiles.some((p) => p.kind === "todo");
        if (checking) return moeglich;
        if (moeglich) void this.commandFlow.runTodoSync();
        return true;
      },
    });
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/obsidian/todo-sync-flow.test.ts && npm run gate`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/obsidian/command-flow.ts src/main.ts tests/obsidian/todo-sync-flow.test.ts
git commit -m "feat(commands): Sammel-Kommando fuer den Aufgaben-Abgleich verdrahten"
```

---

### Task 10: Integrationstest gegen Radicale

Geschwisterzweig zum vorhandenen VEVENT-Test (`tests/integration/radicale.test.ts:48-61`).

**Files:**
- Modify: `tests/integration/radicale.test.ts`

- [ ] **Step 1: Test ergänzen**

```ts
  it("VTODO: Neuanlage mit If-None-Match, Aenderung mit If-Match, Konflikt mit veraltetem Etag", async () => {
    const href = `${col.href}m6b-todo-1.ics`;
    const ics = newTodoIcs({ uid: "m6b-todo-1@cn", summary: "Steuer vorbereiten", due: "2026-09-30" }, { now: new Date() });

    const neu = await putObject(t, href, ics, { ifNoneMatch: true }, "text/calendar");
    expect(neu.ok).toBe(true);

    const geholt = await getObject(t, href);
    expect(geholt.raw).toContain("BEGIN:VTODO");

    const erledigt = applyTodoMutation(geholt.raw, { kind: "status", status: "COMPLETED" }, { now: new Date() });
    const geaendert = await putObject(t, href, erledigt, { ifMatch: geholt.etag }, "text/calendar");
    expect(geaendert.ok).toBe(true);

    // Derselbe (jetzt veraltete) Etag ein zweites Mal → 412.
    const konflikt = await putObject(t, href, erledigt, { ifMatch: geholt.etag }, "text/calendar");
    expect(konflikt).toMatchObject({ ok: false, conflict: true, status: 412 });

    await deleteObject(t, href, geaendert.etag ?? "");
  });
```

- [ ] **Step 2: Run**

Run: `npm run test:integration`
Expected: PASS (startet Radicale per `uvx`)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/radicale.test.ts
git commit -m "test(integration): VTODO schreiben, aendern und Konflikt gegen Radicale"
```

---

### Task 11: Handproben im laufenden Obsidian

Erweitert den vorhandenen Abschnitt `todo` des Treibers. **Ein Prüfpunkt muss den Defekt fangen können, nicht nur den Erfolg bestätigen** — sonst ist er keiner.

**Files:**
- Modify: `scripts/gui-smoke.ts`
- Modify: `docs/SMOKE.md`

- [ ] **Step 1: Prüfpunkte ergänzen**

- **P25** — Kommando vorhanden: `app.commands.commands["calendar-notes:todo-sync"]` existiert, wenn ein Todo-Profil aktiv ist.
- **P26** — Nach einer Frontmatter-Änderung an einer gespiegelten Aufgabe (`status` → erledigt) listet das Modal genau diese eine Notiz in der Gruppe „im Vault geändert".
- **P27** — Senden schreibt: die Ressource auf dem Server trägt danach `STATUS:COMPLETED`, und die Notiz trägt ein neues `dav_etag`.
- **P28** — Eine Notiz ohne `dav_uid` im Aufgabenordner erscheint in der Gruppe „neu" und wird nach dem Senden mit `dav_uid` versehen.
- **P29 (der scharfe)** — **Bewahrungsprobe:** Server auf `CANCELLED` setzen, Frontmatter unverändert auf dem darauf abbildenden Wert lassen, Kommando fahren → die Aufgabe erscheint **nicht** in der Liste, und der Server steht danach unverändert auf `CANCELLED`.

  ⚠️ P29 ist der Prüfpunkt, der den Defekt fängt: ohne die Bewahrungsregel (Task 1) würde die Aufgabe in der Liste auftauchen und nach dem Senden auf `COMPLETED` springen. Ein Punkt, der nur „Senden hat funktioniert" prüft, wäre in genau diesem Fall grün.

- [ ] **Step 2: Baseline festhalten**

Run: `npm run smoke:gui -- --section todo`
Expected: die bestehenden 9 Prüfpunkte grün — **vor** der Erweiterung, damit ein späteres Grün von „anders grün" unterscheidbar bleibt.

- [ ] **Step 3: Lauf mit den neuen Punkten**

Run: `npm run smoke:gui -- --section todo`
Expected: 14/14

- [ ] **Step 4: Gegenprobe für P29**

`reverseStatus` vorübergehend auf naives Umkehren zurückdrehen (Schritt 1 der Regel auskommentieren), bauen, deployen, Plugin neu laden, Lauf wiederholen.
Expected: **P29 rot**, die übrigen grün. Danach zurückdrehen und erneut grün messen.

⚠️ Vor jedem Lauf den CDP-Lock nehmen (`--exclusive focus`, `--ttl 300`) und **unmittelbar nach dem letzten Lauf** freigeben. Läuft schon ein Fenster des Staging-Vaults, mitnutzen statt neu starten.

- [ ] **Step 5: `docs/SMOKE.md` nachziehen und committen**

```bash
git add scripts/gui-smoke.ts docs/SMOKE.md
git commit -F <datei>
```

---

### Task 12: Dokumentation und Abschluss

**Files:**
- Modify: `AGENTS.md`, `CHANGELOG.md`
- Modify: `../REGISTRY.md` (Dach)

- [ ] **Step 1: `AGENTS.md`** — Abschnitt zur Rückrichtung: die Bewahrungsregel (warum nicht umgekehrt wird), die Busy-Falle (warum `executeCommandPlans` existiert), und dass Löschen Nicht-Ziel bleibt.

- [ ] **Step 2: `CHANGELOG.md`** unter `[Unreleased]`, in Nutzersprache: Aufgaben wandern jetzt in beide Richtungen; ein Kommando zeigt alle Unterschiede und fragt je Zeile; abgebrochene Aufgaben werden nicht zu erledigten umgedeutet.

- [ ] **Step 3: `REGISTRY.md`** — Eintrag für die bewahrende Rückabbildung einer nicht-injektiven Vokabular-Abbildung. Das ist der wiederverwendbare Kern: **jedes** Plugin, das eine konfigurierbare Wertabbildung rückwärts anwendet, hat dieses Problem.

⚠️ Vor dem Eintrag prüfen, ob mailstone die dortige TaskNotes-Zeile bereits präzisiert hat (Abstimmung vom 2026-09-05) — nicht doppelt schreiben.

- [ ] **Step 4: Volles Gate + Merge**

Run: `npm run gate && npm run test:integration`

---

## Offene Punkte, die dieser Plan bewusst NICHT löst

- **Löschen auf dem Server** (Spec §8). Kein Task erzeugt einen `delete`-Plan.
- **Sammel-Sync für Termine und Kontakte.** Ansatz A: erst ein zweiter echter Anwendungsfall zeigt, wie die Verallgemeinerung aussehen muss.
- **`api.apiVersion` nachmessen** — von mailstone am 2026-09-05 gemeldet, hier nicht bestätigt (`docs/tasknotes-api.md`). Beim Live-Kontakt in Task 11 mitnehmen, wenn TaskNotes im Staging-Vault liegt.
