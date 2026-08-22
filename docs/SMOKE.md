# GUI-Smoke — `calendar-notes`

Getrackter CDP-Treiber (Skill `gui-smoke-setup`, CORE-TEST-02 b) — fährt die Checkliste
unten gegen ein **laufendes** Obsidian statt von Hand. Die Naht, die kein Unit-Test sieht:
`app.secretStorage`, `app.vault.adapter` (State-Dateien), echtes Frontmatter-Schreiben über
`app.fileManager.processFrontMatter`, die AdoptionModal/PreviewModal-DOM-Pfade, und ein echter
CalDAV/CardDAV-Server (Radicale).

## Voraussetzungen

```bash
osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222
OBSIDIAN_PLUGIN_DIR="<staging-vault>/.obsidian/plugins/calendar-notes" npm run deploy
```

Radicale oder `uvx` muss im PATH stehen (`pip install radicale` oder `brew install uv`) —
der Treiber startet seinen eigenen Server auf Port **5298** (nicht 5232, damit ein
parallel laufendes manuelles Radicale nicht kollidiert) und stoppt ihn im `finally`.

`STAGING_VAULTS_DIR` ist optional: gesetzt, zeigt es auf das Verzeichnis mit den
Staging-Vaults je Plugin (`$STAGING_VAULTS_DIR/calendar-notes`); ungesetzt fällt der
Treiber auf `$HOME/StagingVaults/calendar-notes` zurück (mit Hinweis-Zeile) — überschreibbar
mit `--vault-dir <pfad>`.

## Aufruf

```bash
npm run smoke:gui -- --setup                    # baut den Staging-Vault aus fixtures/vault neu
npm run smoke:gui -- --section generic           # Standard-Profile (Contacts/Events)
npm run smoke:gui -- --section pallas            # Profile aus Pallas-Notizen + Adoption
npm run smoke:gui -- --section generic --focus   # zusätzlich P8 (Settings-Fenster, Screenshot)
npm run smoke:gui -- --keep                      # erzeugten Zustand NICHT zurücksetzen
```

`--setup` baut den Vault einmalig aus dem Fixture (`fixtures/vault/`) — danach wird bei
offenem Fenster automatisch `app:reload` ausgelöst und auf die Rückkehr des Fensters
gewartet. Jeder `--section`-Lauf legt sein eigenes Konto (`acc-smoke`) + zwei Sammlungen
gegen das eigene Radicale an, snapshotet Vault-Notizen + Plugin-Settings + State-Dateien
VOR jeder Änderung und stellt sie im `finally` wieder her (außer `--keep`) — unabhängig
davon, ob die Prüfpunkte grün oder rot waren.

⚠️ **Nie gegen das `10_Pallas`-Fenster laufen lassen** — der Treiber schreibt Testdaten
und Server-Zugangsdaten in das Fenster, das über `--vault` (Default `calendar-notes`)
ausgewählt wird; mehrere offene Vault-Fenster erzwingen eine eindeutige Auswahl
(`Cdp.attach`/`attachTo` brechen sonst ab).

## Prüfpunkte

| # | Titel | Wie gemessen |
|---|---|---|
| P1 | Laden | `Object.keys(app.commands.commands)` → 10 `calendar-notes:*`-Kommandos (5 aus M1–M3 + 5 seit M4: `run-on-note`/`new-event`/`new-contact`/`undo-last-change`/`push-hand-edits`); `app.setting.pluginTabs.find(id).getSettingDefinitions()` → 5 Gruppen (Konten/Sammlungen/Profile/Synchronisation/Aktionen) |
| P2 | Konto + Discovery | Konto anlegen, Secret setzen, `plugin.discoverAccount(account)` + `plugin.settingTab.mergeDiscoveredCollections(...)` → 2 Sammlungen, 0 Warnungen. Läuft in **beiden** Sektionen — `generic` mit den Standard-Profilen (`default-contact`/`default-event`), `pallas` mit aus Pallas-Notizen abgeleiteten Profilen (`plugin.createProfileFromNote(kind, file)`) |
| P3 | Adoption (nur `--section pallas`) | `plugin.startAdoption(collectionId)` öffnet die echte AdoptionModal (vorbelegt: sure/likely → link, weak → skip, `defaultAction` in `adoption-modal.ts`); der Treiber klickt nur den vorbelegten „Verknüpfen“-Button (`.modal-container .mod-cta`), ohne Dropdowns zu ändern. Danach `plugin.service.runAll()` — verknüpfte Notizen werden aktualisiert statt neu angelegt, freier Body bleibt erhalten. |
| P4 | Trockenlauf + Sync (`generic`) | `plugin.service.runAll({dryRun:true})` → 5 creates (3 Termine + 2 Kontakte); echter Lauf → Dateien unter `Events/`/`Contacts/` mit `dav_uid`/`dav_source`/`dav_etag`-Frontmatter |
| P5 | Update-Pfad (`generic`) | Server-PUT auf `simple-1.ics` (Zeit + Beschreibung geändert) über echtes HTTP/Basic-Auth gegen Radicale, dann `plugin.runAll()` → `dav_etag` neu, Body enthält die neue Beschreibung, `handEdited` leer |
| P6 | Löschung (`generic`) | Server-DELETE auf `allday-1.ics`, Trockenlauf-Plan enthält `{op:"delete", mode:"trash"}`, echter Lauf → Datei aus `Events/` verschwunden (Papierkorb) |
| P7 | Zweiter Discovery-Lauf (`generic`) | `discoverAccount` + `mergeDiscoveredCollections` erneut — aktivierte Sammlungen bleiben aktiviert (Merge-Regel in `mergeDiscoveredCollections`) |
| P8 | Settings-UI (nur `--focus`) | `app.setting.open()` + `openTabById`, `attachTo("settings", port)` auf das **eigene** Einstellungen-Fenster (Obsidian 1.13: eigenes Fenster, kein Modal im Hauptfenster); DOM enthält Passwort-`.setting-item` + Discovery-Button; Screenshot nach `docs/smoke/shots/settings.png` (gitignored) |
| P9 | Notices | Nach P5 keine Fehler-Notices (`EXCEPTION`/`ERROR`/„fehlgeschlagen”/„failed”) |
| P10 | Kommando via API (`generic`) | `plugin.api.plan("event.move", {start,end,tzid}, {uid:"simple-1@test",source})` → `execute` → `ok`; Server-GET auf `test/kalender/simple-1.ics` zeigt das neue `DTSTART`; Notiz-Frontmatter `start` zieht per `pollUntil` nach |
| P11 | Einladung ohne Scheduling/Transport (`generic`) | `plugin.api.plan("event.add-attendee", {email,name}, target)` → `plan.inviteRoute === "ics"` (Smoke-Konto hat weder `scheduling.outbox` noch registrierten Mail-Transport, s. `InviteRouter.route`) → `execute` → `invite.route === "ics"`, `invite.ics` enthält `METHOD:REQUEST` + `ATTENDEE` mit der neuen Adresse; Server-GET zeigt dasselbe `ATTENDEE` |
| P12 | Undo (`generic`) | ⚠ P12 übersprungen: kein programmatischer Undo-Pfad; Follow-up: `undo.last` in die Registry + API. Detail: `CommandFlow.undoLast()`/`runUndo()` hängen an `app.workspace.getActiveFile()` und öffnen immer die `PlanPreviewModal`; die Plugin-API kennt kein `undo()`, und `undo.last` steht nicht in der `commandRegistry()` (nur die reine `planUndoLast()`-Funktion existiert, nicht darüber erreichbar). |
| P13 | API-Lesen (`generic`) | `plugin.api.events({from,to})` enthält `simple-1@test`; `plugin.api.contacts({query:"Brandes"})` enthält Florian Brandes; `plugin.api.tools().length === plugin.api.commands().length`, keine Tool-Namen mit `.` (Registry ersetzt `.`→`_` in `toolDefinitions()`) |

Alle Prüfungen laufen über `cdp.evaluate` gegen `app.plugins.plugins["calendar-notes"]` —
private TS-Methoden (`startAdoption`, `confirmAdoption`, `discoverAccount`,
`createProfileFromNote`) sind zur Laufzeit ganz normale Objekteigenschaften (TS `private`
ist ein Compile-Zeit-Konzept) und darüber ohne Änderung an `main.ts` erreichbar.

## Behobener Befund (2026-08-22, Commit 14e4506)

Der erste Lauf (Lauf 1, s. Baseline) fand P3 strukturell rot: `candidateNotes()` schloss
Alex Aguado.md wegen eines vorbelegten `vcard_uid` aus dem eigenen abgeleiteten Profil aus,
und der Datums-Präfix im Dateinamen `2026-09-01 Zahnärztin.md` drückte die Titel-Ähnlichkeit
unter die `likely`-Schwelle. Commit `14e4506` („Review-Runde 2 — Kandidaten-Regel &
Termin-Titelvergleich (aus Live-Smoke)“) behebt beides — Kandidaten werden seither nur noch
über `dav_source` ausgeschlossen (nicht über ein beliebiges vorbelegtes `uidField`), und der
Datums-Präfix wird vor dem Titelvergleich von der Basename entfernt. Lauf 2 (s. Baseline)
bestätigt: P3/P3b jetzt grün, kein Regressions-Effekt in `--section generic`.

## Offener Befund (2026-08-23, M4/Task 8) — `commandRegistry()` wird nie befüllt

P10/P11/P13 sind strukturell rot: `plugin.api.plan()`/`commands()`/`tools()` finden **keine**
Kommandos. Ursache: `src/main.ts` importiert `EVENT_COMMANDS`/`CONTACT_COMMANDS` (aus
`src/core/commands/event-commands.ts`/`contact-commands.ts`) nirgends und ruft die core
`registerCommands()` (`src/core/commands/registry.ts`) nirgends auf — nur Tests befüllen die
Registry manuell (`tests/obsidian/api.test.ts`). Zur Laufzeit ist `commandRegistry()` also leer:
`commandsFor(ctx)` in `CommandFlow.startRun()` liefert immer `[]` („Keine anwendbaren
Kommandos"), `api.plan(id, …)` liefert immer `{error:"command-not-found"}`, `api.commands()`/
`api.tools()` immer `[]`. **Hypothese für den Fix** (nicht in dieser Aufgabe umgesetzt, s.
Global-Constraint „nicht über den Task-8-Scope hinaus an `src/` reparieren"): in `src/main.ts`
`onload()`, vor `this.commandFlow = new CommandFlow(...)` (Zeile ~119), einmalig
`registerCommands([...EVENT_COMMANDS, ...CONTACT_COMMANDS])` aufrufen — mit einer Guard-Prüfung
(`commandRegistry().length === 0`), damit ein Plugin-Reload (`disablePlugin`/`enablePlugin` im
selben Obsidian-Prozess, falls das je vorkommt) nicht in die „Doppelte Kommando-ID"-Exception aus
`registerCommands()` läuft.

## Läufe

- **2026-08-22, Lauf 1** — Obsidian 1.13.7, macOS, Commit `bbd9fe0`. `--setup` +
  `--section generic` (8/8) + `--section pallas` (2/4 — P3/P3b rot, Fixture/Matcher-Befund
  oben, seither behoben).
- **2026-08-22, Lauf 2** — Obsidian 1.13.7, macOS, Commit `14e4506` (Matcher-Fix,
  Plugin per `disablePlugin`/`enablePlugin` neu geladen, keine Vault-Neuinstallation).
  `--section pallas` (4/4) + `--section generic` erneut (8/8, keine Regression).
- **2026-08-23, Lauf 3 (M4/Task 8)** — Obsidian 1.13.7, macOS, Commit `58b43d0` + lokale
  Task-8-Änderungen. `--setup` + `--section generic` (8/11 — P10/P11/P13 rot, Befund oben;
  P12 ⚠ übersprungen, kein Regressions-Effekt auf P1–P9) + `--section pallas` (4/4, keine
  Regression).

Vollständiges Protokoll: `docs/smoke/baseline-2026-08-22.md` (Lauf 1+2), `docs/smoke/baseline-2026-08-23.md` (Lauf 3).
