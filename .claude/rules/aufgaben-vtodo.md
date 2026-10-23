---
paths:
  - "src/core/ical/todo.ts"
  - "src/core/mirror/todo-*.ts"
  - "src/core/mirror/tasknotes-map.ts"
  - "src/core/mirror/kind.ts"
  - "src/core/mirror/apply.ts"
  - "src/core/sync/todo-collect.ts"
  - "src/core/sync/service.ts"
  - "src/core/commands/todo-commands.ts"
  - "src/obsidian/tasknotes.ts"
  - "src/obsidian/todo-sync-modal.ts"
  - "src/obsidian/vault-notes.ts"
---

# Aufgaben (VTODO) — TaskNotes verwaltet, calendar-notes transportiert

## Die Grenze

- **Die Grenze verläuft an der Schreibhoheit, nicht am Datentyp.** Gelesen wird ausschließlich `api.model` und `api.catalog` der TaskNotes-Plugin-API — **niemals `api.tasks.*`**. Sobald calendar-notes eine Aufgabe anlegte oder änderte, verwaltete es sie, und die Zuständigkeitsgrenze der Dach-`AGENTS.md` wäre verschoben statt bedient. Dieselbe Achse wie bei vault-rag: die Quelle liefert Material und entscheidet nichts. Messbefund zur fremden API: Cockpit-Note `_Intern/tasknotes-api.md`.
- **Das Notiz-Format wird abgelesen, nicht erfunden** — einmalig über einen Knopf in den Einstellungen, das Ergebnis friert als gewöhnliches `MappingProfile` ein (samt gelesener `specVersion`; die API ist ein Release Candidate). Danach läuft der Sync ohne TaskNotes. Kein Laufzeitgriff aus `src/core/**`, kein Fremdplugin im Sync-Pfad, und ein API-Bruch fällt beim nächsten Ableiten auf statt still.
- ⚠️ **Die Wertevokabulare sind die Härte, nicht die Feldnamen.** TaskNotes-Status sind frei konfigurierbar; die Abbildung läuft über `isCompleted` + `order`, **nie über Namensgleichheit** — die ist Zufall und bricht beim ersten Nutzer, der umbenennt. Und `taskIdentification` entscheidet über Sichtbarkeit: wird sie nicht erfüllt, ist die gespiegelte Notiz für TaskNotes unsichtbar, ohne Fehler und ohne Symptom außer fehlenden Aufgaben.
- **Fensterregel:** offene Aufgaben liegen IMMER im Fenster, auch ohne jedes Datum (`todoInWindow`); erledigte nur, solange ihr Abschluss im Fenster liegt. Fehlt COMPLETED, entscheidet LAST-MODIFIED; fehlt auch das, wird gespiegelt statt archiviert. DTSTART **und** DUE sind bei VTODO beide optional (RFC 5545 4.6.2); der Anker ist DTSTART, sonst DUE.

## Zwei Achsen, zwei Wächter

- **`assertNever` sichert die Erweiterung von `ProfileKind` ab** — wer den Typ um eine vierte Sorte erweitert, bekommt vom Compiler jede Stelle gezeigt, die einen Zweig braucht. Der Wächter heißt `assertNever` bzw. `nichtUnterstuetzt` (nimmt `ProfileKind` und wirft) in `src/core/mirror/kind.ts`.
- ⚠️ **Er schützt aber nur die Achse, an der er steht — und es gibt zwei.** `ProfileKind` (contact/event/todo) sagt, *was gespiegelt wird*; `CollectionKind` (calendar/addressbook) sagt, *wie der Server es ausliefert*. M6a erweiterte die erste, und genau deshalb blieb ein Fehlstand auf der zweiten unsichtbar: `service.ts` entschied anhand von `col.kind`, ob der Termin-Abrufpfad genommen wird, und dessen `calendar-query` filtert fest auf VEVENT — eine Aufgaben-Sammlung lieferte darüber **strukturell null Treffer, ohne Fehler und ohne Warnung**. Gefunden hat das der GUI-Smoke, nicht der Typecheck und nicht 608 grüne Unit-Tests (die füttern `apply.ts` mit bereits geholten Rohdaten — die Lücke lag zwischen den Schichten). **Wer an einer der beiden Achsen etwas ändert, sieht auf der anderen nach.**
- **Die zwei Fenster-Ausdrücke in `apply.ts` müssen von Hand erschöpfend gehalten werden,** weil der Compiler sie nicht sieht: sie verzweigen auf den Profil-`kind`, ohne einen `never`-Zweig zu erzwingen. Kommt eine vierte Sorte dazu, gehört sie dort ausdrücklich eingetragen.

## Rückrichtung (Vault → Server)

- **Löschen bleibt Nicht-Ziel** (Spec §8): kein Weg im Plugin erzeugt einen `delete`-Plan für eine Aufgabe. Wer eine Notiz löscht, löscht die Notiz — die Aufgabe auf dem Server bleibt.
- **Die Zusage „eine abgebrochene Aufgabe wird nicht zu einer erledigten“ hängt an ZWEI Eigenschaften, nicht an einer.** `statusMap` bildet `CANCELLED` und `COMPLETED` beide auf `done` ab, rückwärts ist die Abbildung also nicht eindeutig. Es tragen: (a) `planTodoHandEdits` mutiert **nur geänderte** Frontmatter-Schlüssel, und (b) `reverseStatus` schreibt nichts, wenn der alte Serverzustand weiterhin auf den neuen Wert abbildet. Am 2026-09-05 live gemessen: schaltet man (a) ab, hält (b) die Zusage; schaltet man beide ab, wird aus `CANCELLED` ein `COMPLETED`. **Solange (a) steht, ist (b) unerreichbar** — `handEditedKeys` meldet `status` nur, wenn der Frontmatter-Wert vom zuletzt geschriebenen abweicht, und dann kann `statusValue(alt) === ziel` nicht mehr gelten. (b) ist also ein Netz für eine andere Bauart, kein Wirkmechanismus der aktuellen. Wer (a) ändert, zieht seine Begründung aus (b) — und umgekehrt.
- **Eine im Vault entstandene Aufgabe muss ihre neue UID BEANSPRUCHEN** (`CommandPlan.claimsNote` → `ApplyInput.claim`). Ohne das findet der Resync nach dem PUT keine Notiz zu dieser UID, legt eine zweite an, und die Ausgangsnotiz bleibt ohne `dav_uid` — beim nächsten Lauf ist sie wieder „neu“ und legt die Aufgabe **erneut** an. Am 2026-09-05 als P28 des GUI-Smokes gemessen und behoben.
- ⚠️ **`VaultNoteLookup.byPath` liefert nur GEPRIMTE Pfade** — das ist Absicht (s. Klassenkopf), aber es macht jeden Fake gefährlich, der großzügiger ist. Der erste Fix zum Absatz darüber war im Unit-Test grün und gegen ein echtes Obsidian rot, weil der Fake jeden Pfad fand. Wer eine Notiz auflöst, die weder im Profil-Index noch im State steht, nennt ihren Pfad in `lookupFor(profile, extraPaths)` — und der Fake im Test bildet das nach.
- **Zuständigkeit:** `reverseStatus`/`reversePriority` (`src/core/mirror/todo-reverse.ts`) sind **bewahrend**; `classifyTodos` (`src/core/sync/todo-collect.ts`) bildet drei Gruppen (nur im Vault geändert / neu / auf beiden Seiten geändert), rein und transportfrei, mit dem Serverstand als **ETag-Karte je Sammlung** (ein Request, nicht einer je Notiz).
