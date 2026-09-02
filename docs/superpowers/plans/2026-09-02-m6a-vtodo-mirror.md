# M6a — VTODO-Spiegel (Server → Vault) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aufgaben (VTODO) einer CalDAV-Sammlung erscheinen als Notizen im Vault, die TaskNotes als Aufgaben erkennt.

**Architecture:** Dritter Objekttyp neben Kontakt und Termin, gebaut als Geschwisterzweig: eigenes ical-Modul (`todo.ts`) mit geteilten Zeit-Helfern (`time.ts`), eigenes Profil (`kind: "todo"`), eigene Erkennung (`holdsTodos`). Das Notiz-Format wird einmalig aus der TaskNotes-Plugin-API abgeleitet und als gewöhnliches Profil eingefroren — zur Laufzeit gibt es keine Kopplung. Einbahnig: kein `PUT`, keine Kommandos (das ist M6b).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), `ical.js`, vitest, esbuild, Obsidian Plugin API 1.13.

**Spec:** `docs/superpowers/specs/2026-09-02-vtodo-aufgaben-design.md` (ergänzt `2026-08-22-calendar-notes-design.md`)

## Global Constraints

- `src/core/**` ist obsidian-, DOM- und node-frei. Geprüft von `npm run check:pure`. Die TaskNotes-API wird **ausschließlich** aus `src/obsidian/**` angefasst.
- Nur `api.model` und `api.catalog` lesen — **niemals `api.tasks.*`** in irgendeiner Form.
- Alle sichtbaren Texte über `src/i18n/strings.ts`, Schlüssel alphabetisch je Bereich, **EN und DE gemeinsam** pflegen. Kein Fachbegriff ohne Auflösung (UI-STANDARD §10).
- Keine absoluten Pfade unter `/Users/…` in getrackten `*.md` — `node scripts/check-no-abs-paths.mjs` läuft als erster Teil von `npm test`.
- Keine `eslint-disable`-Kommentare (`scripts/check-no-inline-disables.mjs`).
- Kit-Module (`src/vendor/code-kit/**`) nie von Hand ändern, nur über `tools/sync-kit.sh`.
- Volles Gate vor jedem Merge: `npm run gate` (lint, 3× typecheck, test, check:pure, build).
- Commit-Messages: Conventional Commits, deutsch, einzeilige Betreffzeile. Mehrzeilige Messages über `git commit -F <datei>` — direktes Quoten mehrzeiliger Messages löst den CDP-Guard aus.

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/core/ical/time.ts` | **neu** — `timeToIso`, `timeOfProp`, `calAddress`: komponentenneutrale Helfer, aus `event.ts` extrahiert |
| `src/core/ical/event.ts` | **ändern** — importiert die drei Helfer statt sie zu definieren; re-exportiert `timeToIso` für Bestandsaufrufer |
| `src/core/ical/todo.ts` | **neu** — `TodoData`, `parseTodos()` |
| `src/core/mirror/profile.ts` | **ändern** — `ProfileKind` um `"todo"`, `TODO_SERVER_FIELDS`, `defaultTodoProfile()`, `statusMap`/`priorityMap`/`taskNotesSpec` in `MappingProfile`, `validateProfile` |
| `src/core/mirror/kind.ts` | **neu** — `assertNever()`: erzwingt erschöpfende Fallunterscheidung über `ProfileKind` |
| `src/core/mirror/todo-values.ts` | **neu** — `todoValues()`: `TodoData` + Profil → Frontmatter-Werte; `renderTodoBlock()` |
| `src/core/mirror/tasknotes-map.ts` | **neu** — pure Vorschlagsregel: TaskNotes-Statuslisten → `statusMap`/`priorityMap` |
| `src/core/settings.ts` | **ändern** — `holdsTodos()`, `defaultTodoProfile()` in Defaults und Normalisierung |
| `src/core/mirror/apply.ts` | **ändern** — Todo-Zweig, eigene Fensterregel |
| `src/obsidian/tasknotes.ts` | **neu** — Konsumenten-Seitenmodul: liest die TaskNotes-API defensiv, liefert ein reines Ergebnisobjekt |
| `src/obsidian/settings-tab.ts` | **ändern** — Profilauswahl statt Sammlungsfilter; Knopf „Profil aus TaskNotes erzeugen" |
| `src/i18n/strings.ts` | **ändern** — neue Schlüssel, EN + DE |

---

### Task 1: Messpunkt — legt Thunderbird seine Aufgaben in die VTODO-Sammlung?

**Files:** keine Code-Änderung. Ergebnis nach `docs/dav/befunde/mailbox-org.md`.

**Interfaces:**
- Consumes: ein eingerichtetes mailbox.org-Konto (Rollout Teil A, Task `Rollout ins echte Pallas`)
- Produces: eine belegte Ja/Nein-Aussage, auf die Task 6 und Task 11 sich stützen

> **Blockiert bis Rollout Teil A steht.** Ist das Konto noch nicht eingerichtet, wird diese Task
> zurückgestellt und der Plan startet bei Task 2 — Tasks 2–10 hängen nicht davon ab. **Vor Task 11
> (GUI-Smoke) muss sie geschlossen sein**, sonst prüft der Smoke eine Annahme.

- [ ] **Schritt 1: In Thunderbird eine Testaufgabe anlegen**

Aufgabenansicht öffnen, Aufgabe „VTODO-Messpunkt 2026-09-02" anlegen, Synchronisierung abwarten.

- [ ] **Schritt 2: Die Sammlungen des Kontos auflisten und ihr `supported-calendar-component-set` lesen**

Der Trockenlauf-Weg ohne laufendes Obsidian: `sync-preview` im Plugin öffnen und die Sammlungsliste
mit den Angaben in `docs/dav/befunde/mailbox-org.md` (Punkt 3) vergleichen. Notiere für **jede**
Sammlung des Kontos: `displayName`, `href`, gemeldete Komponenten.

- [ ] **Schritt 3: Die Testaufgabe zuordnen**

Feststellen, in welcher Sammlung die Aufgabe aus Schritt 1 gelandet ist.

**Abbruchkriterium:** Landet die Aufgabe in einer Sammlung, die **kein** `VTODO` in
`supported-calendar-component-set` meldet, trägt `holdsTodos()` (Task 6) nicht und der Zuschnitt
der Spec muss überarbeitet werden. **Dann hier anhalten und den Befund melden**, statt Task 6
anzupassen — die Erkennung ist die Grundlage, nicht ein Detail.

- [ ] **Schritt 4: Befund festhalten und committen**

Ergebnis als neuen nummerierten Punkt in `docs/dav/befunde/mailbox-org.md` ergänzen, mit Datum
und der Angabe, ob es gemessen oder nur beobachtet wurde. Keine Zugangsdaten.

```bash
git add docs/dav/befunde/mailbox-org.md
git commit -m "docs(dav): Thunderbird-Aufgaben landen in der VTODO-Sammlung — gemessen"
```

---

### Task 2: `time.ts` — die komponentenneutralen Helfer extrahieren

**Files:**
- Create: `src/core/ical/time.ts`
- Modify: `src/core/ical/event.ts:13-41` (die drei Funktionen entfernen, importieren, `timeToIso` re-exportieren)
- Test: `tests/core/ical/event.test.ts` (bestehend, muss unverändert grün bleiben)

**Interfaces:**
- Consumes: nichts
- Produces: `timeToIso(t: ICAL.Time, tzidFromProp?: string): { iso: string; tzid?: string }` · `timeOfProp(p: ICAL.Property): { iso: string; tzid?: string }` · `calAddress(p: ICAL.Property): Attendee` · `interface Attendee { email: string; name?: string; partstat?: string; role?: string; rsvp?: boolean }`

> **Reine Verschiebung. Kein Verhaltenswechsel, keine neue Zeile Logik.** Der Beleg dafür ist,
> dass die bestehenden Tests unverändert grün bleiben — deshalb wird hier kein neuer Test
> geschrieben. Wer hier „nebenbei" etwas verbessert, macht den Beleg wertlos.

- [ ] **Schritt 1: Baseline festhalten**

Run: `npm test`
Erwartung: `Test Files 57 passed`, `Tests 538 passed`. Diese Zahl notieren — sie muss am Ende identisch sein.

- [ ] **Schritt 2: `time.ts` anlegen**

```typescript
import ICAL from "ical.js";

export interface Attendee { email: string; name?: string; partstat?: string; role?: string; rsvp?: boolean }

/** ICAL.Time → ISO-Konvention dieses Plugins (s. Plan Task 8 der M1-Planung). tzid kommt notfalls aus dem übergebenen Property-Parameter. */
export function timeToIso(t: ICAL.Time, tzidFromProp?: string): { iso: string; tzid?: string } {
  if (t.isDate) return { iso: t.toString() }; // "2026-12-24"
  const base = t.toString(); // "2026-09-01T10:00:00"
  const zoneTzid = (t.zone as unknown as { tzid?: string } | undefined)?.tzid;
  if (zoneTzid === "UTC" || t.zone === ICAL.Timezone.utcTimezone) return { iso: base.endsWith("Z") ? base : `${base}Z` };
  const tzid = tzidFromProp ?? (zoneTzid && zoneTzid !== "floating" ? zoneTzid : undefined);
  if (tzid) return { iso: base, tzid };
  return { iso: base };
}

export function timeOfProp(p: ICAL.Property): { iso: string; tzid?: string } {
  const val = p.getFirstValue();
  const tzidParam = p.getParameter("tzid");
  const tzid = typeof tzidParam === "string" ? tzidParam : undefined;
  return timeToIso(val as ICAL.Time, tzid);
}

export function calAddress(p: ICAL.Property): Attendee {
  const raw = String(p.getFirstValue() ?? "");
  const email = raw.replace(/^mailto:/i, "").toLowerCase();
  const a: Attendee = { email };
  const cn = p.getParameter("cn");
  if (typeof cn === "string") a.name = cn;
  const ps = p.getParameter("partstat");
  if (typeof ps === "string") a.partstat = ps.toUpperCase();
  const role = p.getParameter("role");
  if (typeof role === "string") a.role = role.toUpperCase();
  const rsvp = p.getParameter("rsvp");
  if (typeof rsvp === "string") a.rsvp = rsvp.toUpperCase() === "TRUE";
  return a;
}
```

- [ ] **Schritt 3: `event.ts` umstellen**

In `src/core/ical/event.ts` die Definitionen von `Attendee`, `timeToIso`, `calAddress` und
`timeOfProp` löschen und durch diese Zeilen ersetzen (direkt unter dem `ICAL`-Import):

```typescript
import { calAddress, timeOfProp, timeToIso, type Attendee } from "./time";

export { timeToIso, type Attendee };
```

Der Re-Export ist nicht Bequemlichkeit: `timeToIso` und `Attendee` werden aus `ical/event`
importiert (u. a. `src/core/mirror/fields.ts`, `src/core/ical/recur.ts`). Ohne ihn wird aus einer
Verschiebung eine Änderung an fremden Dateien, und der Beleg aus Schritt 1 zerfällt.

- [ ] **Schritt 4: Belegen, dass sich nichts geändert hat**

Run: `npm test && npm run typecheck && npm run check:pure`
Erwartung: identische Zahl aus Schritt 1 (538 Tests), Typecheck ohne Fehler, `check:pure` grün.

- [ ] **Schritt 5: Commit**

```bash
git add src/core/ical/time.ts src/core/ical/event.ts
git commit -m "refactor(ical): komponentenneutrale Zeit-Helfer nach time.ts ziehen"
```

---

### Task 3: `todo.ts` — VTODO parsen

**Files:**
- Create: `src/core/ical/todo.ts`, `tests/core/ical/todo.test.ts`
- Create: `tests/fixtures/ical/todo-simple.ics`, `todo-minimal.ics`, `todo-done.ics`, `todo-recurring.ics`
- Test: `tests/core/ical/todo.test.ts`

**Interfaces:**
- Consumes: `timeOfProp`, `timeToIso` aus `src/core/ical/time.ts` (Task 2)
- Produces:
  ```typescript
  export interface TodoData {
    uid: string; summary: string; description?: string;
    start?: string; due?: string; allDay: boolean; tzid?: string;
    status?: string; percentComplete?: number; priority?: number;
    completed?: string; rrule?: string; categories: string[];
    lastModified?: string; sequence: number;
  }
  export function parseTodos(ics: string): TodoData[];
  export function isOpen(t: TodoData): boolean;
  ```

- [ ] **Schritt 1: Fixtures anlegen**

`tests/fixtures/ical/todo-simple.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VTODO
UID:todo-1@test
SUMMARY:Steuererklärung vorbereiten
DESCRIPTION:Belege sortieren
DTSTART;TZID=Europe/Berlin:20260902T090000
DUE;TZID=Europe/Berlin:20260930T170000
STATUS:IN-PROCESS
PERCENT-COMPLETE:40
PRIORITY:2
CATEGORIES:Finanzen,Privat
SEQUENCE:3
LAST-MODIFIED:20260902T120000Z
END:VTODO
END:VCALENDAR
```

`tests/fixtures/ical/todo-minimal.ics` — weder `DTSTART` noch `DUE`, nur das Pflichtfeld:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VTODO
UID:todo-min@test
SUMMARY:Irgendwann mal aufräumen
END:VTODO
END:VCALENDAR
```

`tests/fixtures/ical/todo-done.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VTODO
UID:todo-done@test
SUMMARY:Rechnung bezahlt
DUE;VALUE=DATE:20260815
STATUS:COMPLETED
PERCENT-COMPLETE:100
COMPLETED:20260814T183000Z
END:VTODO
END:VCALENDAR
```

`tests/fixtures/ical/todo-recurring.ics`:
```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VTODO
UID:todo-rec@test
SUMMARY:Müll rausbringen
DUE;TZID=Europe/Berlin:20260903T190000
RRULE:FREQ=WEEKLY;BYDAY=TH
STATUS:NEEDS-ACTION
END:VTODO
END:VCALENDAR
```

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

`tests/core/ical/todo.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseTodos, isOpen } from "../../../src/core/ical/todo";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fx = (n: string): string => readFileSync(join(__dirname, "../../fixtures/ical", n), "utf8");

describe("parseTodos", () => {
  it("liest alle Felder einer vollstaendigen Aufgabe", () => {
    const [t] = parseTodos(fx("todo-simple.ics"));
    expect(t).toMatchObject({
      uid: "todo-1@test",
      summary: "Steuererklärung vorbereiten",
      description: "Belege sortieren",
      start: "2026-09-02T09:00:00",
      due: "2026-09-30T17:00:00",
      tzid: "Europe/Berlin",
      status: "IN-PROCESS",
      percentComplete: 40,
      priority: 2,
      allDay: false,
      sequence: 3,
      lastModified: "2026-09-02T12:00:00Z",
    });
    expect(t!.categories).toEqual(["Finanzen", "Privat"]);
  });

  it("kommt ohne DTSTART und ohne DUE aus", () => {
    const [t] = parseTodos(fx("todo-minimal.ics"));
    expect(t).toMatchObject({ uid: "todo-min@test", start: undefined, due: undefined, allDay: false, sequence: 0 });
    expect(t!.status).toBeUndefined();
  });

  it("erkennt ein Datum ohne Uhrzeit als ganztaegig und liest COMPLETED", () => {
    const [t] = parseTodos(fx("todo-done.ics"));
    expect(t).toMatchObject({ due: "2026-08-15", allDay: true, status: "COMPLETED", percentComplete: 100, completed: "2026-08-14T18:30:00Z" });
  });

  it("gibt RRULE ohne Praefix zurueck", () => {
    const [t] = parseTodos(fx("todo-recurring.ics"));
    expect(t!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("liefert ein leeres Array fuer einen Kalender ohne VTODO", () => {
    expect(parseTodos(fx("simple.ics"))).toEqual([]);
  });

  it("wirft bei Muell", () => {
    expect(() => parseTodos("hallo")).toThrow();
  });
});

describe("isOpen", () => {
  it("fehlendes STATUS gilt als offen", () => {
    expect(isOpen(parseTodos(fx("todo-minimal.ics"))[0]!)).toBe(true);
  });
  it("IN-PROCESS ist offen, COMPLETED nicht", () => {
    expect(isOpen(parseTodos(fx("todo-simple.ics"))[0]!)).toBe(true);
    expect(isOpen(parseTodos(fx("todo-done.ics"))[0]!)).toBe(false);
  });
  it("CANCELLED ist nicht offen", () => {
    expect(isOpen({ uid: "x", summary: "s", allDay: false, status: "CANCELLED", categories: [], sequence: 0 })).toBe(false);
  });
});
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/ical/todo.test.ts`
Erwartung: FAIL — `Failed to resolve import "../../../src/core/ical/todo"`.

- [ ] **Schritt 4: `todo.ts` implementieren**

```typescript
import ICAL from "ical.js";
import { timeOfProp } from "./time";

export interface TodoData {
  uid: string; summary: string; description?: string;
  start?: string; due?: string; allDay: boolean; tzid?: string;
  status?: string; percentComplete?: number; priority?: number;
  completed?: string; rrule?: string; categories: string[];
  lastModified?: string; sequence: number;
}

/** Offen heisst: der SERVER sagt nicht, dass es fertig ist. Fehlendes STATUS gilt als offen
 *  (RFC 5545 kennt keinen Default, und eine Aufgabe verschwinden zu lassen, weil ein Server das
 *  Feld nicht setzt, waere der teurere Fehler). */
export function isOpen(t: TodoData): boolean {
  const s = t.status?.toUpperCase();
  return s !== "COMPLETED" && s !== "CANCELLED";
}

function num(vt: ICAL.Component, name: string): number | undefined {
  const v = vt.getFirstPropertyValue(name);
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function todoFromComponent(vt: ICAL.Component): TodoData {
  const t: TodoData = {
    uid: String(vt.getFirstPropertyValue("uid") ?? ""),
    summary: String(vt.getFirstPropertyValue("summary") ?? ""),
    allDay: false, categories: [],
    sequence: Number(vt.getFirstPropertyValue("sequence") ?? 0),
  };
  // DTSTART und DUE sind bei VTODO BEIDE optional (RFC 5545 4.6.2) — anders als DTSTART bei VEVENT.
  const startProp = vt.getFirstProperty("dtstart");
  const dueProp = vt.getFirstProperty("due");
  const anchor = startProp ?? dueProp;
  if (anchor) {
    const a = timeOfProp(anchor);
    if (a.tzid) t.tzid = a.tzid;
    t.allDay = !a.iso.includes("T");
  }
  if (startProp) t.start = timeOfProp(startProp).iso;
  if (dueProp) t.due = timeOfProp(dueProp).iso;
  const str = (n: string): string | undefined => {
    const v = vt.getFirstPropertyValue(n);
    return v === null || v === undefined ? undefined : String(v);
  };
  const d = str("description");
  if (d) t.description = d;
  const s = str("status");
  if (s) t.status = s.toUpperCase();
  const pc = num(vt, "percent-complete");
  if (pc !== undefined) t.percentComplete = pc;
  const pr = num(vt, "priority");
  if (pr !== undefined) t.priority = pr;
  const compProp = vt.getFirstProperty("completed");
  if (compProp) t.completed = timeOfProp(compProp).iso;
  const rr = vt.getFirstProperty("rrule");
  if (rr) t.rrule = rr.toICALString().replace(/\r?\n[ \t]/g, "").replace(/^RRULE:/i, "");
  for (const p of vt.getAllProperties("categories")) for (const v of p.getValues()) t.categories.push(String(v));
  const lm = vt.getFirstProperty("last-modified");
  if (lm) t.lastModified = timeOfProp(lm).iso;
  return t;
}

export function parseTodos(ics: string): TodoData[] {
  const jcal: unknown = ICAL.parse(ics);
  if (!Array.isArray(jcal)) throw new Error("kein VCALENDAR");
  const root = new ICAL.Component(jcal);
  if (root.name !== "vcalendar" && root.name !== "vtodo") throw new Error("kein VCALENDAR");
  const comps = root.name === "vtodo" ? [root] : root.getAllSubcomponents("vtodo");
  return comps.map(todoFromComponent);
}
```

- [ ] **Schritt 5: Tests laufen lassen**

Run: `npx vitest run tests/core/ical/todo.test.ts`
Erwartung: PASS, 9 Tests.

- [ ] **Schritt 6: Gate und Commit**

Run: `npm test && npm run check:pure`
Erwartung: 547 Tests grün (538 + 9), `check:pure` grün.

```bash
git add src/core/ical/todo.ts tests/core/ical/todo.test.ts tests/fixtures/ical/todo-*.ics
git commit -m "feat(ical): VTODO parsen — parseTodos und isOpen"
```

---

### Task 4: Fallunterscheidungen erschöpfend machen — **bevor** der Typ wächst

**Files:**
- Create: `src/core/mirror/kind.ts`, `tests/core/mirror/kind.test.ts`
- Modify: `src/core/mirror/apply.ts:78-84` · `src/core/commands/push-hand-edits.ts:125` · `src/core/commands/undo.ts:19-33` · `src/core/api/read.ts:80-94` · `src/obsidian/command-modal.ts:23` · `src/core/mirror/profile-from-note.ts:81-84,98` · `src/main.ts:63-70`

**Interfaces:**
- Consumes: nichts
- Produces: `export function assertNever(x: never, hinweis: string): never` · `export function nichtUnterstuetzt(kind: string, hinweis: string): never`

> **Der Kern dieser Task, und der Grund für ihre Reihenfolge.** `ProfileKind` wird an sieben
> Stellen binär ausgewertet — `kind === "event" ? … : …`, wobei der else-Zweig „contact" *meint*
> und „alles andere" *bedeutet*. Ein dritter Wert fiele dort still in den Kontakt-Pfad: kein
> Fehler, kein Test rot, falsche Notizen. Das ist die Bauart aus `_docs/LESSONS.md` 2026-08-08
> („ein erweiterter Union-Typ hinterlässt an jeder fallunterscheidenden Stelle eine Lücke, und
> nichts meldet sie").
>
> **Deshalb erst härten, dann erweitern.** Diese Task ändert kein Verhalten und macht alle Stellen
> erschöpfend, solange der Typ noch zwei Werte hat — `assertNever` kompiliert dann überall. In
> Task 5 wächst der Typ, und der **Compiler listet exakt die Stellen auf**, die eine Entscheidung
> brauchen. Ein Werkzeug statt Sorgfalt: eine vergessene Stelle wird unmöglich statt
> unwahrscheinlich.

- [ ] **Schritt 1: Den Test für `assertNever` schreiben**

`tests/core/mirror/kind.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { assertNever, nichtUnterstuetzt } from "../../../src/core/mirror/kind";

describe("assertNever", () => {
  it("wirft mit Hinweis und Wert, wenn zur Laufzeit doch etwas ankommt", () => {
    expect(() => assertNever("todo" as never, "Notiz-Plan")).toThrow(/Notiz-Plan.*todo/);
  });
});

describe("nichtUnterstuetzt", () => {
  it("wirft mit Hinweis und Sorte", () => {
    expect(() => nichtUnterstuetzt("todo", "Dateiname")).toThrow(/Dateiname.*todo/);
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/mirror/kind.test.ts`
Erwartung: FAIL — `Failed to resolve import`.

- [ ] **Schritt 3: `kind.ts` implementieren**

```typescript
/**
 * Erzwingt eine erschoepfende Fallunterscheidung ueber `ProfileKind`. Wird der Union-Typ
 * erweitert, meldet der Compiler JEDE Stelle, die den neuen Fall nicht behandelt — statt sie
 * still in den letzten else-Zweig laufen zu lassen (Lesson _docs/LESSONS.md 2026-08-08).
 *
 * Der Laufzeit-Wurf ist die zweite Haelfte: Profile kommen aus `data.json` und koennen einen
 * Wert tragen, den der Typ ausschliesst. Dann ist ein lauter Fehler richtig — eine Notiz nach
 * dem falschen Schema zu schreiben waere der teurere Ausgang.
 */
export function assertNever(x: never, hinweis: string): never {
  throw new Error(`${hinweis}: unbehandelte Profilsorte ${String(x)}`);
}

/**
 * Fuer Stellen, die eine Profilsorte KENNEN, aber (noch) nicht bedienen. Nimmt bewusst
 * `ProfileKind` statt `never`: `assertNever` verlangt, dass der Typ an der Aufrufstelle
 * erschoepft IST — sobald der Union-Typ waechst, ist er das dort nicht mehr, und der Aufruf
 * waere selbst ein Typfehler.
 *
 * Ein Wurf ist hier richtig: die Alternative waere, still in den Nachbarzweig zu laufen und
 * eine Notiz nach dem falschen Schema zu schreiben.
 */
export function nichtUnterstuetzt(kind: string, hinweis: string): never {
  throw new Error(`${hinweis}: Profilsorte ${kind} wird hier noch nicht unterstuetzt`);
}
```

- [ ] **Schritt 4: Test laufen lassen**

Run: `npx vitest run tests/core/mirror/kind.test.ts`
Erwartung: PASS, 2 Tests.

- [ ] **Schritt 5: `apply.ts` erschöpfend machen**

In `src/core/mirror/apply.ts`, den Block ab `if (kind === "contact") {` (Zeile 78) ersetzen:

```typescript
      if (kind === "contact") {
        const c = parseContact(obj.data);
        items.push({ data: c, uid: c.uid, values: contactValues(c), block: renderContactBlock(c) });
      } else if (kind === "event") {
        for (const e of parseEvents(obj.data)) {
          items.push({ data: e, uid: e.uid, ...(e.recurrenceId ? { recurrenceId: e.recurrenceId } : {}), values: eventValues(e, { resolveAttendee: i.resolveAttendee, attendeeLinks: i.profile.attendeeLinks }), block: renderEventBlock(e) });
        }
      } else {
        assertNever(kind, "Notiz-Plan");
      }
```

Import oben ergänzen: `import { assertNever } from "./kind";`

> ⚠️ **Zwei Stellen in derselben Datei bleiben absichtlich offen** — `apply.ts:85` (`inWindow`)
> und `apply.ts:149` (`stillInWindow`). Das sind **boolesche Ausdrücke**, keine
> Fallunterscheidungen; der Compiler meldet sie nach Task 5 **nicht**. Sie werden in **Task 7**
> behandelt, wo die Fensterregel für Aufgaben entsteht. Hier nicht anfassen — ein
> `kind === "event"`, das man zu `kind !== "contact"` umschreibt, sieht nach Fortschritt aus und
> baut die Lücke fest ein.

- [ ] **Schritt 6: `push-hand-edits.ts` erschöpfend machen**

Zeile 125 ersetzen:
```typescript
  let plan: CommandPlan | null;
  if (ctx.profile.kind === "event") plan = planEventHandEdits(ctx, frontmatter, keys, skipped);
  else if (ctx.profile.kind === "contact") plan = planContactHandEdits(ctx, frontmatter, keys, skipped);
  else assertNever(ctx.profile.kind, "Hand-Edits");
```
Import ergänzen: `import { assertNever } from "../mirror/kind";`

- [ ] **Schritt 7: `undo.ts` erschöpfend machen**

In `src/core/commands/undo.ts` bleibt der `if (ctx.profile.kind === "event") { … return … }`-Block
unverändert. Direkt **danach**, vor `const beforeContact = …`, einfügen:
```typescript
  if (ctx.profile.kind !== "contact") assertNever(ctx.profile.kind, "Undo");
```
Import ergänzen: `import { assertNever } from "../mirror/kind";`

- [ ] **Schritt 8: `read.ts` erschöpfend machen**

In `src/core/api/read.ts` den `} else {`-Zweig ab Zeile 87 zu `} else if (profile.kind === "contact") {`
machen und danach ergänzen:
```typescript
    } else {
      assertNever(profile.kind, "API-Lesen");
    }
```
Import ergänzen: `import { assertNever } from "../mirror/kind";`

- [ ] **Schritt 9: `command-modal.ts` erschöpfend machen**

⚠️ **Hier gilt NICHT das `undo.ts`-Muster.** `initialValuesFor` hat im Event-Zweig **kein** frühes
`return`: der Block befüllt `out` und fällt zum gemeinsamen `return out;` am Funktionsende durch.
Eine nachgeschaltete `assertNever`-Zeile würde deshalb auch für `kind === "event"` laufen und
werfen. Es gilt die `read.ts`-Form — der `else` wird zu `else if`, der dritte Zweig kommt dahinter:

```typescript
  if (ctx.profile.kind === "event") {
    // Event-Block unverändert
  } else if (ctx.profile.kind === "contact") {
    // Kontakt-Block unverändert
  } else {
    assertNever(ctx.profile.kind, "Kommando-Vorbelegung");
  }
  return out;
```
Import ergänzen: `import { assertNever } from "../core/mirror/kind";`

> Belegt am 2026-09-02: die ursprüngliche Fassung dieses Schritts trug das `undo.ts`-Muster und
> ließ 3 von 8 Tests in `tests/obsidian/command-modal.test.ts` fallen
> (`Kommando-Vorbelegung: unbehandelte Profilsorte event`). Ob ein Zweig früh zurückkehrt, ist
> keine Formalie — es entscheidet, ob die Wächterzeile erreichbar ist.

- [ ] **Schritt 10: `profile-from-note.ts` erschöpfend machen**

Die drei Ternäre ersetzen:
```typescript
function synonymsFor(kind: ProfileKind): Record<string, string> {
  if (kind === "contact") return CONTACT_SYNONYMS;
  if (kind === "event") return EVENT_SYNONYMS;
  return assertNever(kind, "Profil aus Notiz (Synonyme)");
}
function serverFieldsFor(kind: ProfileKind): readonly string[] {
  if (kind === "contact") return CONTACT_SERVER_FIELDS;
  if (kind === "event") return EVENT_SERVER_FIELDS;
  return assertNever(kind, "Profil aus Notiz (Serverfelder)");
}
function baseProfileFor(kind: ProfileKind): MappingProfile {
  if (kind === "contact") return defaultContactProfile();
  if (kind === "event") return defaultEventProfile();
  return assertNever(kind, "Profil aus Notiz (Basis)");
}
```
Zeile 98 wird zu `const base = baseProfileFor(kind);`. Import ergänzen: `import { assertNever } from "./kind";`

- [ ] **Schritt 11: `main.ts` erschöpfend machen**

`getItemText` in `ProfileKindSuggestModal` ersetzen:
```typescript
  getItemText(kind: ProfileKind): string {
    if (kind === "contact") return t("adopt.kind.contact");
    if (kind === "event") return t("adopt.kind.event");
    return assertNever(kind, "Profilsorten-Auswahl");
  }
```
Import ergänzen: `import { assertNever } from "./core/mirror/kind";`

- [ ] **Schritt 12: Belegen, dass sich nichts geändert hat**

Run: `npm run gate`
Erwartung: alles grün, **549 Tests** (547 aus Task 3 + 2 neue). Kein Test musste angepasst werden — das ist der Beleg, dass diese Task kein Verhalten geändert hat. Musste doch einer angepasst werden, ist etwas schiefgegangen: zurückrollen und die Stelle einzeln ansehen.

- [ ] **Schritt 13: Commit**

```bash
git add src/core/mirror/kind.ts tests/core/mirror/kind.test.ts src/core/mirror/apply.ts src/core/commands/push-hand-edits.ts src/core/commands/undo.ts src/core/api/read.ts src/obsidian/command-modal.ts src/core/mirror/profile-from-note.ts src/main.ts
git commit -m "refactor(mirror): ProfileKind-Fallunterscheidungen erschoepfend machen"
```

---

### Task 5: `ProfileKind` um `"todo"` erweitern — der Compiler zeigt die Lücken

**Files:**
- Modify: `src/core/mirror/profile.ts` · `src/core/settings.ts:88,120` · `src/core/commands/target.ts:24-37` · `src/core/api/read.ts` · `src/main.ts:63-65`
- Test: `tests/core/mirror/profile.test.ts`, `tests/core/commands/target.test.ts`

**Interfaces:**
- Consumes: `assertNever` aus `src/core/mirror/kind.ts` (Task 4)
- Produces:
  ```typescript
  export type ProfileKind = "contact" | "event" | "todo";
  export const TODO_SERVER_FIELDS: readonly string[];
  export function defaultTodoProfile(): MappingProfile;
  // MappingProfile zusaetzlich (nur bei kind "todo" belegt):
  //   statusMap?: { needsAction: string; inProcess: string; completed: string; cancelled: string };
  //   priorityMap?: { high: string; normal: string; low: string };
  //   taskNotesSpec?: string;
  ```

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An `tests/core/mirror/profile.test.ts` anhängen:
```typescript
import { defaultTodoProfile, TODO_SERVER_FIELDS } from "../../../src/core/mirror/profile";

describe("defaultTodoProfile", () => {
  it("ist ein gueltiges Profil mit kind todo", () => {
    const p = defaultTodoProfile();
    expect(p.kind).toBe("todo");
    expect(validateProfile(p).ok).toBe(true);
  });

  it("bildet jedes Serverfeld ab oder setzt es ausdruecklich auf null", () => {
    const p = defaultTodoProfile();
    for (const f of TODO_SERVER_FIELDS) expect(Object.hasOwn(p.fields, f)).toBe(true);
  });

  it("traegt eine Statusabbildung und eine Prioritaetsabbildung", () => {
    const p = defaultTodoProfile();
    expect(p.statusMap).toEqual({ needsAction: "open", inProcess: "in-progress", completed: "done", cancelled: "done" });
    expect(p.priorityMap).toEqual({ high: "high", normal: "normal", low: "low" });
  });

  it("kollidiert nicht mit den anderen Default-Profilen", () => {
    const ids = [defaultContactProfile().id, defaultEventProfile().id, defaultTodoProfile().id];
    expect(new Set(ids).size).toBe(3);
  });

  it("validateProfile akzeptiert kind todo und weist Unsinn ab", () => {
    expect(validateProfile({ ...defaultTodoProfile(), kind: "aufgabe" }).ok).toBe(false);
  });

  it("validateProfile verwirft eine unvollstaendige statusMap", () => {
    const bad = { ...defaultTodoProfile(), statusMap: { needsAction: "open", inProcess: "in-progress", completed: "done" } };
    expect(validateProfile(bad).ok).toBe(false);
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/mirror/profile.test.ts`
Erwartung: FAIL — `defaultTodoProfile is not a function`.

- [ ] **Schritt 3: `profile.ts` erweitern**

`ProfileKind` und `MappingProfile` ändern:
```typescript
export type ProfileKind = "contact" | "event" | "todo";

export interface StatusMap { needsAction: string; inProcess: string; completed: string; cancelled: string }
export interface PriorityMap { high: string; normal: string; low: string }
```
In `MappingProfile` ergänzen (nach `attendeeLinks`):
```typescript
  /** Nur bei kind "todo": VTODO-Zustand → TaskNotes-Statuswert. Wird abgeleitet (§5 der Spec),
   *  nie im Code geraten. */
  statusMap?: StatusMap;
  priorityMap?: PriorityMap;
  /** Die beim Ableiten gelesene TaskNotes-specVersion — macht einen API-Bruch sichtbar. */
  taskNotesSpec?: string;
```

Serverfelder und Default-Profil ergänzen:
```typescript
export const TODO_SERVER_FIELDS = ["title", "due", "start", "allday", "tzid", "description", "status", "priority", "percent", "completed", "rrule", "categories", "last_modified"] as const;

export function defaultTodoProfile(): MappingProfile {
  return {
    id: "default-todo", name: "Tasks (default)", kind: "todo", folder: "Tasks", filename: "{title}", ...IDENTITY,
    fields: {
      title: "title", due: "due", start: "scheduled", allday: "all_day", tzid: null,
      description: null, status: "status", priority: "priority", percent: null,
      completed: "completedDate", rrule: "recurrence", categories: "tags", last_modified: null,
    },
    onCreate: { type: "task" }, body: "block", attendeeLinks: false,
    statusMap: { needsAction: "open", inProcess: "in-progress", completed: "done", cancelled: "done" },
    priorityMap: { high: "high", normal: "normal", low: "low" },
  };
}
```

> Die Werte dieses Default-Profils sind **Annahmen** (die am 2026-09-01 gemessene
> TaskNotes-Standardkonfiguration). Es ist der Fallback für „TaskNotes nicht installiert"; wer es
> installiert hat, drückt in Task 9 den Ableitungs-Knopf und bekommt seine eigenen Werte.
> `cancelled` zeigt hier bewusst auf denselben Wert wie `completed` — die Standardkonfiguration
> hat nur einen abgeschlossenen Status. Genau diese Kollision macht Task 8 sichtbar.

In `validateProfile` die `kind`-Prüfung ersetzen und die neuen Felder validieren:
```typescript
  const kind = o["kind"];
  if (kind !== "contact" && kind !== "event" && kind !== "todo") errors.push("kind muss contact, event oder todo sein");
```
Vor dem `if (errors.length)`-Abschluss ergänzen:
```typescript
  const strMap = <K extends string>(raw: unknown, keys: readonly K[], label: string): Record<K, string> | undefined => {
    if (raw === undefined) return undefined;
    if (!raw || typeof raw !== "object") { errors.push(`${label} ist kein Objekt`); return undefined; }
    const src = raw as Record<string, unknown>;
    const out = {} as Record<K, string>;
    for (const k of keys) {
      const v = src[k];
      if (typeof v !== "string" || v.length === 0) { errors.push(`${label}.${k} fehlt oder ist leer`); return undefined; }
      out[k] = v;
    }
    return out;
  };
  const statusMap = strMap(o["statusMap"], ["needsAction", "inProcess", "completed", "cancelled"] as const, "statusMap");
  const priorityMap = strMap(o["priorityMap"], ["high", "normal", "low"] as const, "priorityMap");
  const specRaw = o["taskNotesSpec"];
  if (specRaw !== undefined && typeof specRaw !== "string") errors.push("taskNotesSpec muss ein String sein");
```
und im Rückgabeobjekt anhängen:
```typescript
      ...(statusMap ? { statusMap } : {}), ...(priorityMap ? { priorityMap } : {}),
      ...(typeof specRaw === "string" ? { taskNotesSpec: specRaw } : {}),
```

- [ ] **Schritt 4: Den Compiler die Lücken auflisten lassen**

Run: `npm run typecheck`
Erwartung: **FEHLER — und das ist das Ergebnis dieses Schritts.** Die gemeldeten Stellen abschreiben; erwartet werden mindestens `src/core/commands/target.ts:34` (`ProfileKind` fließt in `FrontmatterTarget.kind: "event" | "contact"`) sowie jede `assertNever`-Stelle aus Task 4. Findet der Compiler **weniger** Stellen als Task 4 gehärtet hat, ist eine Härtung nicht wirksam — dann dort nachsehen, nicht weitergehen.

- [ ] **Schritt 5: Die Lücken einzeln entscheiden**

`src/core/commands/target.ts` — Aufgaben haben in M6a keine Kommandos. Vor dem `return` einfügen:
```typescript
    // Aufgaben-Kommandos kommen mit M6b. Bis dahin erzeugt ein Todo-Profil kein Kommando-Ziel —
    // sonst liefe eine Aufgabe in `planContactHandEdits`, weil Kommandos ihren eigenen,
    // zweiwertigen `kind` fuehren (commands/types.ts).
    if (profile.kind === "todo") continue;
```

`src/core/api/read.ts` — den `assertNever(profile.kind, "API-Lesen")`-Zweig ersetzen:
```typescript
    } else if (profile.kind === "todo") {
      // Aufgaben werden ueber die Plugin-API v1 NICHT ausgeliefert: `ApiObjectKind` ist
      // "event" | "contact" | "any", und den veroeffentlichten Union-Typ zu erweitern waere ein
      // Vertragsbruch. Siehe Spec 2026-09-02, § 11.
      continue;
    } else {
      assertNever(profile.kind, "API-Lesen");
    }
```

`src/main.ts` — den Modal-Typ eingrenzen, statt einen Anzeigetext für eine nie angebotene Sorte
zu erfinden. `ProfileKindSuggestModal` und `createProfileFromNote` auf `NoteProfileKind` umstellen:
```typescript
/** "Profil aus Notiz" gibt es fuer Aufgaben bewusst nicht: dort ist der Weg der
 *  Ableitungs-Knopf aus TaskNotes (Spec § 5), der die Wertevokabulare mitbringt. Der engere
 *  Typ haelt `getItemText` erschoepfend, ohne einen Text fuer eine unerreichbare Sorte. */
type NoteProfileKind = Exclude<ProfileKind, "todo">;
```
`FuzzySuggestModal<ProfileKind>` → `FuzzySuggestModal<NoteProfileKind>`, `getItems(): NoteProfileKind[]`,
`getItemText(kind: NoteProfileKind)`, `onChoose`/`onChooseItem` und `createProfileFromNote(kind: NoteProfileKind, …)`
ziehen mit. `getItemText` bleibt damit unverändert aus Task 4 gültig.

**Die übrigen fünf Stellen brauchen jede einen `todo`-Zweig — auch die, die zur Laufzeit
unerreichbar sind.** `assertNever(x: never)` verlangt, dass der Typ dort `never` **ist**;
„kann nicht vorkommen" genügt dem Compiler nicht. Ohne diese Zweige endet Task 5 nicht mit
grünem Gate.

`src/core/mirror/apply.ts` — Verhalten kommt in Task 7:
```typescript
      } else if (kind === "todo") {
        nichtUnterstuetzt(kind, "Notiz-Plan");
      } else {
        assertNever(kind, "Notiz-Plan");
      }
```

`src/core/mirror/filename.ts` — Verhalten kommt ebenfalls in Task 7. `noteBasename` erweitern und
`filenameSubs` vorläufig abfangen:
```typescript
export function filenameSubs(kind: ProfileKind, data: ContactData | EventData | TodoData): Record<string, string> {
  if (kind === "contact") { /* unverändert */ }
  if (kind === "todo") return nichtUnterstuetzt(kind, "Dateiname");
  /* Event-Teil unverändert */
}
export function noteBasename(profile: MappingProfile, data: ContactData | EventData | TodoData): string {
```

`src/core/commands/push-hand-edits.ts` — bleibt so bis M6b:
```typescript
  else if (ctx.profile.kind === "todo") nichtUnterstuetzt(ctx.profile.kind, "Hand-Edits");
  else assertNever(ctx.profile.kind, "Hand-Edits");
```

`src/core/commands/undo.ts` — die Zeile aus Task 4 ersetzen (dort kehrt der Event-Zweig früh zurück):
```typescript
  if (ctx.profile.kind === "todo") nichtUnterstuetzt(ctx.profile.kind, "Undo");
  else if (ctx.profile.kind !== "contact") assertNever(ctx.profile.kind, "Undo");
```

`src/obsidian/command-modal.ts` — hier liegt die `read.ts`-Form vor (kein frühes `return`), also
den dritten Zweig ergänzen:
```typescript
  } else if (ctx.profile.kind === "todo") {
    nichtUnterstuetzt(ctx.profile.kind, "Kommando-Vorbelegung");
  } else {
    assertNever(ctx.profile.kind, "Kommando-Vorbelegung");
  }
```

`src/core/mirror/profile-from-note.ts` — alle drei Funktionen:
```typescript
  if (kind === "todo") return nichtUnterstuetzt(kind, "Profil aus Notiz");
  return assertNever(kind, "Profil aus Notiz (…)");
```

> Diese drei Kommando-Stellen sind zur Laufzeit **unerreichbar**, weil `targetFromFrontmatter`
> Todo-Profile aussortiert (oben in diesem Schritt). Der Wurf ist trotzdem das richtige
> Verhalten: greift die Aussortierung eines Tages nicht mehr, ist ein lauter Fehler besser als
> eine Aufgabe, die durch `planContactHandEdits` läuft.

- [ ] **Schritt 6: `defaultTodoProfile` in die Settings aufnehmen**

In `src/core/settings.ts` den Import um `defaultTodoProfile` erweitern, dann Zeile 88 und Zeile 120:
```typescript
    profiles: [defaultContactProfile(), defaultEventProfile(), defaultTodoProfile()],
```
```typescript
  for (const def of [defaultContactProfile(), defaultEventProfile(), defaultTodoProfile()]) {
```

- [ ] **Schritt 7: Belegen, dass ein Todo-Profil kein Kommando-Ziel erzeugt**

An `tests/core/commands/target.test.ts` anhängen:
```typescript
import { defaultTodoProfile } from "../../../src/core/mirror/profile";

it("ein Todo-Profil erzeugt kein Kommando-Ziel (Kommandos kommen mit M6b)", () => {
  const todoCol = { ...EVENT_COLLECTION, id: "c9", profileId: "default-todo" };
  const settings = settingsWith({ collections: [todoCol], profiles: [defaultTodoProfile()] });
  const fm = { dav_source: "a1/c9", dav_uid: "todo-1@test" };
  expect(targetFromFrontmatter(settings, fm)).toBeUndefined();
});
```

> Der Test benutzt `EVENT_COLLECTION` als Vorlage und überschreibt `id` und `profileId`. Prüfe
> beim Schreiben, dass `sourceOf(todoCol)` tatsächlich `"a1/c9"` ergibt — steht die Sammlung
> unter einer anderen Konto-ID, ist der `dav_source`-Wert im Frontmatter anzupassen, sonst ist der
> Test grün, ohne etwas zu prüfen.

- [ ] **Schritt 8: Gate und Commit**

Run: `npm run gate`
Erwartung: alles grün, **555 Tests** (548 + 6 aus Schritt 1 + 1 aus Schritt 7).

```bash
git add src/core/mirror/profile.ts src/core/settings.ts src/core/commands/target.ts src/core/api/read.ts src/main.ts tests/core/mirror/profile.test.ts tests/core/commands/target.test.ts
git commit -m "feat(profile): ProfileKind um todo erweitern und Default-Aufgabenprofil anlegen"
```

---

### Task 6: `collectionSupports` — die Warnung wandert von der Sammlung an die Paarung

**Files:**
- Modify: `src/core/settings.ts:35-53` · `src/core/sync/service.ts:117` · `src/obsidian/settings-tab.ts:150,204` · `src/i18n/strings.ts`
- Test: `tests/core/settings.test.ts`, `tests/core/sync/service.test.ts`

**Interfaces:**
- Consumes: `ProfileKind` (Task 5), `assertNever` (Task 4)
- Produces: `export function collectionSupports(col: CollectionConfig, kind: ProfileKind): boolean` — ersetzt `holdsEvents()` an beiden Aufrufstellen. `holdsEvents` entfällt.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

An `tests/core/settings.test.ts` anhängen:
```typescript
import { collectionSupports, type CollectionConfig } from "../../src/core/settings";

describe("collectionSupports", () => {
  const cal = (components?: string[]): CollectionConfig => ({
    id: "c1", accountId: "a1", href: "https://dav.example/cal/", kind: "calendar",
    displayName: "Kalender", enabled: true, profileId: "default-event", readOnly: false,
    ...(components ? { components } : {}),
  });

  it("sagt der Server nichts, wird nichts ausgeschlossen", () => {
    expect(collectionSupports(cal(), "event")).toBe(true);
    expect(collectionSupports(cal(), "todo")).toBe(true);
  });

  it("eine VEVENT-Sammlung traegt Termine, aber keine Aufgaben", () => {
    expect(collectionSupports(cal(["VEVENT"]), "event")).toBe(true);
    expect(collectionSupports(cal(["VEVENT"]), "todo")).toBe(false);
  });

  it("eine VTODO-Sammlung traegt Aufgaben, aber keine Termine", () => {
    expect(collectionSupports(cal(["VTODO"]), "todo")).toBe(true);
    expect(collectionSupports(cal(["VTODO"]), "event")).toBe(false);
  });

  it("eine Sammlung, die beides meldet, traegt beides", () => {
    expect(collectionSupports(cal(["VEVENT", "VTODO"]), "event")).toBe(true);
    expect(collectionSupports(cal(["VEVENT", "VTODO"]), "todo")).toBe(true);
  });

  it("ein Adressbuch traegt Kontakte und sonst nichts", () => {
    const ab = { ...cal(), kind: "addressbook" as const, profileId: "default-contact" };
    expect(collectionSupports(ab, "contact")).toBe(true);
    expect(collectionSupports(ab, "event")).toBe(false);
    expect(collectionSupports(ab, "todo")).toBe(false);
  });

  it("ein Kalender traegt keine Kontakte", () => {
    expect(collectionSupports(cal(), "contact")).toBe(false);
  });
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/settings.test.ts`
Erwartung: FAIL — `collectionSupports is not a function`.

- [ ] **Schritt 3: `holdsEvents` durch `collectionSupports` ersetzen**

In `src/core/settings.ts` die Funktion `holdsEvents` samt ihrem Kommentarblock ersetzen:
```typescript
/**
 * Passt diese Sammlung zu einem Profil dieser Sorte? Nur `supported-calendar-component-set`
 * beantwortet das fuer Kalender — die Ressourcentyp-Angabe (`<c:calendar/>`) tut es NICHT:
 * mailbox.org fuehrt VEVENT und VTODO in getrennten Collections, die beide `calendar` sind
 * (Befund `docs/dav/befunde/mailbox-org.md`, Punkt 3).
 *
 * Sagt der Server nichts (Feld fehlt — Radicale etwa liefert es nicht zwingend), wird nichts
 * angenommen und die Paarung gilt als moeglich.
 *
 * Gefragt wird nach der PAARUNG, nicht nach der Sammlung allein: eine Aufgaben-Sammlung ist
 * nicht "unbrauchbar", sie passt nur nicht zu einem Termin-Profil. Liegt hier und nicht im Sync,
 * weil die Einstellungen dieselbe Frage beantworten muessen — ein Nutzer, dem die Zeile nichts
 * sagt, aktiviert sie und wartet auf einen Lauf, der wortlos uebersprungen wird.
 */
export function collectionSupports(col: CollectionConfig, kind: ProfileKind): boolean {
  if (kind === "contact") return col.kind === "addressbook";
  if (col.kind !== "calendar") return false;
  if (!col.components?.length) return true;
  const want = kind === "event" ? "VEVENT" : "VTODO";
  return col.components.some((c) => c.toUpperCase() === want);
}
```
Import ergänzen: `import { ... type ProfileKind } from "./mirror/profile";`

- [ ] **Schritt 4: Die beiden Aufrufstellen umstellen**

`src/core/sync/service.ts` — die Prüfung braucht jetzt das Profil und muss deshalb **hinter** dessen Auflösung. Zeile 117 löschen und den Block so ordnen:
```typescript
    if (!col.enabled) return skipped(col.id, dryRun, "disabled");
    const settings = this.deps.settings();
    const account = settings.accounts.find((a) => a.id === col.accountId);
    const profile = effectiveProfile(settings, col);
    if (!account || !profile) return skipped(col.id, dryRun, "no-profile");
    if (!collectionSupports(col, profile.kind)) return skipped(col.id, dryRun, "unsupported-components");
```
Import in Zeile 6 anpassen: `holdsEvents` → `collectionSupports`.

> Der Grund `"unsupported-components"` bleibt **unverändert** — er steht in den Ergebnistypen und
> wird in `preview-modal.ts` angezeigt. Ihn umzubenennen wäre eine zweite Änderung in derselben
> Runde und würde die Wirkung dieser hier verwischen.

`src/obsidian/settings-tab.ts` — `enabledDesc` bekommt das Profil:
```typescript
  private enabledDesc(c: CollectionConfig): string {
    const profile = effectiveProfile(this.host.settings, c);
    if (!profile || collectionSupports(c, profile.kind)) return t("settings.collections.enabledDesc");
    return t("settings.collections.enabledMismatch", (c.components ?? []).join(", "));
  }
```
Import anpassen: `holdsEvents` → `collectionSupports`, dazu `effectiveProfile` aus `../core/settings`.

- [ ] **Schritt 5: Neu entdeckte VTODO-Sammlungen bekommen das Aufgaben-Profil**

`src/obsidian/settings-tab.ts:204` ersetzen:
```typescript
        const isTodoOnly = dc.kind === "calendar" && dc.components?.length
          ? dc.components.some((x) => x.toUpperCase() === "VTODO") && !dc.components.some((x) => x.toUpperCase() === "VEVENT")
          : false;
        const profileId = dc.kind !== "calendar" ? "default-contact" : isTodoOnly ? "default-todo" : "default-event";
```

> **Nur bei „VTODO und **nicht** VEVENT".** Eine Sammlung, die beides meldet, bekommt weiter das
> Termin-Profil: das ist der Bestandsfall (Radicale, Nextcloud), und ihn stillschweigend auf
> Aufgaben umzustellen würde bestehende Vaults umhängen. Sammlungen werden ohnehin `enabled: false`
> angelegt — der Nutzer wählt.

- [ ] **Schritt 6: i18n-Schlüssel tauschen**

In `src/i18n/strings.ts` **beide** Wörterbücher: `settings.collections.enabledNoEvents` entfernen, `settings.collections.enabledMismatch` an alphabetisch richtiger Stelle einfügen.

EN:
```typescript
  "settings.collections.enabledMismatch": "This collection holds {0}, which does not match the selected mapping profile. Pick a matching profile — otherwise the sync skips it.",
```
DE:
```typescript
  "settings.collections.enabledMismatch": "Hier liegen {0} — das passt nicht zum gewählten Mapping-Profil. Wähle ein passendes Profil, sonst überspringt der Abgleich diesen Eintrag.",
```

Run: `npx vitest run tests/i18n/strings.test.ts`
Erwartung: PASS — der Test prüft, dass EN und DE dieselben Schlüssel tragen. Rot heißt: in einem der beiden Wörterbücher vergessen.

- [ ] **Schritt 7: Belegen, dass der Sync die falsche Paarung überspringt**

An `tests/core/sync/service.test.ts` anhängen — nach dem Muster der dortigen Fakes:
```typescript
it("ueberspringt eine VTODO-Sammlung, der ein Termin-Profil zugewiesen ist", async () => {
  const col = { ...EVENT_COLLECTION, components: ["VTODO"] };
  const { service, results } = makeService({ collections: [col] });
  await service.syncAll();
  expect(results()[0]).toMatchObject({ skipped: "unsupported-components" });
});
```

> `makeService` und `EVENT_COLLECTION` heißen in der Datei möglicherweise anders — **nimm die dort
> vorhandenen Helfer**, statt neue zu bauen. Der Test soll zeigen, dass die Paarung geprüft wird,
> nicht ein zweites Test-Gerüst etablieren.

- [ ] **Schritt 8: Gate und Commit**

Run: `npm run gate`
Erwartung: grün, **563 Tests** (556 + 6 + 1).

```bash
git add src/core/settings.ts src/core/sync/service.ts src/obsidian/settings-tab.ts src/i18n/strings.ts tests/core/settings.test.ts tests/core/sync/service.test.ts
git commit -m "feat(settings): Sammlung gegen die Profilsorte pruefen statt nur auf Termine"
```

---

### Task 7: Der Todo-Zweig im Spiegel — Werte, Block, Dateiname, Zeitfenster

**Files:**
- Create: `src/core/mirror/todo-values.ts`, `tests/core/mirror/todo-values.test.ts`
- Modify: `src/core/mirror/apply.ts` (Todo-Zweig + `inWindow` + `stillInWindow`) · `src/core/mirror/filename.ts:16` · `src/core/mirror/body.ts`
- Test: `tests/core/mirror/apply.test.ts`

**Interfaces:**
- Consumes: `TodoData`, `parseTodos`, `isOpen` (Task 3); `StatusMap`, `PriorityMap` (Task 5); `assertNever` (Task 4)
- Produces:
  ```typescript
  export function todoValues(t: TodoData, profile: MappingProfile): ManagedValues;
  export function renderTodoBlock(t: TodoData): string;
  export function todoInWindow(t: TodoData, w: { start: Date; end: Date }): boolean;
  ```

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`tests/core/mirror/todo-values.test.ts`:
```typescript
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
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/mirror/todo-values.test.ts`
Erwartung: FAIL — `Failed to resolve import`.

- [ ] **Schritt 3: `todo-values.ts` implementieren**

```typescript
import type { TodoData } from "../ical/todo";
import { isOpen } from "../ical/todo";
import type { MappingProfile } from "./profile";
import type { ManagedValues } from "./fields";

/** RFC 5545 3.8.1.9: 1–4 hoch, 5 normal, 6–9 niedrig, 0 = undefiniert. */
function priorityValue(p: MappingProfile, prio: number | undefined): string | undefined {
  if (prio === undefined || prio === 0) return undefined;
  const map = p.priorityMap;
  if (!map) return undefined;
  if (prio <= 4) return map.high;
  if (prio === 5) return map.normal;
  return map.low;
}

function statusValue(p: MappingProfile, status: string | undefined): string | undefined {
  const map = p.statusMap;
  if (!map) return undefined; // lieber nichts schreiben als eine geratene Vokabel
  switch (status?.toUpperCase()) {
    case "COMPLETED": return map.completed;
    case "CANCELLED": return map.cancelled;
    case "IN-PROCESS": return map.inProcess;
    default: return map.needsAction; // fehlendes STATUS gilt als offen (RFC kennt keinen Default)
  }
}

export function todoValues(t: TodoData, profile: MappingProfile): ManagedValues {
  const v: ManagedValues = {};
  const put = (serverField: string, value: string | number | boolean | string[] | undefined): void => {
    if (value !== undefined) v[serverField] = value;
  };
  put("title", t.summary);
  put("due", t.due);
  put("start", t.start);
  put("allday", t.allDay);
  put("tzid", t.tzid);
  put("description", t.description);
  put("status", statusValue(profile, t.status));
  put("priority", priorityValue(profile, t.priority));
  put("percent", t.percentComplete);
  put("completed", t.completed);
  put("rrule", t.rrule);
  put("last_modified", t.lastModified);
  if (t.categories.length) v["categories"] = t.categories;
  return v;
}

export function renderTodoBlock(t: TodoData): string {
  const zeilen: string[] = [];
  if (t.due) zeilen.push(`- Fällig: ${t.due}`);
  if (t.percentComplete !== undefined) zeilen.push(`- Fortschritt: ${t.percentComplete} %`);
  if (t.description) zeilen.push("", t.description);
  return zeilen.join("\n");
}

/**
 * Offene Aufgaben liegen IMMER im Fenster — eine Aufgabe ohne Datum liegt sonst in keinem, und
 * das Zeitfenster der Termine traegt hier nicht (Spec § 7). Erledigte und abgebrochene nur,
 * solange ihr Abschluss im Fenster liegt; fehlt COMPLETED, entscheidet LAST-MODIFIED, und fehlt
 * auch das, wird gespiegelt statt archiviert (nichts annehmen).
 */
export function todoInWindow(t: TodoData, w: { start: Date; end: Date }): boolean {
  if (isOpen(t)) return true;
  const stamp = t.completed ?? t.lastModified;
  if (!stamp) return true;
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return true;
  return d >= w.start && d <= w.end;
}
```

> `ManagedValues` wird aus `./fields` importiert. Trägt der Typ dort einen anderen Namen oder
> eine engere Wertemenge, **richte dich nach der vorhandenen Definition** und passe `put` an,
> statt einen zweiten Werte-Typ einzuführen.

- [ ] **Schritt 4: Tests laufen lassen**

Run: `npx vitest run tests/core/mirror/todo-values.test.ts`
Erwartung: PASS, 11 Tests.

- [ ] **Schritt 5: `filename.ts` für Aufgaben öffnen — ein zweiter zweiwertiger Typ**

⚠️ `filenameSubs` führt einen **eigenen** `kind: "contact" | "event"` und hat einen else-Zweig,
der Event annimmt. Er liest `e.start` und schickt es durch `/^(\d{4}-\d{2}-\d{2})…/.exec(...)`.
`TodoData.start` ist **optional** — eine Aufgabe ohne `DTSTART` würde dort werfen. Der Compiler
meldet die Stelle in Task 5, weil `profile.kind` in den engeren Typ fließt; behandelt werden muss
sie hier.

`src/core/mirror/filename.ts` — den `nichtUnterstuetzt`-Zweig aus Task 5 durch das echte
Verhalten ersetzen:
```typescript
export function filenameSubs(kind: ProfileKind, data: ContactData | EventData | TodoData): Record<string, string> {
  if (kind === "contact") {
    const c = data as ContactData;
    return { fn: c.fn ?? "", family: c.n?.family ?? "", given: c.n?.given ?? "", org: c.org?.[0] ?? "", uid: c.uid };
  }
  if (kind === "event") {
    const e = data as EventData;
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(e.start);
    return { title: e.summary ?? "", start_date: m?.[1] ?? "", start_time: m?.[2] ? `${m[2]}-${m[3]}` : "", uid: e.uid };
  }
  if (kind === "todo") {
    const td = data as TodoData;
    // start UND due sind bei VTODO optional — beide Platzhalter muessen leer sein duerfen,
    // statt zu werfen: ein Nutzer darf "{due_date} {title}" in ein Aufgaben-Profil schreiben.
    const sub = (iso: string | undefined): string => /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "")?.[1] ?? "";
    return { title: td.summary ?? "", start_date: sub(td.start), due_date: sub(td.due), uid: td.uid };
  }
  return assertNever(kind, "Dateiname");
}

export function noteBasename(profile: MappingProfile, data: ContactData | EventData | TodoData): string {
```
Imports ergänzen: `import type { TodoData } from "../ical/todo";`, `import { assertNever } from "./kind";`, `import type { ProfileKind } from "./profile";`

> **Was hier NICHT gebaut wird:** ein Fallback für eine Aufgabe ohne `SUMMARY`. Der Bestand
> erledigt das bereits — `buildFilename` bekommt `{ fallbacks: ["{uid}"], lastResort: "dav-object" }`,
> also greift bei leerem Titel die UID. Die Zusage aus Spec § 8 ist damit erfüllt, ohne eine Zeile.
> Ein zweiter Fallback daneben wäre eine zweite Wahrheit.

- [ ] **Schritt 5b: Den Dateinamen-Fall belegen**

An `tests/core/mirror/filename.test.ts` anhängen:
```typescript
it("eine Aufgabe ohne DTSTART und ohne DUE bekommt einen Namen statt eines Wurfs", () => {
  const [t] = parseTodos(fx("ical", "todo-minimal.ics"));
  expect(noteBasename(defaultTodoProfile(), t!)).toBe("Irgendwann mal aufräumen");
});

it("eine Aufgabe ohne SUMMARY faellt auf die UID zurueck", () => {
  const t = { uid: "todo-ohne@test", summary: "", allDay: false, categories: [], sequence: 0 };
  expect(noteBasename(defaultTodoProfile(), t)).toBe("todo-ohne@test");
});
```
(`parseTodos` und `defaultTodoProfile` mitimportieren.)

- [ ] **Schritt 6: Den Todo-Zweig in `apply.ts` einhängen**

Den `nichtUnterstuetzt`-Zweig aus Task 5 durch das echte Verhalten ersetzen:
```typescript
      } else if (kind === "todo") {
        for (const td of parseTodos(obj.data)) {
          items.push({ data: td, uid: td.uid, values: todoValues(td, i.profile), block: renderTodoBlock(td) });
        }
      } else {
        assertNever(kind, "Notiz-Plan");
      }
```
Imports ergänzen: `import { parseTodos } from "../ical/todo";` und `import { renderTodoBlock, todoInWindow, todoValues } from "./todo-values";`

- [ ] **Schritt 7: Die beiden Fenster-Ausdrücke ersetzen — die aus Task 4 offen gelassenen Stellen**

Eine benannte Funktion oberhalb der Plan-Schleife einfügen:
```typescript
/** Boolescher Ausdruck, deshalb vom Compiler NICHT als Fallunterscheidung erkannt — die
 *  Erschoepfung steht hier von Hand (Task 4 hat diese beiden Stellen bewusst offen gelassen). */
function objectInWindow(kind: ProfileKind, raw: string, w: Window | undefined): boolean {
  if (!w) return true;
  if (kind === "contact") return true;
  if (kind === "event") return eventOccursWithin(raw, w.start, w.end);
  if (kind === "todo") return parseTodos(raw).some((t) => todoInWindow(t, w));
  return assertNever(kind, "Zeitfenster");
}
```
Zeile 85 wird zu:
```typescript
      const inWindow = objectInWindow(kind, obj.data, i.timeWindow);
```
Zeile 149 wird zu:
```typescript
    const stillInWindow = i.timeWindow !== undefined && objectInWindow(kind, os.raw, i.timeWindow);
```

> ⚠️ Die zweite Stelle behält ihr `i.timeWindow !== undefined &&` davor: dort bedeutet „kein
> Fenster" das **Gegenteil** von oben (kein Fenster → nicht mehr im Fenster → echte Löschung).
> `objectInWindow` gibt bei fehlendem Fenster `true` zurück, deshalb bleibt der Vorgriff stehen.
> Ihn wegzukürzen kehrt die Löschlogik um.

- [ ] **Schritt 8: Den Spiegel-Plan für Aufgaben belegen**

An `tests/core/mirror/apply.test.ts` anhängen — nach dem Muster der dortigen Event-Tests:
```typescript
it("legt fuer eine offene Aufgabe eine Notiz an", () => {
  const p = defaultTodoProfile();
  const out = applyDelta({ ...baseInput(p), delta: { changed: [{ href: "/cal/t1.ics", data: read("ical/todo-simple.ics"), etag: "\"e1\"" }], deleted: [], outOfWindow: [] } });
  expect(out.plans.filter((x) => x.op === "create")).toHaveLength(1);
});

it("archiviert eine lange erledigte Aufgabe statt sie anzulegen", () => {
  const p = defaultTodoProfile();
  const alt = read("ical/todo-done.ics").replace("COMPLETED:20260814T183000Z", "COMPLETED:20200101T000000Z");
  const out = applyDelta({ ...baseInput(p), timeWindow: { start: new Date("2026-06-01T00:00:00Z"), end: new Date("2027-06-01T00:00:00Z") }, delta: { changed: [{ href: "/cal/t2.ics", data: alt, etag: "\"e2\"" }], deleted: [], outOfWindow: [] } });
  expect(out.plans.some((x) => x.op === "create")).toBe(false);
});
```

> `baseInput` und `read` heißen in der Datei möglicherweise anders — **die dort vorhandenen
> Helfer benutzen**. Der zweite Test hat keine bestehende Notiz, erwartet also *kein* `archive`,
> sondern schlicht *kein* `create`: es gibt nichts zu archivieren. Genau das ist die Zusicherung.

- [ ] **Schritt 9: Gate und Commit**

Run: `npm run gate`
Erwartung: grün, **578 Tests** (563 + 11 + 2 + 2).

```bash
git add src/core/mirror/todo-values.ts tests/core/mirror/todo-values.test.ts src/core/mirror/apply.ts src/core/mirror/filename.ts tests/core/mirror/filename.test.ts tests/core/mirror/apply.test.ts
git commit -m "feat(mirror): Aufgaben spiegeln — Werte, Block und eigene Fensterregel"
```

---

### Task 8: Die Vorschlagsregel — pure, testbar, ohne Kenntnis der Fremd-API

**Files:**
- Create: `src/core/mirror/tasknotes-map.ts`, `tests/core/mirror/tasknotes-map.test.ts`

**Interfaces:**
- Consumes: `StatusMap`, `PriorityMap` (Task 5)
- Produces:
  ```typescript
  export interface TnStatus { value: string; isCompleted: boolean; order: number }
  export interface TnPriority { value: string; order: number }
  export type MapWarning = "cancelled-collides-with-completed" | "no-completed-status" | "no-open-status" | "single-open-status";
  export function suggestStatusMap(statuses: readonly TnStatus[]): { map: StatusMap; warnings: MapWarning[] } | undefined;
  export function suggestPriorityMap(priorities: readonly TnPriority[]): { map: PriorityMap; warnings: MapWarning[] } | undefined;
  ```

> **Warum diese Task pur ist und vor dem Adapter kommt.** Die exakte Form, in der TaskNotes seine
> Status ausliefert, ist hier **nicht bekannt** — die Vorarbeit hat `isCompleted` und `order`
> gemessen, aber nicht, unter welchem Schlüssel der Statuswert selbst steht. Diese Task erfindet
> ihn deshalb nicht, sondern definiert einen **eigenen schmalen Eingabetyp**; Task 9 misst die
> echte Form und füllt ihn. So liegt die Urteilslogik in `src/core/**` (testbar, ohne Obsidian)
> und die Fremdform in einer einzigen Adapterdatei. Das ist das Konsumenten-Seitenmodul-Muster
> aus der Dach-REGISTRY.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`tests/core/mirror/tasknotes-map.test.ts`:
```typescript
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
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/core/mirror/tasknotes-map.test.ts`
Erwartung: FAIL — `Failed to resolve import`.

- [ ] **Schritt 3: `tasknotes-map.ts` implementieren**

```typescript
import type { PriorityMap, StatusMap } from "./profile";

/** Schmaler Eingabetyp: das MINDESTE, was die Vorschlagsregel braucht. Die Uebersetzung aus der
 *  TaskNotes-API passiert in `src/obsidian/tasknotes.ts` — hier liegt nur das Urteil, damit es
 *  ohne Obsidian und ohne installiertes Fremdplugin pruefbar ist. */
export interface TnStatus { value: string; isCompleted: boolean; order: number }
export interface TnPriority { value: string; order: number }

export type MapWarning =
  | "cancelled-collides-with-completed"
  | "no-completed-status"
  | "no-open-status"
  | "single-open-status";

const byOrder = <T extends { order: number }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.order - b.order);

/**
 * Vorschlag ueber `isCompleted` + `order` — NIE ueber Namensgleichheit: TaskNotes-Status sind frei
 * konfigurierbar, Gleichheit waere Zufall und braeche beim ersten Nutzer, der umbenennt.
 */
export function suggestStatusMap(statuses: readonly TnStatus[]): { map: StatusMap; warnings: MapWarning[] } | undefined {
  const offen = byOrder(statuses.filter((s) => !s.isCompleted));
  const fertig = byOrder(statuses.filter((s) => s.isCompleted));
  if (!offen.length || !fertig.length) return undefined;

  const warnings: MapWarning[] = [];
  const needsAction = offen[0]!.value;
  const inProcess = offen[1]?.value ?? needsAction;
  if (offen.length === 1) warnings.push("single-open-status");

  const completed = fertig[0]!.value;
  const cancelled = fertig[fertig.length - 1]!.value;
  if (completed === cancelled) warnings.push("cancelled-collides-with-completed");

  return { map: { needsAction, inProcess, completed, cancelled }, warnings };
}

/** Extreme nach aussen, Mitte in die Mitte — bei genau drei Stufen ist das die naheliegende
 *  Zuordnung, bei mehr bleibt sie definiert statt zu raten. */
export function suggestPriorityMap(priorities: readonly TnPriority[]): { map: PriorityMap; warnings: MapWarning[] } | undefined {
  const sorted = byOrder(priorities);
  if (!sorted.length) return undefined;
  const low = sorted[0]!.value;
  const high = sorted[sorted.length - 1]!.value;
  const normal = sorted[Math.floor((sorted.length - 1) / 2)]!.value;
  return { map: { high, normal, low }, warnings: [] };
}
```

- [ ] **Schritt 4: Tests laufen lassen**

Run: `npx vitest run tests/core/mirror/tasknotes-map.test.ts`
Erwartung: PASS, 12 Tests.

- [ ] **Schritt 5: Gate und Commit**

Run: `npm run gate`
Erwartung: grün, **590 Tests** (578 + 12).

```bash
git add src/core/mirror/tasknotes-map.ts tests/core/mirror/tasknotes-map.test.ts
git commit -m "feat(mirror): Vorschlagsregel fuer Status- und Prioritaetsabbildung"
```

---

### Task 9: Der Ableitungs-Knopf — TaskNotes lesen, Profil einfrieren

**Files:**
- Create: `src/obsidian/tasknotes.ts`, `tests/obsidian/tasknotes.test.ts`
- Modify: `src/obsidian/settings-tab.ts` (Knopf in der Profilgruppe) · `src/i18n/strings.ts`

**Interfaces:**
- Consumes: `suggestStatusMap`, `suggestPriorityMap`, `TnStatus`, `TnPriority`, `MapWarning` (Task 8); `defaultTodoProfile` (Task 5)
- Produces:
  ```typescript
  export interface TaskNotesReading {
    specVersion: string;
    statuses: TnStatus[];
    priorities: TnPriority[];
    identification: { method: "tag"; tag: string } | { method: "property"; propertyName: string; value: string };
    fieldKeys: Record<string, string>; // Serverfeld-Kandidat → frontmatterKey, nur beschreibbare Felder
  }
  export function readTaskNotes(app: unknown): TaskNotesReading | undefined;
  export function profileFromTaskNotes(reading: TaskNotesReading, base: MappingProfile, name: string, id: string): { profile: MappingProfile; warnings: MapWarning[] };
  ```

- [ ] **Schritt 1: Die echte Form der API messen — bevor Code dagegen geschrieben wird**

TaskNotes 4.12.5 muss im Ziel-Vault installiert und aktiv sein. In der Developer-Konsole des
laufenden Obsidian:
```javascript
const api = app.plugins.plugins.tasknotes.api;
console.log(JSON.stringify({
  info: api.model.info(),
  caps: ["catalog.read"].map((c) => [c, api.hasCapability(c)]),
  config: api.model.config(),
  fields: api.catalog.fields(),
}, null, 2));
```
**Notiere wörtlich:** unter welchem Schlüssel der Statuswert steht (`value`? `id`?), wie
`isCompleted` und `order` heißen, wie `taskIdentification` aufgebaut ist, und welche Einträge
`catalog.fields()` für Fälligkeit, Status, Priorität, Tags und Abschlussdatum führt. Das Ergebnis
gehört als Codeblock in `docs/dav/befunde/` — **nicht** in eine Task-Beschreibung, wo es beim
nächsten API-Bruch niemand wiederfindet.

> ⚠️ Ohne diesen Schritt ist Schritt 3 geraten. Die Vorarbeit hat `isCompleted` und `order`
> gemessen, aber **nicht** den Schlüssel des Statuswerts selbst.

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

`tests/obsidian/tasknotes.test.ts` — der Test benutzt ein **Fake-App-Objekt** in der in Schritt 1
gemessenen Form, kein installiertes TaskNotes:
```typescript
import { describe, it, expect } from "vitest";
import { readTaskNotes, profileFromTaskNotes } from "../../src/obsidian/tasknotes";
import { defaultTodoProfile } from "../../src/core/mirror/profile";

// Form aus Schritt 1. Weicht die gemessene Form ab, ist DIESES Objekt anzupassen — nicht der Test.
const fakeApp = (over: Record<string, unknown> = {}): unknown => ({
  plugins: { plugins: { tasknotes: { api: {
    hasCapability: (c: string) => c === "catalog.read",
    model: {
      info: () => ({ specVersion: "0.3.0-rc.3", runtimeApiVersion: 1 }),
      config: () => ({
        statuses: [{ value: "open", isCompleted: false, order: 1 }, { value: "in-progress", isCompleted: false, order: 2 }, { value: "done", isCompleted: true, order: 3 }],
        priorities: [{ value: "low", order: 1 }, { value: "normal", order: 2 }, { value: "high", order: 3 }],
        taskIdentification: { method: "tag", tag: "task" },
        ...over,
      }),
    },
    catalog: { fields: () => [
      { frontmatterKey: "due", valueType: "date", writable: true, required: false },
      { frontmatterKey: "status", valueType: "string", writable: true, required: true },
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
    expect(r.statuses).toHaveLength(3);
    expect(r.identification).toEqual({ method: "tag", tag: "task" });
  });

  it("faengt einen Wurf der Fremd-API ab, statt die Einstellungen mitzureissen", () => {
    const app = { plugins: { plugins: { tasknotes: { api: { hasCapability: () => true, model: { info: () => { throw new Error("kaputt"); } } } } } } };
    expect(readTaskNotes(app)).toBeUndefined();
  });
});

describe("profileFromTaskNotes", () => {
  it("friert specVersion und die Abbildungen ins Profil ein", () => {
    const { profile } = profileFromTaskNotes(readTaskNotes(fakeApp())!, defaultTodoProfile(), "Aus TaskNotes", "p-tn");
    expect(profile.taskNotesSpec).toBe("0.3.0-rc.3");
    expect(profile.statusMap).toEqual({ needsAction: "open", inProcess: "in-progress", completed: "done", cancelled: "done" });
    expect(profile.kind).toBe("todo");
    expect(profile.id).toBe("p-tn");
  });

  it("schreibt die Sichtbarkeit als Tag ins onCreate", () => {
    const { profile } = profileFromTaskNotes(readTaskNotes(fakeApp())!, defaultTodoProfile(), "n", "p1");
    expect(profile.onCreate["tags"]).toEqual(["task"]);
  });

  it("schreibt die Sichtbarkeit als Property ins onCreate", () => {
    const app = fakeApp({ taskIdentification: { method: "property", propertyName: "istAufgabe", value: "ja" } });
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
```
(`validateProfile` mitimportieren.)

- [ ] **Schritt 3: `tasknotes.ts` implementieren**

Gegen die in Schritt 1 gemessene Form. Leitplanken, die unabhängig von ihr gelten:

- **Jeder** Zugriff auf die Fremd-API in einem `try`/`catch`; ein Wurf ergibt `undefined`, nie eine Ausnahme nach oben. Ein Fremdplugin darf die Einstellungen nicht mitreißen.
- `hasCapability("catalog.read")` **vor** jedem anderen Aufruf.
- **Kein Zugriff auf `api.tasks`** — auch nicht lesend, auch nicht zum Prüfen der Existenz.
- Jedes gelesene Feld typprüfen (`typeof x === "string"`, `Array.isArray`), bevor es übernommen wird; ein unerwarteter Typ führt zu `undefined`, nicht zu einem halben Ergebnis.
- `profileFromTaskNotes` gibt `base` unverändert zurück, wo die Ableitung nichts hergibt — ein halb abgeleitetes Profil wäre schlechter als das Default.

- [ ] **Schritt 4: Tests laufen lassen**

Run: `npx vitest run tests/obsidian/tasknotes.test.ts`
Erwartung: PASS, 11 Tests.

- [ ] **Schritt 5: Den Knopf in die Profilgruppe hängen**

In `src/obsidian/settings-tab.ts` neben `addProfile()` eine zweite Aktion:
```typescript
  private addProfileFromTaskNotes(): void {
    const reading = readTaskNotes(this.host.app);
    if (!reading) { new Notice(t("notice.tasknotesUnavailable")); return; }
    const id = newId("profile", () => this.host.rand());
    const { profile, warnings } = profileFromTaskNotes(reading, defaultTodoProfile(), t("settings.profiles.fromTaskNotes.name"), id);
    this.host.settings = { ...this.host.settings, profiles: [...this.host.settings.profiles, profile] };
    void this.host.saveSettings();
    this.update();
    if (warnings.includes("cancelled-collides-with-completed")) new Notice(t("notice.tasknotesCancelledCollides"), 10000);
    else new Notice(t("notice.tasknotesProfileCreated", profile.name));
  }
```

**Dazu der Fehlerfall aus Spec § 8** — eine abweichende `specVersion` beim erneuten Ableiten.
Direkt vor dem Anlegen einfügen:
```typescript
    const frueher = this.host.settings.profiles.find((x) => x.kind === "todo" && x.taskNotesSpec !== undefined);
    if (frueher?.taskNotesSpec !== undefined && frueher.taskNotesSpec !== reading.specVersion) {
      // Die API ist ein Release Candidate. Der Bruch faellt genau HIER auf — im Sync nie, weil
      // das Profil eingefroren laeuft (Spec § 5). Deshalb sagen, statt still zu ueberschreiben.
      new Notice(t("notice.tasknotesSpecChanged", frueher.taskNotesSpec, reading.specVersion), 10000);
    }
```

> Der Hinweis **blockiert nicht** — das neue Profil entsteht trotzdem. Eine neuere API-Version ist
> der Normalfall, kein Fehler; nur soll sie nicht unbemerkt bleiben. Das alte Profil wird nicht
> angefasst: es läuft weiter mit seinen eingefrorenen Werten, und der Nutzer entscheidet, welches
> er der Sammlung zuweist.
Der Knopf gehört in die Profilgruppe (bei `addItem`, Zeile ~314) als zweite Aktion neben „Profil hinzufügen". **Er wird nur gerendert, wenn `readTaskNotes(...)` etwas liefert** — ein toter Knopf, der beim Drücken eine Fehlermeldung zeigt, ist schlechter als keiner.

- [ ] **Schritt 6: i18n-Schlüssel ergänzen (EN und DE)**

Sechs neue Schlüssel, alphabetisch einsortiert:

EN:
```typescript
  "notice.tasknotesCancelledCollides": "Profile created. Note: your setup has only one completed status, so cancelled and completed tasks will look the same in the vault.",
  "notice.tasknotesProfileCreated": "Profile \"{0}\" created from your TaskNotes settings.",
  "notice.tasknotesSpecChanged": "TaskNotes now reports version {1}; your earlier profile was built from {0}. The old profile keeps working with its stored values — check the new one before you switch.",
  "notice.tasknotesUnavailable": "TaskNotes was not found, or it does not allow reading its settings.",
  "settings.profiles.fromTaskNotes": "New profile from TaskNotes",
  "settings.profiles.fromTaskNotes.name": "Tasks (from TaskNotes)",
```
DE:
```typescript
  "notice.tasknotesCancelledCollides": "Profil angelegt. Hinweis: deine Konfiguration hat nur einen abgeschlossenen Status — abgebrochene und erledigte Aufgaben sehen im Vault deshalb gleich aus.",
  "notice.tasknotesProfileCreated": "Profil „{0}“ aus deinen TaskNotes-Einstellungen angelegt.",
  "notice.tasknotesSpecChanged": "TaskNotes meldet jetzt Version {1}; dein früheres Profil entstand aus {0}. Das alte läuft mit seinen gespeicherten Werten weiter — sieh dir das neue an, bevor du umstellst.",
  "notice.tasknotesUnavailable": "TaskNotes wurde nicht gefunden oder gibt seine Einstellungen nicht zum Lesen frei.",
  "settings.profiles.fromTaskNotes": "Neues Profil aus TaskNotes",
  "settings.profiles.fromTaskNotes.name": "Aufgaben (aus TaskNotes)",
```

> Die Kollisionswarnung nennt die **Folge im Vault**, nicht die Ursache in der Abbildung — „nur
> ein abgeschlossener Status" sagt einem Nutzer nichts, „sehen gleich aus" schon (UI-STANDARD §10:
> kein Fachbegriff ohne Auflösung).

Run: `npx vitest run tests/i18n/strings.test.ts`
Erwartung: PASS.

- [ ] **Schritt 7: Gate und Commit**

Run: `npm run gate`
Erwartung: grün, **601 Tests** (590 + 11).

```bash
git add src/obsidian/tasknotes.ts tests/obsidian/tasknotes.test.ts src/obsidian/settings-tab.ts src/i18n/strings.ts docs/dav/befunde/
git commit -m "feat(settings): Aufgabenprofil aus den TaskNotes-Einstellungen ableiten"
```

---

### Task 10: Radicale-Integrationstest mit einer Aufgaben-Sammlung

**Files:**
- Create: `fixtures/radicale/collections/collection-root/test/aufgaben/.Radicale.props`, `t1.ics`, `t2.ics`
- Modify: `tests/integration/radicale.test.ts`

**Interfaces:**
- Consumes: `parseTodos` (Task 3)
- Produces: nichts für spätere Tasks — dies ist eine Zusicherung, kein Baustein.

- [ ] **Schritt 1: Die Fixture-Sammlung anlegen**

Nach dem Vorbild von `fixtures/radicale/collections/collection-root/test/kalender/`. Die
`.Radicale.props` muss die Sammlung als Kalender mit VTODO-Komponente ausweisen — **die vorhandene
Datei der `kalender`-Sammlung als Vorlage lesen** und den Komponententyp anpassen, statt sie
neu zu erfinden.

Zwei Aufgaben-Dateien: eine offene (`STATUS:NEEDS-ACTION`, mit `DUE`) und eine erledigte
(`STATUS:COMPLETED`, mit `COMPLETED`). Inhalte analog zu `tests/fixtures/ical/todo-simple.ics`
und `todo-done.ics`, aber mit eigenen UIDs (`radicale-todo-1@test`, `radicale-todo-2@test`).

> ⚠️ Radicale/vobject ist streng: eine Datei, die es nicht annimmt, lässt den Server beim Start
> stillschweigend eine leere Sammlung ausliefern. Die Vorlage-Regel aus `AGENTS.md` (§ Was M1
> liefert) zum PHOTO-Padding zeigt die Sorte Problem.

- [ ] **Schritt 2: Den Test schreiben**

An `tests/integration/radicale.test.ts` anhängen, nach dem Muster der vorhandenen Fälle:
```typescript
it("entdeckt die Aufgaben-Sammlung und liest beide VTODOs", async () => {
  const col = collections.find((c) => c.displayName.toLowerCase().includes("aufgaben"));
  expect(col).toBeDefined();
  expect(col!.components?.map((x) => x.toUpperCase())).toContain("VTODO");
  const d = await refreshAndSync(col!);
  const uids = d.changed.map((o) => parseTodos(o.data)[0]!.uid).sort();
  expect(uids).toEqual(["radicale-todo-1@test", "radicale-todo-2@test"]);
});
```

> `collections` und `refreshAndSync` heißen in der Datei möglicherweise anders — **die dort
> vorhandenen Helfer benutzen**.

- [ ] **Schritt 3: Integrationstest laufen lassen**

Run: `npm run test:integration`
Erwartung: PASS. Meldet der Test 0 Objekte statt 2, hat Radicale die Fixture-Dateien verworfen (Schritt 1) — dann die Server-Ausgabe lesen, nicht den Test lockern.

- [ ] **Schritt 4: Commit**

```bash
git add fixtures/radicale/collections/collection-root/test/aufgaben tests/integration/radicale.test.ts
git commit -m "test(integration): Radicale-Fixture mit Aufgaben-Sammlung"
```

---

### Task 11: GUI-Smoke gegen ein laufendes Obsidian — mit Gegenprobe

**Files:**
- Modify: `scripts/gui-smoke.ts` (neuer Abschnitt), `fixtures/vault/` (Aufgaben-Profil im Fixture)
- Modify: `docs/SMOKE.md`

**Interfaces:**
- Consumes: alles aus Tasks 2–9; **Task 1 muss geschlossen sein**
- Produces: die belegte Aussage, dass der Spiegel im echten Obsidian trägt

> **Vor jedem Lauf den CDP-Lock nehmen** (Dach-`AGENTS.md`, § Staging-Vaults) — ohne ihn blockt der
> PreToolUse-Guard jeden Zugriff:
> ```
> python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label calendar-notes --intent "GUI-Smoke M6a" --exclusive focus
> …Lauf…
> python3 ~/.claude/hooks/obsidian-cdp-lock.py release
> ```
> `--exclusive focus`, nicht `quit-reload`: gemessen wird geklickt, und ein fremdes `activate`
> würde die Messung zerschießen. **Kein `quit`** — vorher `curl -s http://127.0.0.1:9222/json/list`
> lesen und sehen, wessen Vaults offen sind.

- [ ] **Schritt 1: Prüfpunkte schreiben**

Neuer Abschnitt (z. B. `--section todo`) mit fünf Prüfpunkten, nach der Form der vorhandenen Abschnitte in `scripts/gui-smoke.ts`:

1. Die Aufgaben-Sammlung erscheint in den Einstellungen und lässt sich aktivieren.
2. Ihr ist nach der Entdeckung automatisch das Aufgaben-Profil zugewiesen (`profileId === "default-todo"`).
3. Ein Sync legt für die offene Fixture-Aufgabe eine Notiz an — geprüft wird **die Existenz der Datei und ihr `dav_uid`**, nicht nur die Anzahl der Notizen.
4. Das Frontmatter der Notiz trägt `status: open` — also den **abgebildeten**, nicht den rohen VTODO-Wert.
5. Die Notiz trägt die Sichtbarkeitsmarkierung aus dem Profil (`tags` enthält `task`).

> Prüfpunkt 4 ist der eigentliche Punkt dieses Abschnitts. Ein Punkt auf „eine Notiz existiert"
> wäre auch dann grün, wenn die Statusabbildung gar nicht liefe — genau die Sorte struktureller
> Prüfung, die grün ist, während die Sache falsch ist.

- [ ] **Schritt 2: Lauf fahren**

Run: `npm run smoke:gui -- --section todo`
Erwartung: 5/5 grün.

- [ ] **Schritt 3: Denselben Lauf ein zweites Mal fahren**

Run: `npm run smoke:gui -- --section todo`
Erwartung: **wieder 5/5**. Ein einmal grüner Prüfpunkt ist noch nicht wiederholbar (Lesson 2026-08-30: ein Aufräumschritt, der einen Eintrag *leerte* statt ihn zu löschen, machte Lauf 2 rot). Ist Lauf 2 rot, liegt der Fehler im Aufräumen des Treibers, nicht im Plugin.

- [ ] **Schritt 4: Gegenprobe — den Defekt einbauen und rot messen**

In `src/core/mirror/todo-values.ts` die Funktion `statusValue` vorübergehend den **Rohwert**
zurückgeben lassen (`return status;`), bauen, deployen, Plugin neu laden, Abschnitt fahren.

Erwartung: **Prüfpunkt 4 wird rot, die Punkte 1–3 und 5 bleiben grün.** Bleibt 4 grün, misst er
die Abbildung nicht und muss geschärft werden — dann ist der Prüfpunkt der Befund, nicht das
Plugin. Danach die Änderung **zurücknehmen** (`git checkout -- src/core/mirror/todo-values.ts`),
neu bauen, deployen, und Schritt 2 erneut fahren.

> Eine Gegenprobe, die den Defekt nicht einbaut, beweist nichts und sieht aus wie eine, die nichts
> findet (Lesson 2026-08-18/apple-health).

- [ ] **Schritt 5: `docs/SMOKE.md` fortschreiben und committen**

Abschnitt, Prüfpunkte, beide Läufe und das Ergebnis der Gegenprobe eintragen — mit Datum.

```bash
git add scripts/gui-smoke.ts fixtures/vault docs/SMOKE.md
git commit -F <(printf 'test(smoke): Aufgaben-Spiegel im laufenden Obsidian belegen\n\nFuenf Pruefpunkte, zweimal gruen, Gegenprobe am Statuswert: mit rohem\nVTODO-Status wird Punkt 4 rot, die uebrigen bleiben gruen.\n')
```

---

### Task 12: Dokumentation und Abschluss

**Files:**
- Modify: `AGENTS.md` (neuer Abschnitt „Was M6a liefert"), `CHANGELOG.md`
- Modify (**Scope-Ausnahme, s. u.**): `../REGISTRY.md`

- [ ] **Schritt 1: `AGENTS.md` fortschreiben**

Nach „Was M5 liefert" einen Abschnitt „Was M6a liefert" in der Form der vorhandenen: die neuen Module, das Aufgaben-Profil, `collectionSupports` als Ablösung von `holdsEvents`, der Ableitungs-Knopf, die Testzahlen. **Dazu die zwei Sätze, die eine spätere Session braucht:** dass `assertNever` die Erweiterung von `ProfileKind` absichert und dass die zwei Fenster-Ausdrücke in `apply.ts` von Hand erschöpfend gehalten werden müssen, weil der Compiler sie nicht sieht.

- [ ] **Schritt 2: `CHANGELOG.md`**

Neuer Eintrag unter „Unreleased": Aufgaben aus CalDAV werden als Notizen gespiegelt, TaskNotes-Profil per Knopf ableitbar, einbahnig (Zurückschreiben folgt mit M6b).

- [ ] **Schritt 3: Registry-Eintrag im Dach**

> **Das ist eine Scope-Ausnahme** (Dach-`AGENTS.md`, § Zuschnitt): die REGISTRY liegt in
> `obsidian-plugins/`, nicht in diesem Repo. Sie ist legitim — der Katalog ist workspace-weit —,
> aber sie wird **benannt und dort committet**, nicht hier mitgenommen.

Zwei Zeilen, beide unter „Plugin-zu-Plugin (Zuständigkeits-Schnittstellen)":
- *Eine fremde Plugin-API einmalig ablesen und das Ergebnis einfrieren, statt sich zur Laufzeit an sie zu binden* → `calendar-notes/src/obsidian/tasknotes.ts` + `src/core/mirror/tasknotes-map.ts`
- *Einen Union-Typ erweitern, ohne stille Lücken zu hinterlassen* → `calendar-notes/src/core/mirror/kind.ts` (`assertNever`) — **Kit-Kandidat prüfen**, sobald ein zweites Repo dasselbe braucht

- [ ] **Schritt 4: Volles Gate, beide Remotes**

Run: `npm run gate && npm run test:integration`
Erwartung: alles grün.

```bash
git add AGENTS.md CHANGELOG.md
git commit -m "docs(agents): M6a dokumentieren — Aufgaben-Spiegel Server nach Vault"
git push origin main
git push github main
```

> ⚠️ **Beide Pushes sind nötig.** `calendar-notes` steht auf der Dach-Liste der Repos **ohne
> wirksamen Forgejo→GitHub-Mirror** (gemessen 2026-08-30). `git push origin` allein lässt GitHub
> zurückfallen. Danach prüfen: `git ls-remote github main` muss auf denselben Commit zeigen.

---

## Was M6a bewusst NICHT liefert

Kein `PUT`, keine Kommandos für Aufgaben, keine Erstanlage vom Vault aus, keine Auslieferung über
die Plugin-API v1, keine Instanz-Notizen für wiederkehrende Aufgaben. Alles davon ist M6b oder
ausdrückliches Nicht-Ziel (Spec § 11). Wer beim Bauen merkt, dass „das wäre jetzt leicht mit
dazu", hat den Schnitt verlassen — die Etappe endet an der Schreibrichtung.
