# calendar-notes — VTODO/Aufgaben (M6) Design-Spec

**Stand:** 2026-09-02 · Ergänzt `2026-08-22-calendar-notes-design.md`, ersetzt sie nicht.
Architektur, Datenmodell und Sync-Ablauf gelten dort unverändert weiter; diese Spec beschreibt
den dritten Objekttyp neben Kontakt und Termin.

## 0. Anlass und Entscheidung

Die Haupt-Spec führte `VTODO/Aufgaben (→ TaskNotes)` als Nicht-Ziel. Die Klammer nannte den
**Zuständigen**, wurde aber als Verbot gelesen: *TaskNotes verwaltet Aufgaben* wurde zu
*calendar-notes fasst Aufgaben nicht an*. Die erste Hälfte bleibt wahr, wenn die zweite fällt.

Aufgehoben am 2026-09-02 auf ausdrückliche Anforderung: „Aufgaben, die ich in Thunderbird anlege,
sollen in meinem Vault auftauchen, und Aufgaben, die ich im Vault mit TaskNotes anlege, sollen
über VTODO bei Thunderbird landen." Das ist Transport zwischen zwei Klienten desselben Servers —
also genau die Aufgabe dieses Plugins, und keine Verwaltung.

Die Voraussetzungen lagen bereits: `supported-calendar-component-set` wird seit M2 erhoben
(heute nur negativ ausgewertet), und mailbox.org führt VTODO in einer eigenen Collection, die
sich benennt (`docs/dav/befunde/mailbox-org.md`, Punkt 3).

## 1. Zuständigkeitsgrenze zu TaskNotes

**TaskNotes verwaltet Aufgaben, calendar-notes transportiert sie.** Dieselbe Achse wie bei
vault-rag: die Quelle liefert Material, entscheidet aber nichts.

Gelesen wird ausschließlich `api.model` und `api.catalog` — **niemals `api.tasks.*`**. Sobald
calendar-notes eine Aufgabe anlegte oder änderte, verwaltete es sie, und die Grenze wäre
verschoben statt bedient. Das Notiz-Format erfindet calendar-notes nicht; es liest es einmal ab
(§5) und schreibt danach nur noch, was der Server sagt.

Gemessen am 2026-09-01 am laufenden Objekt (TaskNotes 4.12.5): `api.model.config()` liefert
`fieldMapping`, `statuses`, `priorities`, `defaults`, `taskIdentification`; `api.catalog.fields()`
liefert Felddefinitionen mit `frontmatterKey`, `valueType`, `writable`, `required`;
`api.model.info()` meldet `specVersion 0.3.0-rc.3`, `runtimeApiVersion 1`.

## 2. Zuschnitt: zwei Etappen

**M6a — Server → Vault.** Aufgaben erscheinen als Notizen, TaskNotes sieht sie. Einbahnig, wie
der Termin-Spiegel es vor M4 war. Für sich allein nutzbar.

**M6b — Vault → Server.** Zurückschreiben über explizite Kommandos, plus der einzige wirklich
neue DAV-Fall: die **Erstanlage** einer im Vault entstandenen Aufgabe ist ein `PUT` ohne
`If-Match` auf eine neue Ressource, abgesichert mit `If-None-Match: *`.

Die Trennung ordnet, sie streicht nichts. Ihr Grund ist der Zuwachs an Neuem: M6a ist ein
Geschwisterzweig zu Code, der dreifach vorliegt, und ändert an der DAV-Schicht nichts. M6b bringt
einen Schreibfall, den das Plugin noch nie hatte — die Erstanlage ohne ETag — und muss die
Statusabbildung **rückwärts** eindeutig machen, was sie vorwärts nicht sein muss (§6). Dazu
kommt, dass M6a die echten gespiegelten Daten liefert, an denen M6b entworfen wird, statt am
Reißbrett.

⚠️ **Nicht der Grund ist die Release-Candidate-API.** Beide Etappen benutzen dasselbe einmal
abgeleitete Profil (§5); M6a braucht den Ableitungs-Knopf genauso wie M6b, und ein API-Bruch
träfe beide gleich — nämlich nur beim nächsten Ableiten, nicht im Sync. Das RC-Argument begründet
die Bauart der Ableitung, nicht den Schnitt.

Diese Spec beschreibt M6a vollständig und M6b so weit, wie M6a Entscheidungen vorwegnimmt.

## 3. Datenmodell und Module

`src/core/ical/event.ts` trägt zur Hälfte: `timeToIso`, `timeOfProp` und `calAddress` sind
komponentenneutral; `eventFromComponent` hängt an `new ICAL.Event()` mit `startDate`/`endDate`
und ist VEVENT-Semantik, `parseEvents` prüft hart auf `vevent`.

- **`src/core/ical/time.ts`** (neu) — Extraktion der drei neutralen Helfer. Reine Verschiebung,
  kein Verhaltenswechsel; `event.ts` und `todo.ts` importieren daraus.
- **`src/core/ical/todo.ts`** (neu) — `TodoData` und `parseTodos()`. Eigene Vokabeln statt
  Event-Feldern in Zweitbedeutung: `due?`, `completed?`, `percentComplete?`, `start?` (bei VTODO
  optional), dazu `uid`, `summary`, `description?`, `status?`, `priority?`, `categories`,
  `rrule?`, `lastModified?`, `sequence`.
- **`ProfileKind`** wird `"contact" | "event" | "todo"`; dazu `TODO_SERVER_FIELDS` und
  `defaultTodoProfile()` nach dem Muster der beiden vorhandenen. `filename: "{title}"` — ein
  Datums-Präfix scheitert an Aufgaben ohne `DUE`; Namenskollisionen deckt der bestehende
  Suffix-Mechanismus.

Ein gemeinsamer Typ für VEVENT und VTODO wurde verworfen: er würde zur Union zweier Halbmengen,
in der `end?` je nach Herkunft etwas anderes bedeutet, und hinterließe an jeder fallunter-
scheidenden Stelle eine Lücke, die kein Typ meldet (`_docs/LESSONS.md`, 2026-08-08). Geteilt
wird die **Zeitkodierung**, nicht die **Semantik**.

## 4. Erkennung und Einstellungen

`holdsTodos()` kommt als Geschwister zu `holdsEvents()` in `src/core/settings.ts`, mit derselben
Regel: sagt der Server nichts, wird nichts ausgeschlossen — Radicale nimmt beides an und liefert
die Eigenschaft nicht zwingend, mailbox.org trennt und benennt es.

**Hier ändert sich Bestehendes, benannt statt nebenbei:** heute filtert `holdsEvents()` eine
Sammlung ganz aus der Liste. Künftig schränkt das Paar die Auswahl der **zuweisbaren Profile**
ein. Eine mailbox.org-Aufgabensammlung ist dann sichtbar und nimmt nur Todo-Profile an, statt zu
verschwinden. Der Grund, aus dem `holdsEvents()` gebaut wurde, bleibt bedient: eine wortlos
übersprungene Sammlung ist schlimmer als eine, die gar nicht erst einschaltbar aussieht — künftig
ist sie einschaltbar und zeigt, wofür.

## 5. Profil-Ableitung aus TaskNotes

Ein Knopf **„Profil aus TaskNotes erzeugen"** liest einmalig `model.config()` und
`catalog.fields()` und schreibt das Ergebnis als gewöhnliches `MappingProfile` — samt der
gelesenen `specVersion` in `taskNotesSpec`. Danach läuft der Sync ohne TaskNotes.

Das hält `src/core/**` frei von der Fremd-API (die Ableitung lebt in `src/obsidian/`), macht die
RC-Abhängigkeit zu einem **Ergebnis** statt zu einer Laufzeitkopplung, und ein API-Bruch fällt
beim nächsten Ableiten auf statt still im Sync. `api.hasCapability("catalog.read")` gatet den
Knopf; fehlt TaskNotes, fehlt der Knopf, nicht die Funktion.

**Sichtbarkeit ist der teuerste Fehlerfall.** Die Ableitung schreibt `taskIdentification` in
`onCreate`: bei `method: "tag"` einen `tags`-Eintrag, bei `"property"` das genannte Feld mit
seinem Wert. Wird sie nicht erfüllt, ist die gespiegelte Notiz für TaskNotes unsichtbar — ohne
Fehlermeldung, ohne Symptom außer fehlenden Aufgaben.

## 6. Wertevokabulare — die eigentliche Härte

Die Abbildung liegt **im Profil**, nicht im Code: `MappingProfile` bekommt drei bei
`kind: "todo"` belegte Felder — `statusMap` (die vier VTODO-Zustände auf je einen
TaskNotes-Statuswert), `priorityMap`, `taskNotesSpec`. Kein Codepfad rät je einen Statuswert; er
schlägt ihn einmal vor, und der Nutzer sieht den Vorschlag.

**Vorschlagsregel — über `isCompleted` und `order`, nie über Namensgleichheit.** Namen sind frei
konfigurierbar; Gleichheit wäre Zufall und bräche beim ersten Nutzer, der umbenennt.

| VTODO | Vorschlag |
|---|---|
| `NEEDS-ACTION` | `isCompleted: false`, kleinste `order` |
| `IN-PROCESS` | `isCompleted: false`, zweitkleinste `order`; fehlt sie, wie `NEEDS-ACTION` |
| `COMPLETED` | `isCompleted: true`, kleinste `order` |
| `CANCELLED` | `isCompleted: true`, größte `order` |

⚠️ **Hat der Nutzer nur einen abgeschlossenen Status, fallen `COMPLETED` und `CANCELLED`
zusammen.** Für M6a folgenlos, für M6b mehrdeutig. Der Ableitungs-Dialog sagt es an der Stelle,
an der die Mehrdeutigkeit entsteht — sonst stolpert M6b über eine Abbildung, die M6a
stillschweigend erzeugt hat.

**Priorität** nach RFC 5545: `1–4` hoch, `5` normal, `6–9` niedrig, `0` oder fehlend schreibt
nichts. Zielwerte aus `customPriorities` nach `order`. **`PERCENT-COMPLETE`** wird nur
geschrieben, wenn `catalog.fields()` ein passendes Feld nennt; sonst entfällt es. Ein erfundener
Frontmatter-Key wäre für TaskNotes unsichtbar und für den Nutzer Rauschen.

## 7. Spiegel-Umfang und Archivierung

**Offen bestimmt sich am Server, nicht am TaskNotes-Wert** — der Server ist die Wahrheit. Offen
heißt: `STATUS` fehlt, `NEEDS-ACTION` oder `IN-PROCESS`.

- Offene Aufgaben werden **immer** gespiegelt, mit oder ohne `DUE`. Das Zeitfenster der Termine
  trägt hier nicht: eine Aufgabe ohne Datum liegt in keinem Fenster.
- Erledigte und abgebrochene nur, solange `COMPLETED` im vorhandenen `pastDays`-Fenster liegt.
  Fallback `LAST-MODIFIED`, weil nicht jeder Server `COMPLETED` setzt.
- Ältere bekommen `dav_state: archived` über den bestehenden Mechanismus: die Notiz bleibt samt
  Backlinks stehen, sie verschwindet nur aus dem aktiven Spiegel.

## 8. Fehlerfälle

- **TaskNotes fehlt** → kein Ableitungs-Knopf (`hasCapability`). Das statische Default-Profil
  bleibt nutzbar und sagt in seiner Beschreibung, dass seine Werte Annahmen sind.
- **`specVersion` weicht beim erneuten Ableiten ab** → Hinweis im Dialog. Kein Sync-seitiger
  Versionscheck; der wäre die Laufzeitkopplung, die §5 gerade vermeidet.
- **Sammlung meldet weder VEVENT noch VTODO** → beide Profilsorten zuweisbar (§4).
- **VTODO ohne `SUMMARY`** → Notiz bekommt den UID-Stamm als Titel statt eines leeren Namens.

## 9. Tests

1. **Unit** — `parseTodos` gegen Fixtures: mailbox.org, Thunderbird, minimal (ohne `DTSTART`
   *und* ohne `DUE`), erledigt, wiederkehrend. Ableitungsregel gegen die am 2026-09-01 gemessene
   TaskNotes-Konfiguration **plus die Randfälle**: genau ein abgeschlossener Status (Kollision
   `COMPLETED`/`CANCELLED`) und gar keiner. Fenster-Regel für Todos. `holdsTodos`/`holdsEvents`
   als Paar.
2. **Integration** — Radicale mit einer VTODO-Sammlung im Fixture-Ordner.
3. **GUI-Smoke** — eigener Abschnitt: Sammlung mit Todo-Profil aktivieren, Sync, Notiz erscheint,
   Status stimmt, TaskNotes sieht sie. **Zweimal hintereinander gefahren** — ein einmal grüner
   Prüfpunkt ist noch nicht wiederholbar (Lesson 2026-08-30).
4. **Gegenprobe** — die Statusabbildung absichtlich falsch setzen und belegen, dass der Prüfpunkt
   rot wird. Ohne sie prüft er nur, dass irgendeine Notiz existiert.

## 10. Offener Messpunkt — erste Aufgabe im Plan, keine Annahme in der Spec

Legt Thunderbird seine Aufgaben in dieselbe mailbox.org-Collection, die sich als VTODO-fähig
meldet? Vermutet ja, **ungemessen** — messbar erst mit dem Konto aus Rollout Teil A. Gehört als
erste Plan-Aufgabe mit Abbruchkriterium hinein, nicht als Voraussetzung hierher.

## 11. Nicht-Ziele dieses Meilensteins

`api.tasks.*` in jeder Form · Aufgaben im Vault anlegen oder ändern (das ist TaskNotes) ·
Instanz-Notizen für wiederkehrende VTODOs — `RRULE` wird wie bei VEVENT als Feld gespiegelt, das
bestehende Nicht-Ziel gilt unverändert weiter · `VJOURNAL` · Unteraufgaben über `RELATED-TO`.
