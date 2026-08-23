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

## Bereits im Dach-Arbeitsbaum eingetragen (uncommittet — braucht eigenen Commit in obsidian-plugins/)

Beide Kandidaten, die diese Datei vorher als „fehlt noch" führte, stehen inzwischen im
Arbeitsbaum von `../REGISTRY.md` (dort noch uncommittet — `git -C .. status --short
REGISTRY.md` zeigt `M`). Diese Aufgabe editiert `../REGISTRY.md` nicht; der Commit dafür
gehört in eine Dach-Session:

- **Fake-Transport für HTTP-Clients in vitest** (`tests/helpers/fake-transport.ts`) — in
  `../REGISTRY.md` unmittelbar nach der Vault-Open-Helfer-Zeile (Zeile ~333) eingetragen.
- **i18n-Keys statt Sätze in Core-Deskriptoren** (`titleKey`/`descriptionKey`/`summaryKey`)
  — direkt darunter eingetragen, als Verschärfung von „i18n-Statuskeys statt Klartext"
  (Zeile 216) benannt.
