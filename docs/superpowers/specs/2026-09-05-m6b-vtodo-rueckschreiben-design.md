# calendar-notes — M6b: Aufgaben zurückschreiben (Vault → Server)

Anschluss an M6a (`2026-09-02-vtodo-aufgaben-design.md`), das den Spiegel **einbahnig**
Server → Vault gebaut hat. M6b schließt die Gegenrichtung.

## 0. Anlass — und eine Korrektur an der M6a-Spec

M6a spiegelt Aufgaben in den Vault. Was dort ankommt, ist tot: eine in TaskNotes abgehakte
Aufgabe bleibt auf dem Server offen, und eine im Vault entstandene Aufgabe erreicht Thunderbird
nie. Johannes' Anforderung nannte von Anfang an **beide** Richtungen.

⚠️ **Die M6a-Spec begründet den Etappenschnitt mit einer Annahme, die gemessen falsch ist.**
§2 dort sagt, M6b bringe „einen Schreibfall, den das Plugin noch nie hatte — die Erstanlage
ohne ETag". Am Code nachgesehen (2026-09-05):

| Behauptet | Gemessen |
|---|---|
| Erstanlage ohne ETag ist neu | `putObject(…, { ifNoneMatch: true }, …)` steht in `src/core/dav/client.ts:32` |
| — | `plan.createsNew` existiert; `src/core/sync/execute.ts:165` wählt danach den Header |
| — | **Zwei** Produktionskommandos nutzen den Pfad: `event.create`, `contact.create` |
| — | Unit-getestet (`tests/core/dav/client.test.ts:22`) **und** gegen Radicale (`tests/integration/radicale.test.ts:61`) |

Der Etappenschnitt bleibt trotzdem richtig — aus dem **zweiten** Grund, den §2 nennt: M6a
liefert die echten gespiegelten Daten, an denen M6b entworfen wird. Nur die Begründung „neuer
DAV-Fall" trägt nicht. **Wirklich neu ist genau eines: die Statusabbildung rückwärts** (§4).

Praktische Folge: M6b fasst die DAV-Schicht **nicht** an.

## 1. Zuständigkeitsgrenze — unverändert, und einmal geprüft

`api.model` und `api.catalog` werden gelesen, **`api.tasks.*` nie**. TaskNotes verwaltet
Aufgaben, calendar-notes transportiert sie. Das Zurückschreiben verletzt das nicht: es bewegt
Zustand zwischen zwei Klienten desselben Servers, und jeder Schreibvorgang ist ein vom Nutzer
ausgelöstes, bestätigtes Kommando.

**Geprüft am 2026-09-05 gegen die mailstone-Session** (Quelle: `mailstone-81`, deren Aussage,
von uns nicht nachgemessen): mailstone entwirft `mail.createTask` und wird `api.tasks.create()`
rufen — also das, was unsere Zeile ausschließt. Das ist **kein Widerspruch, sondern ein anderer
Fall**, und die tragende Achse ist nicht „einmalig vs. laufend", sondern **wer nach dem Aufruf
die Wahrheit hält**: mailstone übergibt einmal und lässt los (kein Rückverweis, kein Update,
kein Spiegel), TaskNotes besitzt das Ding danach vollständig — Delegation an die Quelle. Wir
spiegeln fortlaufend und müssten mit `tasks.*` einen fremden Bestand führen; das wäre
Verwaltung. Die REGISTRY-Zeile wird von mailstone entsprechend präzisiert, nicht abgeschwächt.

**Ebenfalls geprüft:** mailstone berührt CalDAV nicht (IMAP/SMTP, keine Kalender-Collections,
keine PUTs). Die einzige Berührung bleibt die bestehende Richtung — mailstone registriert sich
bei uns als iMIP-Transport.

## 2. Bedienung: ein Sammel-Kommando mit Auswahl

**Entscheidung (Johannes, 2026-09-05):** kein Weg über die jeweils geöffnete Notiz, sondern
**ein Kommando, das alle offenen Unterschiede auf einmal zeigt** — gruppiert, je Zeile
abhakbar, mit „alle annehmen" und „alle abwählen".

Der Grund gegen den Einzelweg ist Bedienbarkeit, nicht Prinzip: `push-hand-edits` arbeitet auf
der geöffneten Notiz. Wer in TaskNotes fünf Aufgaben abhakt, müsste fünf Notizen öffnen und
fünfmal ein Kommando rufen — ein Weg, den niemand benutzt, ist so gut wie keiner.

Das Kernprinzip bleibt vollständig gewahrt: explizites Kommando, Diff vor dem Senden, nichts
läuft still. Gebündelt wird die **Bestätigung**, nicht das Schreiben ohne sie.

**Drei Gruppen**, jede mit eigener Zusicherung:

| Gruppe | Bedeutung | Vorbelegung |
|---|---|---|
| Nur im Vault geändert | ETag stimmt, Frontmatter weicht ab | angehakt |
| Neu, noch nicht auf dem Server | keine `dav_uid` | angehakt |
| Auf beiden Seiten geändert | ETag veraltet **und** Frontmatter weicht ab | **nicht** angehakt |

Die Vorbelegung folgt einer Regel: **angehakt ist, was der Nutzer erkennbar gewollt hat.** Wer
in TaskNotes abhakt oder eine Aufgabe anlegt, hat gehandelt — der Upload ist die Fortsetzung
dieser Handlung, und ein versehentlicher ist billig zu korrigieren (die Aufgabe im anderen
Klienten löschen). Ein Konflikt dagegen ist kein Wunsch, sondern eine Lage: dort hat noch
niemand entschieden, also entscheidet auch die Vorbelegung nichts.

**Bausteine, die nicht erfunden werden:** `AdoptionModal` (`src/obsidian/adoption-modal.ts`)
liefert die Grammatik — Tabelle, Auswahl je Zeile, Sammelknopf, Abbrechen/Bestätigen;
`PlanPreviewModal` (`plan-preview-modal.ts`) liefert `diffRows()` und die Diff-Darstellung.
Das neue Modal ist deren Kreuzung: Adoptions-Liste außen, Diff-Zeilen innen.

## 3. Datenfluss und Module

1. **Sammeln (Vault):** Notizen aller `todo`-Profile lesen; je Notiz `handEditedKeys()` gegen
   den `prevWritten`-Stand. Notizen ohne `dav_uid` → Gruppe „neu".
2. **Sammeln (Server):** ein `sync-collection`-REPORT je betroffener Sammlung liefert alle
   ETags; für die abweichenden ein `multiget` (Batches à 50, `src/core/dav/sync.ts:15`) die
   Rohdaten. **Zwei Requests, nicht n** — das macht die vollständige Konfliktanzeige (§5)
   bezahlbar.
3. **Klassifizieren:** jede Aufgabe in genau eine der drei Gruppen.
4. **Zeigen:** das Modal aus §2.
5. **Schreiben:** je angehakter Zeile ein `CommandPlan`, alle zusammen durch
   `executeCommandPlans` (§5) — nicht je Plan einzeln, siehe die Busy-Falle dort.

| Datei | Art | Inhalt |
|---|---|---|
| `src/core/sync/todo-collect.ts` | neu | Sammeln + Klassifizieren, pur und transportfrei |
| `src/core/mirror/todo-reverse.ts` | neu | Frontmatter → VTODO (§4) |
| `src/core/ical/mutate.ts` | erweitert | `TodoMutation`, `applyTodoMutation`, `newTodoIcs` |
| `src/core/commands/push-hand-edits.ts` | erweitert | `planTodoHandEdits` + `TODO_SUPPORTED`; ersetzt `nichtUnterstuetzt` in Zeile 129 |
| `src/core/sync/execute.ts` | erweitert | `executeCommandPlans` (§5) |
| `src/obsidian/todo-sync-modal.ts` | neu | das Modal |

`src/core/**` bleibt obsidian-frei (`npm run check:pure`). Die DAV-Schicht wird nicht angefasst.

## 4. Die Rückwärts-Abbildung — die einzige echte Härte

Vorwärts ist die Statusabbildung eine Funktion, rückwärts nicht. Das **mitgelieferte**
Default-Profil (`src/core/mirror/profile.ts:64`) zeigt es:

```ts
statusMap: { needsAction: "open", inProcess: "in-progress", completed: "done", cancelled: "done" }
```

`completed` und `cancelled` zeigen beide auf `"done"`. Die Mehrdeutigkeit aus §6 der
M6a-Spec ist also **der Normalfall ab Werk**, nicht der Sonderfall einer exotischen
Konfiguration. Naiv umgekehrt würde jede abgebrochene Aufgabe beim ersten Rückschreiben zu
„erledigt" umgedeutet.

**Die Lösung ist, nicht umzukehren.** Die richtige Frage ist nicht „welcher VTODO-Zustand
gehört zu `done`", sondern „hat der Nutzer den Status überhaupt geändert?" — und die ist
eindeutig beantwortbar, weil der alte Server-Zustand vorliegt:

```
alt = Server-Status        neu = Frontmatter-Wert

1. statusValue(profil, alt) === neu   →  NICHTS ändern, `alt` bleibt stehen.
2. sonst den VTODO-Zustand suchen, der auf `neu` abbildet:
     genau einer  → nehmen
     mehrere      → COMPLETED vor CANCELLED
     keiner       → Feld überspringen, in `skipped` melden
```

Schritt 1 trägt den ganzen häufigen Fall: eine serverseitig abgebrochene Aufgabe, deren
Frontmatter weiter `done` sagt, bleibt `CANCELLED`. Entschieden wird nur, wo wirklich ein
Wechsel stattfand — und dort ist Abhaken der Normalfall, Abbrechen die bewusste Ausnahme.

**Priorität**, gleiches Muster: war sie `2` und bildet `2` weiter auf `high` ab, bleibt sie
`2`. Erst bei echtem Wechsel werden Repräsentanten gesetzt — `high→1`, `normal→5`, `low→9`
(RFC 5545). Ein Frontmatter-Wert, der auf keinen der drei passt, heißt „keine Priorität" und
entfernt die Property.

**Nebenwirkungen gehören in die Abbildung, nicht in den Aufrufer:**

| Wechsel | zusätzlich |
|---|---|
| → `COMPLETED` | `COMPLETED` auf jetzt, `PERCENT-COMPLETE: 100` |
| weg von `COMPLETED` | `COMPLETED` entfernen |
| jede Änderung | `SEQUENCE+1`, `LAST-MODIFIED`, `DTSTAMP` — wie `mutate.ts:125` für VEVENT |

**Schreibbare Felder** (`TODO_SUPPORTED`): `title · due · start · description · status ·
priority · categories`.

Bewusst nicht: `completed`/`percent` (leitet der Status ab — von Hand schreibbar erlaubte
widersprüchliche Zustände), `rrule` (Nicht-Ziel), `uid`/`last_modified` (gehören dem Server).
Alles nicht Aufgeführte landet in `skipped` und wird im Modal als „nicht übertragen"
angezeigt, statt still zu verschwinden.

## 5. Nebenläufigkeit — eine Falle, die beim Nachsehen auffiel

**Der Busy-Guard hat keinen Reentrancy-Zähler** (`src/core/sync/busy.ts`, ausdrücklich so
dokumentiert), und `executeCommandPlan` nimmt ihn bei jedem Aufruf. Daraus folgt:

- Ein Sammellauf, der den Guard einmal nimmt und dann n Pläne über `executeCommandPlan`
  schickt, bekommt **n-mal `busy`** — jeder Plan scheitert, mit einer Meldung, die nach einem
  Nebenläufigkeitsproblem aussieht statt nach einem Eigentor.
- Nimmt er ihn nicht, kann der Intervall-Sync zwischen zwei Pläne fahren und gegen dieselbe
  Collection schreiben.

**Auflösung:** `executeCommandPlanLocked` existiert bereits als innere, guard-freie Variante
(`execute.ts:141`) — sie ist nur nicht exportiert. M6b ergänzt daneben
`executeCommandPlans(deps, settings, plans[])`: Guard **einmal** nehmen, Pläne der Reihe nach
durch die innere Variante, je Plan ein Ergebnis. Kein neues Nebenläufigkeitsmodell.

**Konflikt-Erkennung** ist der ETag-Vergleich aus §3 Schritt 2. Je Konfliktzeile drei
Möglichkeiten:

| Wahl | Wirkung |
|---|---|
| Vault gewinnt | PUT mit dem **frischen** ETag — die Serveränderung wird bewusst überschrieben |
| Server gewinnt | **kein** DAV-Schreibvorgang; stattdessen `resyncObject()` auf diese Ressource — derselbe Weg, den `executeCommandPlanLocked` nach jedem PUT ohnehin geht, nur ohne PUT davor |
| überspringen | nichts; die Zeile erscheint beim nächsten Lauf erneut |

„Server gewinnt" ist die einzige Wahl, die **Nutzerarbeit verwirft**. Die Zeile sagt das
ausdrücklich, und vorbelegt ist „überspringen" — nicht eine der gewinnenden.

## 6. Fehlerfälle

- **412 beim Schreiben**, obwohl das Modal keinen Konflikt zeigte: der Server hat sich
  zwischen Erhebung und PUT geändert. Die Zeile scheitert, das Ergebnis meldet sie, ein
  zweiter Lauf zeigt sie mit frischem Stand. Kein Mangel — dafür ist `If-Match` da.
- **Teilerfolg ist ein gültiger Ausgang.** 17 geschrieben, 3 gescheitert; das Ergebnis nennt
  beides. Ein Sammellauf ist ausdrücklich kein Alles-oder-Nichts.
- **Transportfehler mitten im Lauf:** bereits Geschriebenes bleibt geschrieben, der Rest wird
  nicht versucht, das Ergebnis sagt, wo abgebrochen wurde.
- **Unbekannter Frontmatter-Wert** (Status/Priorität außerhalb der Abbildung): Feld
  überspringen und melden, nie raten.
- **Voraussetzungen:** ohne `todo`-Profil oder ohne aktivierte Aufgaben-Sammlung erscheint das
  Kommando nicht. **Fehlendes TaskNotes ist kein Hinderungsgrund** — die Abbildung steckt im
  eingefrorenen Profil, der Transport braucht TaskNotes zur Laufzeit nicht.

## 7. Tests

**Unit (pur):**
- `todo-reverse`: Bewahrungsregel (Server `CANCELLED` + Frontmatter `done` → bleibt
  `CANCELLED`), Kollisionsauflösung bei echtem Wechsel, Nebenwirkungen des Statuswechsels,
  Prioritäts-Nachbarn statt Extremwerte, unbekannter Wert → `skipped`.
- `todo-collect`: Dreiteilung, ETag-Vergleich, Notizen ohne `dav_uid`.
- `mutate`: `applyTodoMutation` bumpt `SEQUENCE` und setzt `LAST-MODIFIED`/`DTSTAMP`;
  `newTodoIcs` erzeugt ein gültiges VCALENDAR.
- `push-hand-edits`: todo-Zweig, `TODO_SUPPORTED`-Whitelist, `skipped`-Meldungen.
- **`executeCommandPlans`: Negativtest, dass n Pläne nicht n-mal `busy` liefern.** Er nagelt
  §5 fest — ohne ihn baut die nächste Änderung die Falle wieder ein.

**Integration (Radicale)**, Geschwisterzweig zum vorhandenen VEVENT-Test: Erstanlage mit
`If-None-Match` → 201, Änderung mit `If-Match`, Konflikt mit veraltetem ETag → 412.

**GUI-Smoke**, `--section todo` erweitert: Modal öffnet mit drei Gruppen, Auswahl schreibt,
Ergebnis meldet Teilerfolg. Dazu **ein Prüfpunkt, der ohne die Bewahrungsregel rot wäre** —
ein Prüfpunkt, der nur den Erfolg bestätigt, ist keiner.

## 8. Nicht-Ziele dieses Meilensteins

| Nicht-Ziel | Grund |
|---|---|
| Automatischer Upload ohne Bestätigung | entschieden: explizites Kommando |
| Eigene Aufgaben-Formulare in calendar-notes | TaskNotes besitzt das Bedienen; ein zweiter Weg liefe auseinander |
| `api.tasks.*` in jeder Form | §1 — wir spiegeln laufend und würden damit fremden Bestand führen |
| **Löschen auf dem Server aus dem Vault heraus** | eine gelöschte Notiz ist nicht „Aufgabe abschaffen"; ein Sammellauf mit Löschungen kann viel auf einmal zerstören. Billig nachzurüsten, teuer wenn im ersten Wurf falsch |
| Instanz-Notizen für wiederkehrende VTODOs | `RRULE` bleibt ein Feld — bestehendes Nicht-Ziel |
| Aufgaben über die Plugin-API v1 | `ApiObjectKind` zu erweitern bräche den veröffentlichten Vertrag (§11 M6a) |
| Sammel-Sync für Termine und Kontakte | Ansatz A: erst bei einem zweiten echten Anwendungsfall weiß man, wie die Verallgemeinerung aussieht |
