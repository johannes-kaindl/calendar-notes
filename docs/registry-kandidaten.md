# Registry-Kandidaten

**Status (2026-08-23, M5 Task 4):** Die Dach-`REGISTRY.md` trägt bereits eine Sektion
„DAV / Kalender / Kontakte" mit Zeilen für M1–M4 (`grep -n "calendar-notes" ../REGISTRY.md`,
Zeilen 322–333). Die meisten Kandidaten unten sind darüber bereits erfasst — siehe Zuordnung
je Zeile. Diese Datei ist ab jetzt eine **Kontrollliste**, nicht mehr die primäre Quelle;
`../REGISTRY.md` wird von dieser Aufgabe **nicht** editiert (Übergabe an die nächste
Registry-Pflege-Session bzw. Jay).

## Bereits in ../REGISTRY.md erfasst (keine Aktion nötig)

- DAV-Client ohne Obsidian (Transport-Injection, `fast-xml-parser`, Discovery, `sync-collection`, `multiget`, `If-Match`/412) — Zeile 322
- ical.js-/vCard-Mutationen ohne Property-Verlust — Zeile 323
- Notiz-Plan mit Feldklassen + verwaltetem Body-Block — Zeile 324
- Wiederholungs-Fensterprüfung (`eventOccursWithin`) — Teil von Zeile 323
- `app.secretStorage` + `SecretComponent` — Zeile 325
- SyncService mit injizierten Interfaces — Zeile 326
- Wegwerf-Radicale per `uvx` als Integrations-Server — Zeile 327
- Adoptions-Matching (E-Mail/Telefon/Name, Termin Start+Titel) — Zeile 328
- Schreib-Kommandos als Deskriptoren mit JSON-Schema + Mini-Schema-Validator (kein ajv) + `tools()`/LLM-Tool-Definitionen — Zeile 329
- Bidirektionaler Busy-Guard + isolierender Event-Emitter — Zeile 330
- Einladungs-Weg ohne eigenen Mailversand (Scheduling → Mail-Transport → `.ics`) — Zeile 331
- Anbieter-API v1 (`createPluginApi`, `{ error }`, Plan/Execute) — Zeile 332, dort bereits als **n=2 Kit-Kandidat** mit `local-image-generator` geführt (die hiesige Kandidaten-Notiz unten zu „Anbieter-API" ist damit überholt — n=2 ist in `../REGISTRY.md` bereits eingetragen, nicht nur vorgemerkt)
- Vault-Open-Helfer für CDP-Treiber (`vault-open`-IPC) — Zeile 333

## Fehlt noch in ../REGISTRY.md — für die nächste Registry-Pflege

- **Fake-Transport für HTTP-Clients in vitest** (Routen + Capture, injizierter Transport
  statt echtem Netzwerk) — `tests/helpers/fake-transport.ts`. Kein eigener Registry-Eintrag
  gefunden; das DAV-Client-Muster (Zeile 322) beschreibt den Produktionscode, nicht das
  Test-Double. Wiederverwendbar für jedes Plugin mit injiziertem HTTP-Transport (Muster
  identisch zu `TransportFactory` in `src/core/sync/service.ts`).
- **i18n-Key-Muster für Core-Deskriptoren statt fertiger Sätze** (`titleKey`/`descriptionKey`
  an `CommandDescriptor`, `summaryKey`+`summaryArgs` an `CommandPlan`, aufgelöst über `t()`
  erst in der Obsidian-Schicht; `src/core/**` bleibt komplett i18n-frei, auch für
  Schema-Feld-`description`s) — `src/core/commands/types.ts`, `src/i18n/strings.ts`. Verwandt
  mit der bereits katalogisierten Regel „i18n-Statuskeys statt Klartext" (`../REGISTRY.md`
  Zeile 216, n=4) und dem Anbieter-API-Grundsatz „`reason` ist ein Code, nie übersetzter
  Text" (Zeile 28) — hier zusätzlich verschärft, weil der Text nicht nur an einen
  Konsumenten, sondern strukturell an `api.tools()`/`api.commands()` durchgereicht wird
  (LLM-Tool-Definitionen fremder Aufrufer). Kein n=3 in Sicht, aber die pure Form (Key +
  Args statt fertigem String) ist bereits an zwei Stellen im Dach bewährt — Kandidat für
  frühe Extraktion (n=1–2 laut Dach-`AGENTS.md` Kit-first-Regel, Punkt 3).
