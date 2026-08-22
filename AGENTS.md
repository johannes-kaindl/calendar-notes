# AGENTS — calendar-notes

CalDAV-Termine und CardDAV-Kontakte als Notiz-Spiegel; der Server ist die Wahrheit, geschrieben wird nur
über Kommandos. Spec: `docs/superpowers/specs/2026-08-22-calendar-notes-design.md`. Pläne: `docs/superpowers/plans/`.

- `src/core/**` ist obsidian-/DOM-/node-frei (`npm run check:pure`). Transport wird injiziert.
- Kit-Module nur über `tools/sync-kit.sh` (Herkunfts-Header), nie von Hand.
- `eslint.config.mjs` + `scripts/check-no-inline-disables.mjs` sind Template-Kopien (Dach `tools/release-template/`).
- Tests: `npm test` (unit) · `npm run test:integration` (startet Radicale per `uvx`, s. `scripts/dav-server.ts`).
- DAV-Befunde echter Server: `docs/dav/befunde/` (ohne Zugangsdaten); Erhebungsliste `docs/dav/erhebung-anforderungen.md`.
- Dach-Regeln gelten: `../AGENTS.md` (Kit-first, Release über `../tools/release/`, Store-Flow).

## Was M1 liefert
- DAV-Core Modul (`src/core/dav/`) mit Discovery, Collection-Sync, Multiget, Transport-Injection
- ical.js-Parser und Mutationen für VEVENT (`src/core/ical/`)
- vCard-Parser und Mutationen (`src/core/vcard/`)
- Radicale-Integrationstests (`npm run test:integration`)
- 64 Unit-Tests + 4 Integration-Tests (0 Warnings)
- `fixtures/radicale/collections/collection-root/test/kontakte/c3-1.vcf` weicht im PHOTO-Padding
  bewusst von `tests/fixtures/vcard/v3-full.vcf` ab — Radicale/vobject verlangt gültiges
  Base64-Padding; nicht angleichen.

## Was M2a liefert
- Mirror-Kern-Module: Mapping-Profile (`src/core/mirror/profile.ts`), verwaltete Werte + Attendee-Links (`src/core/mirror/fields.ts`), Body-Block-Verwaltung (`src/core/mirror/body.ts`), Dateiname + Hash (`src/core/mirror/filename.ts`, `hash.ts`), Zeitfenster-Queries (`src/core/ical/recur.ts`, `src/core/mirror/window.ts`)
- Plan-Typen für Notiz-Operationen: `create` (Neuanlage), `update` (Frontmatter-Keys geändert), `skip` (unverändert | bereits archiviert | bereits gelöscht), `archive` (Termin außerhalb des Zeitfensters — Notiz bleibt, `dav_state: archived`), `delete` (vom Server gelöscht → `trash` in den Papierkorb, oder `mark` mit `dav_state: deleted`, wenn Backlinks/Nutzerinhalt vorhanden sind)
- Collection-State tracking: Snapshot pro Sammlung mit Verlauf und geschriebenen Werten, pro Objekt `notes` (Master + Overrides, je Notiz eigene geschriebene Werte/Hash statt eines gemeinsamen `notePaths`) (`src/core/state/collection-state.ts`)
- M2b (`processFrontMatter` / `vault.process`) führt Pläne aus, nicht M2a selbst
- `src/core/**` bleibt obsidian-/DOM-/node-frei; `ApplyInput.timeWindow` trägt das Suchfenster
- 138 Unit-Tests (22 Dateien, 0 Warnings)
