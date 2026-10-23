# Aufbau von calendar-notes

Modul-Layout und Datenfluss. Das Warum steht in `docs/internal/decisions.md`, die Regeln im Kern (`AGENTS.md`), die Fallstricke unter `.claude/rules/`.

## Schichten

- `src/core/**` ist obsidian-, DOM- und node-frei (`npm run check:pure`); der Transport wird injiziert. `src/obsidian/**` ist die Schicht mit Obsidian-API, `src/main.ts` das Plugin.
- `src/vendor/` trägt die Kit-Module (`kit/`, `kit-obsidian/`, `code-kit/`), vendort über `tools/sync-kit.sh` mit Herkunfts-Header, nie von Hand.

## Module in `src/core/`

- `dav/` — Discovery, Collection-Sync, Multiget, Scheduling-Erkennung, Transport-Injection (`client.ts`, `discovery.ts`, `sync.ts`, `scheduling.ts`, `transport.ts`).
- `ical/` und `vcard/` — Parser und Mutationen für VEVENT, VTODO und vCard; Zeit-Helfer komponentenneutral in `ical/time.ts`, Wiederholungen in `ical/recur.ts`.
- `mirror/` — der Notiz-Spiegel: Mapping-Profile (`profile.ts`, `profile-from-note.ts`), verwaltete Werte und Attendee-Links (`fields.ts`), Body-Block-Verwaltung (`body.ts`), Dateiname und Hash, Zeitfenster (`window.ts`), Aufgaben-Abbildung (`todo-values.ts`, `todo-reverse.ts`, `tasknotes-map.ts`) und die Plan-Typen für Notiz-Operationen: `create`, `update`, `skip`, `archive` (Termin außerhalb des Zeitfensters, `dav_state: archived`), `delete` (vom Server gelöscht → `trash` in den Papierkorb, oder `mark` mit `dav_state: deleted`, wenn Backlinks oder Nutzerinhalt vorhanden sind).
- `state/collection-state.ts` — Snapshot pro Sammlung mit Verlauf und geschriebenen Werten; pro Objekt `notes` (Master + Overrides, je Notiz eigene geschriebene Werte und Hash).
- `sync/` — `SyncService` (`service.ts`) mit injizierten Interfaces (Transport, Secret, State, Lookup, Executor, Notifier): Refresh → Sync → Plan → Ausführung → State, Fehler isoliert, Notices nur bei neuen Fehlern, Trockenlauf, gemeinsamer Busy-Guard (`deps.busy`, geteilt mit `executeCommandPlan`; code-kit `busy-guard`); `execute.ts` für Kommandos; `todo-collect.ts` für die Rückrichtung.
- `adopt/` — Matching (E-Mail exakt → Telefon E.164 → Name fuzzy bis Konfidenz-Schwelle; Termine: Start exakt + Titel-Ähnlichkeit; Stufen `sure/likely/weak`) und Adoptionsplan.
- `commands/` — Kommando-Registry und Kommandos für Termine, Kontakte und Aufgaben, `undo.ts`, `push-hand-edits.ts`, iMIP (`imip.ts`), Schema-Typen; Eingabeprüfung über `validateInput` aus code-kit.
- `api/` — Typen und Lesezugriff der Plugin-API v1 (`docs/API.md`), Tool-Provider.
- `settings.ts` — Settings-Modell mit Konten, Sammlungen, Profilen und Sync-Optionen samt Normalisierung.

## Schicht `src/obsidian/`

Transport (`transport.ts`, über `requestUrl`), Secret-Speicher (Kit-Modul `secrets`, `app.secretStorage` mit Verifizierung), State-Store (`state-store.ts`, `manifest.dir/state/`), Vault-Adapter (`vault-notes.ts` mit Index, Lookup und `prime()`, Ausführung über `processFrontMatter` und `vault.process`), Settings-Tab, Vorschau- und Adoptions-Modal, Kommando-UI (`command-modal.ts` als Formular aus dem Schema, `plan-preview-modal.ts` als Diff-Vorschau vor jeder Ausführung), Einladungs-Weg (`invite.ts`), `api.ts` (`createPluginApi`) und `todo-sync-modal.ts`.

- **Kommandos des Plugins:** `sync-all`, `sync-preview`, `sync-collection`, `adopt-collection`, `profile-from-note`, `run-on-note`, `new-event`, `new-contact`, `undo-last-change`, `push-hand-edits`, `todo-sync`.
- **Auslöser des Syncs:** Start-Verzögerung (`onLayoutReady`), Intervall (Mobil vs. Desktop), Neusetzung bei Settings-Änderung.

## Test- und Smoke-Aufbau

- `npm test` (Unit) und `npm run test:integration` (startet Radicale per `uvx`, siehe `scripts/dav-server.ts`).
- Der GUI-Smoke (`scripts/gui-smoke.ts`) hat drei Abschnitte: `generic` (Standard-Profile für Contacts und Events: Grundpunkte, P4a/P4b, P5–P7, P9–P13), `pallas` (Profile aus Pallas-ähnlichen Notizen und Adoption, P3/P3b) und `todo` (Aufgaben-Spiegel und Rückschreiben, P20–P30); P8 (Settings-UI, Screenshot) läuft nur mit `--focus`. Jeder Lauf legt ein eigenes Konto und seine Sammlungen an (Kalender, Kontakte, Aufgaben), benutzt Radicale auf Port 5298 und stellt am Ende den Vorher-Zustand wieder her; Details und Protokoll: `docs/SMOKE.md`.
- Das Staging-Vault-Fixture (`fixtures/vault/`) hat eine Pallas-ähnliche Struktur.
