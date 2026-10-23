# AGENTS — calendar-notes

CalDAV-Termine, CardDAV-Kontakte und VTODO-Aufgaben als Notiz-Spiegel; der Server ist die Wahrheit, geschrieben wird nur über Kommandos.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md` im Multi-Projekt-Workspace des Maintainers, `../../workspace/_docs` relativ zu diesem Repo — nicht Teil dieses Repos, ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

## Architecture principles

- `src/core/**` ist obsidian-, DOM- und node-frei (`npm run check:pure`). Der Transport wird injiziert.
- Kit-Module nur über `tools/sync-kit.sh` (Herkunfts-Header), nie von Hand.
- **Der Server ist die Wahrheit.** Notizen schreibt der Sync, Änderungen am Server laufen nur über Kommandos mit Vorschau (`plan()`/`execute()`).
- **Aufgaben (VTODO):** TaskNotes verwaltet, calendar-notes transportiert. Gelesen wird nur `api.model` und `api.catalog` der TaskNotes-API, **niemals `api.tasks.*`**.
- Aufbau und Warum: `docs/internal/architecture.md`, `docs/internal/decisions.md`.

## Commands

```bash
npm test                     # Unit (check-no-abs-paths + vitest, ohne tests/integration)
npm run test:integration     # startet Radicale per uvx, s. scripts/dav-server.ts
npm run gate                 # lint + typecheck (+test, +scripts) + test + check:pure + build
npm run smoke:gui -- --port <p> [--setup] [--section generic|pallas|todo] [--focus]   # GUI-Smoke, siehe docs/SMOKE.md
npm run shots                # README-Bilder (Skill readme-shots)
npm run deploy               # build + cp nach $OBSIDIAN_PLUGIN_DIR
```

Manuelles Deploy ins Staging-Vault: `OBSIDIAN_PLUGIN_DIR=<staging-vault>/.obsidian/plugins/calendar-notes npm run deploy` (Staging-Vault `$STAGING_VAULTS_DIR/calendar-notes`, Regeln in `../.claude/rules/staging-vaults.md`). Der Smoke braucht ein laufendes Obsidian in einer Zweitinstanz und den CDP-Lock; Rezept in `scripts/gui-smoke.ts` (Kopf) und `../.claude/rules/obsidian-instanz.md`.

## Releasing

`npm run release -- <version>` ruft das zentrale Tooling im Dach (`../tools/release/`). Ablauf, Mirror, Store-Review und Rescan: `../.claude/rules/release-und-store.md`; Maintainer-Handover und Scorecard-Vorschau im Cockpit (`_Intern/RELEASE.md`, `_Intern/STORE.md`). Vorher `npm run gate && npm run test:integration && npm run typecheck:scripts` und `npm run smoke:gui` (alle drei Abschnitte) grün, README-Bilder aufgenommen, `shots:check` grün. Der Tag ist nicht das Ende: Rescan im Developer Dashboard anstoßen und den Status prüfen.

## Conventions

- `eslint.config.mjs` und `scripts/check-no-inline-disables.mjs` sind Template-Kopien (Dach `tools/release-template/`).
- Specs und Pläne liegen im Vault-Cockpit unter `_SDD/` (CORE-META-14), interne Doku (Release, Store, Erhebungen, Registry-Kandidaten) unter `_Intern/`; DAV-Befunde echter Server (`_Intern/dav-befund-mailbox-org.md`, `_Intern/erhebung-anforderungen.md`) ohne Zugangsdaten.
- Dach-Regeln gelten: `../AGENTS.md` (Kit-first, Release über `../tools/release/`, Store-Flow).

## Gotchas

- **Der Transport kennt keine finale URL:** Obsidians `requestUrl` folgt Weiterleitungen selbst; Adressen kommen aus der Antwort (`<d:href>`), nie aus der Anfrage. Details: `.claude/rules/transport-und-discovery.md`.
- **`SecretComponent` bindet einen Schlüsselbund-Eintrag, kein Passwort:** `onChange` liefert die ID, nie den Wert. Der GUI-Smoke prüft das mit P2a/P2b. Details: `.claude/rules/zugangsdaten.md`.

## Context index

- Bevor du `src/core/dav/`, den Transport oder die Erkennung von Sammlungen änderst: `.claude/rules/transport-und-discovery.md`.
- Bevor du Konten, Secrets oder die Passwort-Zeile im Settings-Tab anfasst: `.claude/rules/zugangsdaten.md`.
- Bevor du Adoption, Matching oder die Profil-Ableitung aus einer Notiz änderst oder einen Lauf gegen ein gewachsenes Vault vorbereitest: `.claude/rules/adoption.md`.
- Bevor du Aufgaben (VTODO), die TaskNotes-Anbindung oder `ProfileKind`/`CollectionKind` anfasst: `.claude/rules/aufgaben-vtodo.md`.
- Bevor du Kommandos, die Plugin-API, Einladungen oder `src/core/sync/execute.ts` änderst: `.claude/rules/kommandos-und-api.md`.
- Vor Änderungen an Modul-Layout, Datenfluss oder Smoke-Abschnitten: `docs/internal/architecture.md`.
- Bevor du eine Altentscheidung (Server ist Wahrheit, VTODO-Grenze, Schlüssel statt Texte, iMIP-Kopie) übernimmst: `docs/internal/decisions.md`.
- Vor dem GUI-Smoke: `docs/SMOKE.md`; Treiber-Regeln des Dachs in `../.claude/rules/gui-smoke-treiber.md`, Instanz und Lock in `../.claude/rules/obsidian-instanz.md` und `../.claude/rules/cdp-lock.md`.
- Vor einem Release oder Store-Rescan: `../.claude/rules/release-und-store.md`, Skills `plugin-release-setup` und `store-rescan`.
- Vor UI-Arbeit: `../UI-STANDARD.md`, `../.claude/rules/ui-bausteine.md`; vor Änderungen an `styles.css`: `../.claude/rules/store-css.md`; vor README-Bildern: `../.claude/rules/readme-shots.md`.

## Memory

Projekt-Memory unter `~/.claude/projects/<slug>/memory/` (Index: `MEMORY.md`). Session-Handoff unter `.remember/` (gitignored).
