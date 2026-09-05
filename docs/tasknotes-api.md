# TaskNotes-Plugin-API — gemessene Form

**Gemessen am 2026-09-03 gegen TaskNotes 4.12.5** (`app.plugins.plugins.tasknotes.api`, lesend
über CDP, ein `Runtime.evaluate`). Diese Datei hält fest, was die API **tatsächlich** liefert —
nicht, was ihre Dokumentation verspricht. Grundlage für `src/obsidian/tasknotes.ts` und
`src/core/mirror/tasknotes-map.ts`.

⚠️ **`specVersion` ist ein Release Candidate** (`0.3.0-rc.3`, `runtimeApiVersion: 1`). Die Form
kann sich ändern; deshalb wird sie beim Ableiten ins Profil eingefroren, statt zur Laufzeit
konsultiert zu werden.

## `api.model.info()`

```json
{ "packageName": "@tasknotes/model", "specVersion": "0.3.0-rc.3", "runtimeApiVersion": 1 }
```

`api.hasCapability("catalog.read")` und `("model.read")` → beide `true`. Das ist unser Gate
(`src/obsidian/tasknotes.ts:107`).

⚠️ **Die Capability-Strings sind NICHT systematisch — ein aus dem Methodennamen abgeleiteter
String kann `false` liefern, obwohl die Methode existiert und funktioniert.** Gemessen von
`mailstone-81` am 2026-09-05 (hier nicht nachgemessen): `hasCapability("tasks.create")` → `false`,
während `api.tasks.create` eine funktionsfähige Funktion ist und `hasCapability("tasks.write")`
→ `true` sagt. Wer den naheliegenden String als Gate nimmt, sperrt sich bei intakter API lautlos
selbst aus.

Für uns folgenlos — `catalog.read` ist oben unabhängig gemessen —, aber die Lehre gilt über den
Anlass hinaus: **jeden Capability-String, den man neu benutzt, einmal gegen die Existenz der
Methode gegenprüfen**, statt ihn aus dem Namen zu bilden.

ⓘ **Ebenfalls von `mailstone-81` gemeldet (2026-09-05), hier nicht nachgemessen — betrifft uns
nicht, weil wir es nirgends nutzen:** `model.validateTask` taugt **nicht** als Vorab-Prüfung
einer Erstellungs-Eingabe. Es verlangt ein vollständiges `TaskInfo` (`status`, `dateCreated`,
`dateModified`) und meldet `missing_required` auch für Eingaben, mit denen `tasks.create`
klaglos anlegt — es prüft den Zustand **nach** dem Anlegen, nicht die Eingabe **davor**. Der
Name legt das Gegenteil nahe; deshalb steht es hier.

ⓘ **Ebenfalls von `mailstone-81` gemeldet, hier noch nicht nachgemessen:** `api.apiVersion`
existiert als eigenes Feld am api-Objekt (`number`, Wert 1) — neben `model.info().runtimeApiVersion`.
Zwei Versionsfelder nebeneinander; diese Datei kannte bisher nur das zweite. Beim nächsten
Live-Kontakt mit laufendem TaskNotes selbst messen und diesen Vorbehalt dann streichen.

## `api.model.config().statuses`

Jeder Eintrag: `id`, `value`, `label`, `color`, `isCompleted`, `excludeFromCycle`, `order`,
`autoArchive`, `autoArchiveDelay`. **Der Statuswert für das Frontmatter steht unter `value`.**

Standardkonfiguration:

| `value` | `order` | `isCompleted` |
|---|---|---|
| `none` | 0 | false |
| `open` | 1 | false |
| `in-progress` | 2 | false |
| `done` | 3 | true |

## `api.model.config().priorities`

Jeder Eintrag: `id`, `value`, `label`, `color`, **`weight`** — **nicht `order`**.

| `value` | `weight` |
|---|---|
| `none` | 0 |
| `low` | 1 |
| `normal` | 2 |
| `high` | 3 |

## `api.model.config().defaults` — der Schlüssel zur richtigen Abbildung

```json
{ "status": "open", "priority": "normal", "taskTag": "task" }
```

⚠️ **Ohne dieses Feld bildet man falsch ab, und zwar plausibel falsch.** Die naheliegende Regel
„der nicht abgeschlossene Status mit der kleinsten `order`" liefert `none` — das ist aber der
*nicht gesetzt*-Wert, kein Arbeitszustand. Dasselbe bei den Prioritäten: der kleinste `weight`
ist `none`, nicht `low`.

`none` lässt sich **nicht** strukturell an seinen eigenen Feldern erkennen (`isCompleted: false`,
`excludeFromCycle: false` wie bei den echten offenen Status; die Namensgleichheit `"none"` wäre
ein Namensvergleich und damit genau das, was die Abbildung vermeiden muss). `defaults` beantwortet
die Frage stattdessen von außen: TaskNotes selbst sagt, welchen Status eine neue Aufgabe bekommt.

## `api.model.config().taskIdentification`

```json
{ "method": "tag", "tag": "task", "propertyName": "", "propertyValue": "", "excludedFolders": "…" }
```

Das Wertfeld für `method: "property"` heißt **`propertyValue`**, nicht `value`. `excludedFolders`
ist eine kommaseparierte Zeichenkette, keine Liste.

## `api.model.config().fieldMapping`

Ein Objekt `logischer Schlüssel → frontmatterKey` mit 35 Einträgen; die meisten bilden auf sich
selbst ab, einige nicht (`recurrenceAnchor → recurrence_anchor`, `occurrenceDate → occurrence_date`).
Enthält unter anderem `title`, `status`, `priority`, `due`, `scheduled`, `completedDate`,
`recurrence`, `timeEstimate`, `contexts`, `projects`.

**Kein Eintrag für einen Fortschritt in Prozent** — `PERCENT-COMPLETE` aus VTODO hat also kein
Ziel und wird nicht geschrieben.

## `api.catalog.fields()`

36 Felddefinitionen mit `id`, `label`, `valueType`, `source`, `writable`, `required`,
`frontmatterKey`, `queryable`, `sortable`, `groupable`, `supportedOperators`, `aliases`.

⚠️ **`frontmatterKey` fehlt bei manchen Feldern** (z. B. `archived`) — die Eigenschaft ist
optional und darf nicht ungeprüft gelesen werden.

## Was hier NICHT angefasst wird

`api.tasks.*` in jeder Form. Gelesen wird ausschließlich `model` und `catalog`; sobald
calendar-notes eine Aufgabe anlegte oder änderte, verwaltete es sie — und das besitzt TaskNotes.
