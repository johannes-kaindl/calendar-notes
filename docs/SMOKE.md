# GUI-Smoke — `calendar-notes`

Getrackter CDP-Treiber (Skill `gui-smoke-setup`, CORE-TEST-02 b) — fährt die Checkliste
unten gegen ein **laufendes** Obsidian statt von Hand. Die Naht, die kein Unit-Test sieht:
`app.secretStorage`, `app.vault.adapter` (State-Dateien), echtes Frontmatter-Schreiben über
`app.fileManager.processFrontMatter`, die AdoptionModal/PreviewModal-DOM-Pfade, und ein echter
CalDAV/CardDAV-Server (Radicale).

## Voraussetzungen

⚠️ **Zuerst prüfen, wer sonst an Obsidian hängt.** Obsidian ist Single-Instance — ein
`quit` trifft die Instanz, an der möglicherweise eine andere Session arbeitet, und zerstört
deren Zustand. Der eigene Lauf ist danach sauber grün; der Schaden entsteht woanders und
fällt nicht auf.

```bash
lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "läuft bereits — NICHT beenden"
```

Hört der Port schon, dann **mitnutzen statt neu starten**: ein eigenes Fenster per
`vault-open` über IPC öffnen, dann `attachTo("workspace", port, vault)` — der Vault-Name
wählt, nicht die Reihenfolge. ⚠️ Die Port-Prüfung ersetzt die Frage nicht: sie zeigt aktive
CDP-Treiber, aber nicht, wer ein Fenster offen hält oder auf den Port wartet.

Erst wenn nichts läuft — oder nach Absprache mit dem, der es benutzt — gilt das Rezept unten.

```bash
osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222
OBSIDIAN_PLUGIN_DIR="<staging-vault>/.obsidian/plugins/calendar-notes" npm run deploy
```

Radicale oder `uvx` muss im PATH stehen (`pip install radicale` oder `brew install uv`) —
der Treiber startet seinen eigenen Server auf Port **5298** (nicht 5232, damit ein
parallel laufendes manuelles Radicale nicht kollidiert) und stoppt ihn im `finally`.

`STAGING_VAULTS_DIR` ist **Pflicht**: sie zeigt auf das eine Verzeichnis mit den
Staging-Vaults je Plugin, der Treiber nimmt daraus `$STAGING_VAULTS_DIR/calendar-notes`.
Fehlt sie, bricht er mit Anleitung ab — ein Default wäre ein zweiter Ort, und genau daraus
entstand der Drift vom 2026-08-30 (Vaults in zwei konkurrierenden Basen, ein vorhandener
Vault sah aus wie ein fehlender). Gesetzt wird sie einmalig in `~/.zshenv`; wo der Ort liegt,
steht in `obsidian-plugins/AGENTS.md` § Staging-Vaults. Einzelfall-Override:
`--vault-dir <pfad>`.

## Aufruf

```bash
npm run smoke:gui -- --setup                    # baut den Staging-Vault aus fixtures/vault neu
npm run smoke:gui -- --section generic           # Standard-Profile (Contacts/Events)
npm run smoke:gui -- --section pallas            # Profile aus Pallas-Notizen + Adoption
npm run smoke:gui -- --section todo              # Aufgaben-Spiegel (VTODO, M6a)
npm run smoke:gui -- --section generic --focus   # zusätzlich P8 (Settings-Fenster, Screenshot)
npm run smoke:gui -- --keep                      # erzeugten Zustand NICHT zurücksetzen
```

`--setup` baut den Vault einmalig aus dem Fixture (`fixtures/vault/`) — danach wird bei
offenem Fenster automatisch `app:reload` ausgelöst und auf die Rückkehr des Fensters
gewartet. Jeder `--section`-Lauf legt sein eigenes Konto (`acc-smoke`) + drei Sammlungen
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
| P1 | Laden | `Object.keys(app.commands.commands)` → 10 `calendar-notes:*`-Kommandos (5 aus M1–M3 + 5 seit M4: `run-on-note`/`new-event`/`new-contact`/`undo-last-change`/`push-hand-edits`); `app.setting.pluginTabs.find(id).getSettingDefinitions()` → 6 **benannte** Gruppen (Konten/Kalender & Adressbücher/Profile — welches Feld gehört wohin/Abgleich/Darstellung/Aktionen; Definitionen ohne `heading` werden vorher herausgefiltert). Stand 0.1.9 — die Liste ist wörtlich und soll rot werden, wenn sich die Oberfläche ändert |
| P2b | Auth über den echten UI-Weg | Läuft **vor** `seedAccount` und richtet sein eigenes Konto durch die Oberfläche ein: „+“ an der Konten-Überschrift (ein `.clickable-icon[aria-label]`, **kein** `<button>`) → Name/Server-Adresse/Benutzername in die Textfelder (mit `input`-Event, sonst läuft der `onChange` nicht) → an der Passwort-Zeile „Link…“ → Obsidian-Modal `.modal.mod-secret` → „Add secret…“ → Felder `ID` und `Secret` → Save. Zusicherung ist **nicht** „`secretId` ist gesetzt“, sondern dass `plugin.discoverAccount` danach **antwortet** (kein Wurf, ≥1 Sammlung). Grund, gemessen: mit dem nachgestellten 0.1.4-Defekt meldet der Punkt `"Zugang verweigert (401)"` **bei korrekt gesetzter `secretId`** — die naheliegende Zusicherung wäre in genau diesem Lauf grün gewesen. Räumt Konto, Sammlungen und Schlüsselbund-Eintrag selbst wieder weg, **und zwar auch vorher**: `deleteSecret` statt `setSecret("")` — ein nur geleerter Eintrag kollidiert beim nächsten „Add secret“ und lässt das Konto still auf `secretIdFor(account)` zurückfallen (Symptom: „No keychain entry is linked to this account“ statt 401). Erster Lauf grün, jeder weitere rot — genau so gemessen |
| P2a | Gegenprobe Auth | Läuft **vor** P2: Secret auf ein falsches Passwort setzen, `plugin.discoverAccount(account)` muss **werfen**, und die Meldung muss den Status **nennen** (`401`); danach setzt der Prüfpunkt das richtige Passwort selbst zurück. Radicale läuft dafür mit `htpasswd`-Auth (`fixtures/radicale/config`, Nutzer `test:test`, `rights = owner_only`). Erst P2a und P2 zusammen sagen etwas über Auth aus — ein Prüfpunkt, der nur den Erfolgsfall kennt, hätte auch den kaputten 0.1.4-Stand grün gemeldet |
| P2 | Konto + Discovery | Konto anlegen, Secret setzen, `plugin.discoverAccount(account)` + `plugin.settingTab.mergeDiscoveredCollections(...)` → **3** Sammlungen (Kalender, Kontakte, Aufgaben — die dritte seit dem VTODO-Fixture aus M6a/Task 10), 0 Warnungen. Läuft in **beiden** Sektionen — `generic` mit den Standard-Profilen (`default-contact`/`default-event`), `pallas` mit aus Pallas-Notizen abgeleiteten Profilen (`plugin.createProfileFromNote(kind, file)`) |
| P3 | Adoption (nur `--section pallas`) | `plugin.startAdoption(collectionId)` öffnet die echte AdoptionModal (vorbelegt: sure/likely → link, weak → skip, `defaultAction` in `adoption-modal.ts`); der Treiber klickt nur den vorbelegten „Verknüpfen“-Button (`.modal-container .mod-cta`), ohne Dropdowns zu ändern. Danach `plugin.service.runAll()` — verknüpfte Notizen werden aktualisiert statt neu angelegt, freier Body bleibt erhalten. |
| P4 | Trockenlauf + Sync (`generic`) | `plugin.service.runAll({dryRun:true})` → 5 creates (3 Termine + 2 Kontakte); echter Lauf → Dateien unter `Events/`/`Contacts/` mit `dav_uid`/`dav_source`/`dav_etag`-Frontmatter |
| P5 | Update-Pfad (`generic`) | Server-PUT auf `simple-1.ics` (Zeit + Beschreibung geändert) über echtes HTTP/Basic-Auth gegen Radicale, dann `plugin.runAll()` → `dav_etag` neu, Body enthält die neue Beschreibung, `handEdited` leer |
| P6 | Löschung (`generic`) | Server-DELETE auf `allday-1.ics`, Trockenlauf-Plan enthält `{op:"delete", mode:"trash"}`, echter Lauf → Datei aus `Events/` verschwunden (Papierkorb) |
| P7 | Zweiter Discovery-Lauf (`generic`) | `discoverAccount` + `mergeDiscoveredCollections` erneut — aktivierte Sammlungen bleiben aktiviert (Merge-Regel in `mergeDiscoveredCollections`). Erwartet: 3 Sammlungen, davon 2 aktiviert (`generic` lässt die Aufgaben-Sammlung aus) |
| P20 | Aufgaben-Sammlung (`--section todo`) | Die per `supported-calendar-component-set` als `VTODO` gemeldete Sammlung steht in `plugin.settings.collections` mit `kind === "calendar"`, trägt `components: ["VTODO"]` und lässt sich aktivieren |
| P21 | Aufgaben-Profil automatisch zugewiesen (`todo`) | Nach der Discovery trägt die Aufgaben-Sammlung `profileId === "default-todo"` — **und die Termin-Sammlung `default-event`**. Die zweite Hälfte ist die Gegenprobe im Prüfpunkt: bekäme jede Kalender-Sammlung `default-todo`, sähe der erste Vergleich genauso grün aus. Gemessen **vor** jeder eigenen Änderung des Treibers, sonst prüft er den selbst gesetzten Zustand |
| P22 | Sync legt die Notiz an (`todo`) | `plugin.service.runAll()`, danach **per `pollUntil`** die Notiz unter `Tasks/` mit `dav_uid === "radicale-todo-1@test"`. Die Zusicherung hängt am `dav_uid`, **nicht an der Anzahl**: ob die *erledigte* Fixture-Aufgabe mitgespiegelt wird, entscheidet `todoInWindow` am heutigen Datum (ihr `COMPLETED` liegt im August 2026) — eine Zahl wäre hier ein Prüferfolg mit Ablaufdatum. Das Detail des Prüfpunkts trägt das Sync-Ergebnis (`ok`/`created`/je Sammlung), damit ein rotes P22 selbst sagt, ob der Sync gar nicht lief, warf, oder lief und nichts anlegte |
| P23 | **Abgebildeter** Status (`todo`) | Frontmatter `status === "open"`, während der Server `STATUS:NEEDS-ACTION` liefert. **Das ist der eigentliche Punkt des Abschnitts** — ein Prüfpunkt auf „eine Notiz existiert" wäre auch dann grün, wenn `statusValue` gar nicht liefe |
| P24 | Sichtbarkeitsmarkierung (`todo`) | Frontmatter `type === "task"` — die Markierung kommt aus `onCreate` des Profils. **Nicht `tags`:** das ist im Todo-Profil auf das Server-Feld `CATEGORIES` gemappt und trägt bei der Fixture-Aufgabe `[Finanzen, Privat]`. Geprüft wird gegen das Frontmatter, nicht gegen TaskNotes (Ruling 13): der Staging-Vault führt kein TaskNotes, und die Spec zieht die Grenze bei *wir transportieren, TaskNotes verwaltet* |
| P8 | Settings-UI (nur `--focus`) | `app.setting.open()` + `openTabById`, `attachTo("settings", port)` auf das **eigene** Einstellungen-Fenster (Obsidian 1.13: eigenes Fenster, kein Modal im Hauptfenster); DOM enthält Passwort-`.setting-item`, Discovery-Button **und die Sammlungs-Auswahl** (`hasCollectionPicker`: unter der Überschrift steht ein echter `.checkbox-container`, nicht bloß die Überschrift — eine Überschrift ohne Zeilen darunter wäre genau der Fehlstand, der grün aussieht); Screenshot nach `docs/smoke/shots/settings.png` (gitignored) |
| P9 | Notices | Nach P5 keine Fehler-Notices (`EXCEPTION`/`ERROR`/„fehlgeschlagen”/„failed”) |
| P10 | Kommando via API (`generic`) | `plugin.api.plan("event.move", {start,end,tzid}, {uid:"simple-1@test",source})` → `execute` → `ok`; Server-GET auf `test/kalender/simple-1.ics` zeigt das neue `DTSTART`; Notiz-Frontmatter `start` zieht per `pollUntil` nach |
| P11 | Einladung ohne Scheduling/Transport (`generic`) | `plugin.api.plan("event.add-attendee", {email,name}, target)` → `plan.inviteRoute === "ics"` (Smoke-Konto hat weder `scheduling.outbox` noch registrierten Mail-Transport, s. `InviteRouter.route`) → `execute` → `invite.route === "ics"`, `invite.ics` enthält `METHOD:REQUEST` + `ATTENDEE` mit der neuen Adresse; Server-GET zeigt dasselbe `ATTENDEE` |
| P12 | Undo (`generic`) | Läuft DIREKT NACH P10 (vor P11) — `plugin.api.plan("undo.last", {}, target)` → `execute` → `ok`; Server-GET zeigt den VOR-P10-`DTSTART` wieder (per `davGet` vor P10 gemessen, nicht aus der Fixture geraten — P5 hat den Server-Stand vorher schon einmal geändert); Notiz-Frontmatter `start` zieht per `pollUntil` nach. Seit Fix-Runde 1 (Punkt 0): `undo.last` ist ein regulärer `commandRegistry()`-Eintrag (`kind: "any"`, `src/core/commands/undo.ts::UNDO_LAST_COMMAND`). |
| P13 | API-Lesen (`generic`) | `plugin.api.events({from,to})` enthält `simple-1@test`; `plugin.api.contacts({query:"Brandes"})` enthält Florian Brandes; `plugin.api.tools().length === plugin.api.commands().length`, keine Tool-Namen mit `.` (Registry ersetzt `.`→`_` in `toolDefinitions()`) |

Alle Prüfungen laufen über `cdp.evaluate` gegen `app.plugins.plugins["calendar-notes"]` —
private TS-Methoden (`startAdoption`, `confirmAdoption`, `discoverAccount`,
`createProfileFromNote`) sind zur Laufzeit ganz normale Objekteigenschaften (TS `private`
ist ein Compile-Zeit-Konzept) und darüber ohne Änderung an `main.ts` erreichbar.

## Behobener Befund (2026-08-23, Fix-Runde 1)

P10/P11/P13 waren strukturell rot (`commandRegistry()` blieb zur Laufzeit leer, s. „Offener
Befund" unten — der Abschnitt bleibt als Fundstelle stehen, ist aber KEIN offener Zustand
mehr). Behoben: `ensureDefaultCommands()` (`src/core/commands/registry.ts`) registriert
`EVENT_COMMANDS ∪ CONTACT_COMMANDS ∪ UNDO_LAST_COMMAND` idempotent — aufgerufen in
`main.ts::onload()` VOR `CommandFlow`/`createPluginApi` UND defensiv nochmal in
`createPluginApi` selbst. Live per CDP bestätigt (zweimal `disablePlugin`/`enablePlugin`
hintereinander): `commands().length` bleibt stabil bei 21, kein „Doppelte Kommando-ID"-Wurf.
`undo.last` ist dabei neu als regulärer Registry-Eintrag entstanden (`kind: "any"`,
`appliesTo` prüft `ctx.history?.length`) — macht P12 erstmals programmatisch prüfbar (lief
vorher nur als `⚠ übersprungen`). Lauf 4 (s. „Läufe" unten): generic 12/12, pallas 4/4.

## Behobener Befund (2026-08-22, Commit 14e4506)

Der erste Lauf (Lauf 1, s. Baseline) fand P3 strukturell rot: `candidateNotes()` schloss
Alex Aguado.md wegen eines vorbelegten `vcard_uid` aus dem eigenen abgeleiteten Profil aus,
und der Datums-Präfix im Dateinamen `2026-09-01 Zahnärztin.md` drückte die Titel-Ähnlichkeit
unter die `likely`-Schwelle. Commit `14e4506` („Review-Runde 2 — Kandidaten-Regel &
Termin-Titelvergleich (aus Live-Smoke)“) behebt beides — Kandidaten werden seither nur noch
über `dav_source` ausgeschlossen (nicht über ein beliebiges vorbelegtes `uidField`), und der
Datums-Präfix wird vor dem Titelvergleich von der Basename entfernt. Lauf 2 (s. Baseline)
bestätigt: P3/P3b jetzt grün, kein Regressions-Effekt in `--section generic`.

## Ehemals offener Befund (2026-08-23, M4/Task 8) — `commandRegistry()` wurde nie befüllt — BEHOBEN (s. Abschnitt oben)

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

## Lauf 2026-08-30 — 13/13 generic, 14/14 mit `--focus`

Nach dem B1-Umbau (Kalender-Auswahl auf der Konto-Unterseite, `4ed710c`) gefahren, gegen die
laufende Obsidian-Instanz (mitgenutzt, **nicht** neu gestartet — an ihr hingen an dem Abend
sieben Vaults aus parallelen Sessions).

- `--section generic`: **13/13**, keine Regression. P1 zählt weiterhin sechs Gruppen — der Umbau
  ist additiv, es fällt keine weg.
- `--section generic --focus`: **14/14**, P8 mit `hasCollectionPicker: true`.
- **Gegenprobe gefahren** (das Muster von P2a): mit einem absichtlich falschen
  `COLLECTION_PICKER_LABELS`-Wert wird P8 **rot** (13/14, `hasCollectionPicker: false`). Der
  Prüfpunkt misst also seinen Gegenstand und meldet nicht bloß Grün. Änderung danach verworfen.

⚠️ **Zwei Stolpersteine, die nichts mit dem Plugin zu tun hatten** und beim nächsten Lauf Zeit
sparen:

1. **P8 lief monatelang nicht** und trug deshalb die Discovery-Button-Beschriftung von *vor*
   0.1.9 — er wäre rot gewesen (`53b221a`). Ein Prüfpunkt hinter `--focus` altert unbemerkt,
   weil der Standardlauf ihn überspringt. Wer ein Label ändert, das P8 prüft, zieht es dort nach.
2. **Zwei Targets antworteten nicht auf `Runtime.evaluate`** (auch nach `Page.bringToFront`),
   und im Vault entstand **keine `.obsidian/workspace.json`**. Letzteres bleibt die nützliche
   Gegenprobe: kein `workspace.json` heißt *nicht geladen*, nicht *langsam*.

   ⚠️ **Korrektur der ersten Fassung dieses Absatzes (2026-08-30, noch am selben Abend):** hier
   stand als Ursache „ein nativer Dialog blockiert den Renderer". Das war **geraten, nicht
   gemessen** — und die Antwort stand längst im Dach. Die REGISTRY (§ Testing, erste Zeile,
   eingetragen am selben Tag) beschreibt exakt dieses Bild: ein **geschlossenes** Fenster bleibt
   bis zu ~90 s in `/json/list`, nimmt WebSocket-Verbindungen an und antwortet auf
   `Runtime.evaluate` **nie** — 30 s Hänger pro Leiche. **Merkmal: `title === url`.** Genau das
   trugen beide Targets (`app://obsidian.md/index.html` als Titel *und* als URL); ich habe es
   protokolliert, ohne es zu erkennen.

   **Die Lehre ist nicht der Fehlschluss, sondern der übersprungene Schritt:** der Katalog wird
   bei jedem Session-Start injiziert, damit man ihn *vor* dem Lösen liest. Ich habe ihn erst
   danach aufgeschlagen — beim Versuch, einen Eintrag zu ergänzen, der schon dastand. Vor der
   Ursachensuche gehört der Blick in die REGISTRY, nicht davor die eigene Hypothese.

## Ein deklarativer Settings-Tab lässt sich vom Workspace-Target aus bedienen

Beim Bau von P2b (2026-08-30) gemessen, weil drei Annahmen im Weg standen — alle drei waren falsch:

1. **Der Tab zeichnet nicht nach.** Er ist deklarativ (`getSettingDefinitions()`, kein
   `display()` — s. Kopf von `settings-tab.ts`); ein `display()`-Aufruf ist wirkungslos, und ein
   bereits offener Tab zeigt ein neu angelegtes Konto **nicht**. Wer den Kontostand ändert, muss
   `app.setting.close()` → warten → `open()` + `openTabById()` fahren. Symptom sonst: der
   Empty-State „No account yet." steht da, während `settings.accounts.length === 1` gilt.
2. **Es braucht keine zweite CDP-Verbindung.** Das Settings-DOM hängt in einem eigenen Fenster
   (`containerEl.ownerDocument !== document`, Fenstertitel „Settings - …"), ist aber über
   `plugin.settingTab.containerEl` aus dem **Workspace-Target** vollständig erreichbar — lesend
   wie klickend. Damit entfällt die Identitätsfrage, welches von mehreren Einstellungen-Fenstern
   `attachTo("settings")` erwischt: die Brücke trennt nach Vault, nicht nach Fenster. P8 nutzt
   weiterhin den zweiten Weg (er will einen Screenshot des Fensters); für alles andere ist
   `containerEl` der kürzere und eindeutige.
3. **Der Secret-Dialog blockiert nichts.** „Link…" öffnet ein normales Obsidian-Modal
   (`.modal.mod-secret`, „Select secret" → „Add secret" mit den Feldern `ID`/`Secret`), kein
   nativer Dialog: der Renderer antwortet, während es offen steht. Das war die Frage, an der der
   Prüfpunkt zwei Sessions lang hing.

⚠️ Und ein vierter Befund, der nichts mit Obsidian zu tun hat, sondern mit Prüfpunkten: **der
erste grüne Lauf war ein Zufall.** P2b legte sein Secret an und *leerte* es beim Aufräumen
(`setSecret(id, "")`) statt es zu löschen; ab Lauf 2 kollidierte die ID im „Add secret"-Dialog,
die Verknüpfung unterblieb still, und das Konto fiel auf `secretIdFor(account)` zurück. Gefunden
wurde das nur, weil nach der Gegenprobe **erneut grün** erwartet und stattdessen rot gemessen
wurde. Ein Prüfpunkt, der einmal grün war, ist nicht wiederholbar — das ist eine eigene Zusage,
und sie kostet zwei Läufe hintereinander.

## Läufe

- **2026-08-30, Lauf mit P2b** — Obsidian 1.13.7, macOS, Commit vor dem P2b-Commit.
  `--section generic` **14/14**, zweimal hintereinander (Wiederholbarkeit), und mit
  `--focus` **15/15**. Gegenprobe gefahren: `onChange` auf den 0.1.4-Fehler zurückgedreht,
  gebaut, deployt, Plugin per `disablePlugin`/`enablePlugin` neu geladen → **P2b rot**
  (`"Zugang verweigert (401)"`, `Sammlungen=0`, `secretId` korrekt gesetzt), P2a und P2
  blieben grün. Zurückgedreht → wieder 14/14.
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
- **2026-08-23, Lauf 4 (Fix-Runde 1)** — Obsidian 1.13.7, macOS, Commit `2672183` + lokale
  Fix-Runde-1-Änderungen (`ensureDefaultCommands()`, `undo.last`, async `InviteRouter.route()`,
  RFC5545-Zeilenfaltung im Treiber selbst behoben). `--section generic` **12/12** (P10/P11/P12/
  P13 jetzt grün) + `--section pallas` **4/4** (keine Regression). Live per CDP zweimal
  `disablePlugin`/`enablePlugin` — `commandRegistry()` bleibt stabil bei 21 Einträgen.

- **2026-09-03, Lauf 5 (M6a/Task 11, Aufgaben-Spiegel)** — Obsidian 1.14.0, macOS, Branch
  `feat/m6a-vtodo-mirror`. Neuer Abschnitt `--section todo`: **9/9 zweimal hintereinander**,
  danach `--section generic` **14/14**. Der Lauf hat drei Befunde erzeugt, die ohne ihn nicht
  aufgefallen wären — der erste ist der Grund, warum diese Etappe einen GUI-Smoke braucht:

  1. ⚠️ **M6a lieferte seine Hauptfunktion nicht.** `src/core/dav/requests.ts` baut die
     `calendar-query` mit einem fest auf `VEVENT` verdrahteten `comp-filter`, und
     `service.ts` entschied anhand von `col.kind` (calendar/addressbook), ob dieser Weg
     genommen wird. Eine VTODO-Sammlung ist `col.kind === "calendar"` — sie bekam also den
     Termin-Pfad und lieferte **strukturell null Treffer**, ohne Fehler und ohne Warnung.
     `apply.ts` konnte Aufgaben längst verarbeiten, es kam nur nie eine an.
     **Warum 608 grüne Unit-Tests das nicht sahen:** sie füttern `apply.ts` mit bereits
     geholten Rohdaten; die Lücke lag exakt zwischen den Schichten. **Warum `assertNever` es
     nicht sah:** der Wächter sichert die `ProfileKind`-Achse (event/contact/todo) ab, und
     diese Stelle verzweigt auf der `CollectionKind`-Achse (calendar/addressbook), an der
     sich nichts geändert hatte. *Ein Typ-Wächter schützt nur die Achse, an der er steht.*
     Behoben: die Verzweigung fragt jetzt `profile.kind`; Aufgaben-Sammlungen bekommen
     **kein** serverseitiges `time-range` (offene Aufgaben liegen laut Spec § 7 IMMER im
     Fenster, auch ohne Datum — ein Serverfilter schnitte genau die weg) und werden über
     `PROPFIND Depth 1` gelistet, clientseitig gefiltert von `todoInWindow`. Regressionstest:
     `tests/core/sync/service.test.ts`, „holt eine Aufgaben-Sammlung ohne calendar-query".
  2. **Der Treiber lud das Plugin nie neu.** Ein offenes Fenster hält den Bundle, der beim
     Öffnen im Speicher landete; ein frisch deployter `main.js` wird nicht übernommen. Der
     Lauf misst dann den alten Stand — unauffällig, weil die Prüfpunkte grün bleiben, sie
     sagen nur nichts über den gebauten Build. Am teuersten trifft das die **Gegenprobe**:
     der eingebaute Defekt liegt gar nicht im laufenden Plugin, sie bleibt grün und sieht aus
     wie eine, die nichts findet. `disablePlugin`/`enablePlugin` läuft jetzt vor jeder
     Messung. *(Der Anstoß kam als Meldung von `markdown-presentation`. ⚠️ **Diese Stelle
     führte deren Lagebeschreibung zunächst als falsch — das war meine Fehllesung, nicht
     ihr Fehler.** Sie schrieb, ihr Treiber tue das „hier" bereits; „hier" meinte ihr Repo,
     und dort stimmt es (Reload im Messpfad, Ausgabe „frisch geladen"). Ich las es als
     Aussage über meinen Treiber und maß dort nach — wo der Reload tatsächlich fehlte.
     **Beide Sätze waren wahr, und genau deshalb fiel es keinem auf: ein Deiktikon zeigt
     beim Absender auf sein Repo und beim Empfänger auf dessen.** Zwischen Repo-Sessions
     ist das die Normalform des Missverstehens; die Vorkehrung kostet vier Wörter — das
     Repo benennen statt zu zeigen.)*
     ⓘ **Warum das vorhandene Sicherungsmittel nicht greift:** `requireEigenerBuild` (aus
     `tools/obsidian-cdp/vault.ts`, in 15 Treibern die erste Handlung) vergleicht die
     deployte `main.js` per sha1 mit der im Repo — das belegt die **Herkunft** des Builds,
     nicht, dass der laufende Prozess ihn geladen hat. Die Prüfung zielt also knapp daneben.
     Dieser Treiber nutzt sie bislang gar nicht; das ist eine eigene, offene Lücke.
  3. **Das VTODO-Fixture hatte `generic` still beschädigt.** Seit Task 10 liegt eine dritte
     Sammlung im Home-Set; `discoverAndMerge` wählte den Kalender über
     `find(c => c.kind === "calendar")`, also über die Reihenfolge, und Radicale sortiert
     nicht. Dazu prüften P2 und P7 die Sammlungszahl gegen die veraltete `2`. Derselbe Fehler
     war im Integrationstest schon behoben (`299594e`) — der Zwilling im Treiber blieb stehen,
     weil die Task-10-Review nur `tests/` ansah. Behoben: namentliche Wahl, Zahlen auf 3.

  **Gegenprobe (Schritt 4 des Plans):** `statusValue` in `todo-values.ts` auf den Rohwert
  zurückgedreht, gebaut, deployt, Plugin neu geladen. Ergebnis exakt wie gefordert — **P23
  wird rot** (`status="NEEDS-ACTION"` statt `"open"`), **P20/P21/P22/P24 bleiben grün**.
  Danach zurückgenommen, neu gebaut, Abschnitt erneut **9/9**.

Vollständiges Protokoll: `docs/smoke/baseline-2026-08-22.md` (Lauf 1+2), `docs/smoke/baseline-2026-08-23.md` (Lauf 3+4).
