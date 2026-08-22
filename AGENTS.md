# AGENTS — calendar-notes

CalDAV-Termine und CardDAV-Kontakte als Notiz-Spiegel; der Server ist die Wahrheit, geschrieben wird nur
über Kommandos. Spec: `docs/superpowers/specs/2026-08-22-calendar-notes-design.md`. Pläne: `docs/superpowers/plans/`.

- `src/core/**` ist obsidian-/DOM-/node-frei (`npm run check:pure`). Transport wird injiziert.
- Kit-Module nur über `tools/sync-kit.sh` (Herkunfts-Header), nie von Hand.
- `eslint.config.mjs` + `scripts/check-no-inline-disables.mjs` sind Template-Kopien (Dach `tools/release-template/`).
- Tests: `npm test` (unit) · `npm run test:integration` (startet Radicale per `uvx`, s. `scripts/dav-server.ts`).
- DAV-Befunde echter Server: `docs/dav/befunde/` (ohne Zugangsdaten); Erhebungsliste `docs/dav/erhebung-anforderungen.md`.
- Dach-Regeln gelten: `../AGENTS.md` (Kit-first, Release über `../tools/release/`, Store-Flow).
