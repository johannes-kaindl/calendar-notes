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
| P1 | Laden | `Object.keys(app.commands.commands)` → 5 `calendar-notes:*`-Kommandos; `app.setting.pluginTabs.find(id).getSettingDefinitions()` → 5 Gruppen (Konten/Sammlungen/Profile/Synchronisation/Aktionen) |
| P2 | Konto + Discovery | Konto anlegen, Secret setzen, `plugin.discoverAccount(account)` + `plugin.settingTab.mergeDiscoveredCollections(...)` → 2 Sammlungen, 0 Warnungen. Läuft in **beiden** Sektionen — `generic` mit den Standard-Profilen (`default-contact`/`default-event`), `pallas` mit aus Pallas-Notizen abgeleiteten Profilen (`plugin.createProfileFromNote(kind, file)`) |
| P3 | Adoption (nur `--section pallas`) | `plugin.startAdoption(collectionId)` öffnet die echte AdoptionModal (vorbelegt: sure/likely → link, weak → skip, `defaultAction` in `adoption-modal.ts`); der Treiber klickt nur den vorbelegten „Verknüpfen“-Button (`.modal-container .mod-cta`), ohne Dropdowns zu ändern. Danach `plugin.service.runAll()` — verknüpfte Notizen werden aktualisiert statt neu angelegt, freier Body bleibt erhalten. **Siehe Befund unten — bei diesem Fixture-Stand rot, s. Baseline.** |
| P4 | Trockenlauf + Sync (`generic`) | `plugin.service.runAll({dryRun:true})` → 5 creates (3 Termine + 2 Kontakte); echter Lauf → Dateien unter `Events/`/`Contacts/` mit `dav_uid`/`dav_source`/`dav_etag`-Frontmatter |
| P5 | Update-Pfad (`generic`) | Server-PUT auf `simple-1.ics` (Zeit + Beschreibung geändert) über echtes HTTP/Basic-Auth gegen Radicale, dann `plugin.runAll()` → `dav_etag` neu, Body enthält die neue Beschreibung, `handEdited` leer |
| P6 | Löschung (`generic`) | Server-DELETE auf `allday-1.ics`, Trockenlauf-Plan enthält `{op:"delete", mode:"trash"}`, echter Lauf → Datei aus `Events/` verschwunden (Papierkorb) |
| P7 | Zweiter Discovery-Lauf (`generic`) | `discoverAccount` + `mergeDiscoveredCollections` erneut — aktivierte Sammlungen bleiben aktiviert (Merge-Regel in `mergeDiscoveredCollections`) |
| P8 | Settings-UI (nur `--focus`) | `app.setting.open()` + `openTabById`, `attachTo("settings", port)` auf das **eigene** Einstellungen-Fenster (Obsidian 1.13: eigenes Fenster, kein Modal im Hauptfenster); DOM enthält Passwort-`.setting-item` + Discovery-Button; Screenshot nach `docs/smoke/shots/settings.png` (gitignored) |
| P9 | Notices | Nach P5 keine Fehler-Notices (`EXCEPTION`/`ERROR`/„fehlgeschlagen“/„failed“) |

Alle Prüfungen laufen über `cdp.evaluate` gegen `app.plugins.plugins["calendar-notes"]` —
private TS-Methoden (`startAdoption`, `confirmAdoption`, `discoverAccount`,
`createProfileFromNote`) sind zur Laufzeit ganz normale Objekteigenschaften (TS `private`
ist ein Compile-Zeit-Konzept) und darüber ohne Änderung an `main.ts` erreichbar.

## Bekannter Befund: P3 ist mit dem aktuellen Fixture-Stand strukturell rot

Der Treiber deckt zwei reale Diskrepanzen zwischen der Fixture-Spezifikation
(`docs/superpowers/plans/2026-08-22-m3-adoption-smoke.md`) und dem, was `matchItems`/
`candidateNotes` tatsächlich damit tun, auf — **kein Treiberfehler**, s. Baseline-Protokoll
für die vollständige Diagnose:

1. **Alex Aguado.md trägt laut Plan-Vorgabe bereits `vcard_uid: a4843c7a6d3005dd`** (ein
   Platzhalter, der NICHT der echten `c4.vcf`-UID entspricht). Ein aus dieser Notiz
   abgeleitetes Profil (`createProfileFromNote`) übernimmt `vcard_uid` als `uidField`
   (`UID_KEYS`-Erkennung in `profile-from-note.ts`) — und `candidateNotes()` schließt jede
   Notiz mit bereits belegtem `uidField` aus dem Kandidatenpool aus. Die Notiz, aus der das
   Profil abgeleitet wird, kann sich damit per Konstruktion nie selbst als Adoptions-Ziel
   qualifizieren.
2. **Der Datums-Präfix im Dateinamen** (`2026-09-01 Zahnärztin.md`) senkt die
   Titel-Ähnlichkeit (`bestTitleSim`, Jaccard/Dice über normalisierte Tokens) unter die
   0.6-Schwelle für `likely` — der Server-Titel „Zahnärztin Dr. Müller“ vs. Notiz-Tokens
   `["2026","09","01","zahnärztin"]` ergibt ca. 0.2, nicht `likely` sondern `weak`
   (Default-Aktion `skip`, nicht `link`).

Ergebnis: 0 Verknüpfungen in beiden Pallas-Sammlungen. Empfehlung an den Plan-Owner: entweder
`vcard_uid` aus dem Fixture entfernen (Alex wird dann über Telefon `sure` matchbar) und die
`likely`-Erwartung für Zahnärztin auf `weak` korrigieren — oder den Titel-Schwellenwert/die
Namens-Kandidaten (`bestTitleSim`) um den Dateinamen-Präfix bereinigen. Nicht im Scope
dieses Treibers behoben (Fixture-Änderung wäre ein Eingriff außerhalb der zugewiesenen
Dateien).

## Läufe

- **2026-08-22** — Obsidian 1.13.7, macOS. `--setup` + `--section generic` (8/8) +
  `--section pallas` (2/4, s. Befund oben). Vollständiges Protokoll:
  `docs/smoke/baseline-2026-08-22.md`.
