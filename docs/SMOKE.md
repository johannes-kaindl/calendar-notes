# GUI-Smoke — `calendar-notes`

Getrackter CDP-Treiber (Skill `gui-smoke-setup`, CORE-TEST-02 b) — fährt die Checkliste
unten gegen ein **laufendes** Obsidian statt von Hand. Die Naht, die kein Unit-Test sieht:
`app.secretStorage`, `app.vault.adapter` (State-Dateien), echtes Frontmatter-Schreiben über
`app.fileManager.processFrontMatter`, die AdoptionModal/PreviewModal-DOM-Pfade, und ein echter
CalDAV/CardDAV-Server (Radicale).

## Voraussetzungen

⚠️ **Zuerst prüfen, wer sonst an Obsidian hängt.** Ein `quit` trifft die Instanz, an der
möglicherweise eine andere Session arbeitet, und zerstört deren Zustand. Der eigene Lauf ist
danach sauber grün; der Schaden entsteht woanders und fällt nicht auf. Was gerade offen ist,
beantwortet `/json/list` (der Fenstertitel trägt den Vault) — **nicht** der CDP-Lock: den hält
nur, wer gerade misst, ein offenes Fremdfenster ist keine Messung.

ⓘ Hier stand „Obsidian ist Single-Instance". Das ist seit dem 2026-09-02 widerlegt (Dach-
`AGENTS.md` § Staging-Vaults): die Sperre hängt am Profil, nicht am Rechner — mit eigenem
`--user-data-dir` und eigenem Debug-Port läuft eine zweite Instanz daneben. Für **destruktive**
Arbeit (Absturz reproduzieren, quitten, dutzendfach neu laden) ist das der richtige Ort statt
einer Nachfrage. Für einen normalen Smoke-Lauf bleibt es beim Mitnutzen.

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
npm run smoke:gui -- --section todo              # Aufgaben-Spiegel + Rückschreiben (VTODO, M6a/M6b)
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
| P1 | Laden | `Object.keys(app.commands.commands)` → **11** `calendar-notes:*`-Kommandos (5 aus M1–M3 + 5 seit M4: `run-on-note`/`new-event`/`new-contact`/`undo-last-change`/`push-hand-edits`, + `todo-sync` seit M6b); `app.setting.pluginTabs.find(id).getSettingDefinitions()` → 6 **benannte** Gruppen (Konten/Kalender & Adressbücher/Profile — welches Feld gehört wohin/Abgleich/Darstellung/Aktionen; Definitionen ohne `heading` werden vorher herausgefiltert). Stand 0.1.9 — die Liste ist wörtlich und soll rot werden, wenn sich die Oberfläche ändert |
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
| P25 | Kommando nur bei aktiver Aufgaben-Sammlung (`todo`) | `app.commands.commands["calendar-notes:todo-sync"].checkCallback(true)` → `true`; danach **im selben Prüfpunkt** alle Sammlungen im Speicher deaktivieren → `false`, dann zurück. Die zweite Hälfte ist die Gegenprobe: ein `checkCallback`, das stumpf `true` liefert, sähe ohne sie genauso grün aus. `saveSettings()` wird dabei nicht gerufen — der Zustand auf der Platte bleibt unberührt |
| P26 | Gruppierung im Auswahl-Modal (`todo`) | Frontmatter `status` der gespiegelten Aufgabe auf `done` setzen (über `processFrontMatter`, danach **auf den `metadataCache` warten**), Kommando ausführen, Modal per DOM lesen: **genau eine** Zeile, unter „Im Vault geändert", mit dem Pfad dieser Notiz — und die Gruppen „neu"/„auf beiden Seiten" leer. Gruppen werden über die Reihenfolge im DOM zugeordnet (jede `h3` eröffnet eine, die folgende Tabelle gehört zu ihr) und über DE/EN-Muster benannt |
| P27 | Senden schreibt (`todo`) | Nach dem Klick auf den CTA: Server-GET auf `test/aufgaben/t1.ics` zeigt `STATUS:COMPLETED`, **und** das `dav_etag` der Notiz ist ein anderes als vorher. Beide Hälften in einem Punkt: ein neues ETag ohne Server-Änderung wäre ein Resync von irgendetwas, ein `COMPLETED` ohne neues ETag hieße, die Notiz kennt den Stand nicht, den sie selbst ausgelöst hat |
| P28 | Erstanlage aus dem Vault (`todo`) | Notiz ohne `dav_uid` unter `Tasks/` anlegen → erscheint in der Gruppe „neu" → senden → (a) auf dem Server liegt eine Ressource mit dieser `SUMMARY` (per PROPFIND gefunden, der Name leitet sich aus einer im Plugin erzeugten UID ab), (b) **die Ausgangsnotiz** trägt danach die `dav_uid`, (c) es gibt **genau eine** Notiz mit diesem Titel. (b) und (c) sind der Punkt: ohne sie bliebe die Notiz „neu" und legte die Aufgabe bei **jedem** Lauf erneut an — genau so gemessen am 2026-09-05, s. „Lauf 2026-09-05" |
| P29 | Bewahrungsprobe (`todo`) | Die **abgebrochene** Fixture-Aufgabe (`t3.ics`, `STATUS:CANCELLED`) im Vault am **Titel** ändern und senden → Server trägt die neue `SUMMARY` **und weiterhin `STATUS:CANCELLED`**. Das Default-Profil bildet `CANCELLED` und `COMPLETED` beide auf `done` ab; die nutzersichtbare Zusage ist, dass daraus keine erledigte Aufgabe wird. Gegenprobe s. unten — sie ist **nicht** die aus dem Plan |
| P30 | Der Senden-Knopf zählt mit (`todo`) | Im offenen Modal: CTA trägt `1` → Zeile auf „Überspringen" (echtes `change`-Ereignis am `<select>`) → CTA `0` → „Alle auswählen" → CTA `1` **und** das sichtbare Dropdown steht wieder auf `vault`. Kein Unit-Test fängt das: entfernt man `aktualisiereSendenKnopf()` aus dem `onChange`, bleiben alle Tests grün (in M6b/Task 8 gemessen) |
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

## Lauf 2026-09-05 — `todo` 15/15, `generic` 14/14, `pallas` 6/6 — mit einem gefundenen Defekt

M6b/Task 11. Gegen die laufende Instanz gefahren (**mitgenutzt, nicht neu gestartet** — an ihr
hingen fünf fremde Vaults), CDP-Lock `--exclusive focus`.

`generic` und `pallas` liefen **nach** dem M6b-Merge nochmal, weil dieser mit `apply.ts` und
`execute.ts` geteilten Kern angefasst hat: 14/14 und 6/6, keine Regression. Ein Abschnitt, der
den geänderten Code gar nicht ruft, ist keine Aussage über ihn — der `claim`-Weg ist optional,
aber er liegt in derselben Schleife.

**Die Baseline hat sofort etwas gefunden.** Vor der Erweiterung mit dem *alten* Treiberstand
gefahren: **8/9**, P1 rot. Nicht das Plugin — der Prüfpunkt zählt die Kommandos hart, und M6b
hatte `todo-sync` dazugelegt. Genau dafür ist die Baseline da: ein Lauf *nach* dem Umbau hätte
dasselbe Rot gezeigt, und es wäre nicht von einem eigenen Fehler zu unterscheiden gewesen.

**P28 war rot und hat einen echten Defekt gefangen** (das, was ein Prüfpunkt können muss). Eine
im Vault entstandene Aufgabe wurde korrekt auf den Server geschrieben — aber der Resync danach
legte eine **zweite** Notiz an (`Tasks/Fahrrad reparieren (2).md`), während die Ausgangsnotiz
ohne `dav_uid` blieb. Folge: sie wäre beim **nächsten** Lauf wieder „neu" gewesen und hätte die
Aufgabe erneut angelegt — eine Aufgabe pro Lauf, unbegrenzt. Behoben über
`CommandPlan.claimsNote` (die Ausgangsnotiz beansprucht die erzeugte UID) → `ApplyInput.claim`.

⚠️ **Der erste Fix war grün im Unit-Test und rot im echten Obsidian.** Der Fake im
`execute`-Test ließ `byPath` jeden Pfad finden; `VaultNoteLookup.byPath` liefert dagegen nur
**geprimte** Pfade, und die Ausgangsnotiz steht in keinem Index und in keinem State. Der Fake
konnte mehr als das Original — die Zusicherung war dadurch keine. Seither nimmt `lookupFor`
`extraPaths`, und der Fake bildet den Vertrag nach (er merkt sich, was geprimt wurde).

### Die Gegenprobe zu P29 ist eine andere als die geplante

Der Plan sah vor, die Bewahrungsregel in `reverseStatus` auszukommentieren; P29 müsse dann rot
werden. **Gemessen: wird er nicht** — und der Grund ist strukturell. `handEditedKeys` meldet nur
Schlüssel, deren Frontmatter-Wert vom zuletzt geschriebenen abweicht; `prevWritten.status` ist
aber immer `statusValue(raw.status)`. Ist `status` also ein geänderter Schlüssel, kann
`statusValue(alt) === ziel` nicht gelten — die Bewahrung greift auf diesem Weg nie. Sie schützt
eine **andere** Bauart. Beide Hälften am 2026-09-05 gefahren:

| Gegenprobe | P29 |
|---|---|
| (b) `planTodoHandEdits` mutiert **alle** unterstützten Felder statt nur der geänderten, Bewahrung **an** | **grün** — `STATUS:CANCELLED` bleibt stehen |
| (c) dasselbe, Bewahrung **aus** | **rot** — `STATUS:COMPLETED`, die abgebrochene Aufgabe wird zur erledigten umgedeutet |

Damit ist die Regel live belegt: sie trägt genau dann, wenn eine Implementierung den Status
mitschreibt, ohne dass er sich geändert hat — die naheliegende Alternative („schreib die Notiz
auf den Server"). Für die aktuelle Fassung ist sie ein Netz, kein Wirkmechanismus; deshalb steht
in `AGENTS.md`, dass beide Eigenschaften zusammen die Zusage tragen.

Rezept für (b): in `src/core/commands/push-hand-edits.ts::planTodoHandEdits` über
`TODO_SUPPORTED.map((f) => fmKeyFor(ctx.profile, f))` iterieren statt über `keys`. Für (c)
zusätzlich Schritt 1 in `src/core/mirror/todo-reverse.ts::reverseStatus` auskommentieren.
Danach `npm run deploy` — der Treiber lädt das Plugin selbst neu, aber nur den Build, der auf
der Platte liegt.

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

# GUI-Smoke — `calendar-notes`

Getrackter CDP-Treiber (Skill `gui-smoke-setup`, CORE-TEST-02 b) — fährt die Checkliste
unten gegen ein **laufendes** Obsidian statt von Hand. Die Naht, die kein Unit-Test sieht:
`app.secretStorage`, `app.vault.adapter` (State-Dateien), echtes Frontmatter-Schreiben über
`app.fileManager.processFrontMatter`, die AdoptionModal/PreviewModal-DOM-Pfade, und ein echter
CalDAV/CardDAV-Server (Radicale).

## Voraussetzungen

⚠️ **Zuerst prüfen, wer sonst an Obsidian hängt.** Ein `quit` trifft die Instanz, an der
möglicherweise eine andere Session arbeitet, und zerstört deren Zustand. Der eigene Lauf ist
danach sauber grün; der Schaden entsteht woanders und fällt nicht auf. Was gerade offen ist,
beantwortet `/json/list` (der Fenstertitel trägt den Vault) — **nicht** der CDP-Lock: den hält
nur, wer gerade misst, ein offenes Fremdfenster ist keine Messung.

ⓘ Hier stand „Obsidian ist Single-Instance". Das ist seit dem 2026-09-02 widerlegt (Dach-
`AGENTS.md` § Staging-Vaults): die Sperre hängt am Profil, nicht am Rechner — mit eigenem
`--user-data-dir` und eigenem Debug-Port läuft eine zweite Instanz daneben. Für **destruktive**
Arbeit (Absturz reproduzieren, quitten, dutzendfach neu laden) ist das der richtige Ort statt
einer Nachfrage. Für einen normalen Smoke-Lauf bleibt es beim Mitnutzen.

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
npm run smoke:gui -- --section todo              # Aufgaben-Spiegel + Rückschreiben (VTODO, M6a/M6b)
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
| P1 | Laden | `Object.keys(app.commands.commands)` → **11** `calendar-notes:*`-Kommandos (5 aus M1–M3 + 5 seit M4: `run-on-note`/`new-event`/`new-contact`/`undo-last-change`/`push-hand-edits`, + `todo-sync` seit M6b); `app.setting.pluginTabs.find(id).getSettingDefinitions()` → 6 **benannte** Gruppen (Konten/Kalender & Adressbücher/Profile — welches Feld gehört wohin/Abgleich/Darstellung/Aktionen; Definitionen ohne `heading` werden vorher herausgefiltert). Stand 0.1.9 — die Liste ist wörtlich und soll rot werden, wenn sich die Oberfläche ändert |
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
| P25 | Kommando nur bei aktiver Aufgaben-Sammlung (`todo`) | `app.commands.commands["calendar-notes:todo-sync"].checkCallback(true)` → `true`; danach **im selben Prüfpunkt** alle Sammlungen im Speicher deaktivieren → `false`, dann zurück. Die zweite Hälfte ist die Gegenprobe: ein `checkCallback`, das stumpf `true` liefert, sähe ohne sie genauso grün aus. `saveSettings()` wird dabei nicht gerufen — der Zustand auf der Platte bleibt unberührt |
| P26 | Gruppierung im Auswahl-Modal (`todo`) | Frontmatter `status` der gespiegelten Aufgabe auf `done` setzen (über `processFrontMatter`, danach **auf den `metadataCache` warten**), Kommando ausführen, Modal per DOM lesen: **genau eine** Zeile, unter „Im Vault geändert", mit dem Pfad dieser Notiz — und die Gruppen „neu"/„auf beiden Seiten" leer. Gruppen werden über die Reihenfolge im DOM zugeordnet (jede `h3` eröffnet eine, die folgende Tabelle gehört zu ihr) und über DE/EN-Muster benannt |
| P27 | Senden schreibt (`todo`) | Nach dem Klick auf den CTA: Server-GET auf `test/aufgaben/t1.ics` zeigt `STATUS:COMPLETED`, **und** das `dav_etag` der Notiz ist ein anderes als vorher. Beide Hälften in einem Punkt: ein neues ETag ohne Server-Änderung wäre ein Resync von irgendetwas, ein `COMPLETED` ohne neues ETag hieße, die Notiz kennt den Stand nicht, den sie selbst ausgelöst hat |
| P28 | Erstanlage aus dem Vault (`todo`) | Notiz ohne `dav_uid` unter `Tasks/` anlegen → erscheint in der Gruppe „neu" → senden → (a) auf dem Server liegt eine Ressource mit dieser `SUMMARY` (per PROPFIND gefunden, der Name leitet sich aus einer im Plugin erzeugten UID ab), (b) **die Ausgangsnotiz** trägt danach die `dav_uid`, (c) es gibt **genau eine** Notiz mit diesem Titel. (b) und (c) sind der Punkt: ohne sie bliebe die Notiz „neu" und legte die Aufgabe bei **jedem** Lauf erneut an — genau so gemessen am 2026-09-05, s. „Lauf 2026-09-05" |
| P29 | Bewahrungsprobe (`todo`) | Die **abgebrochene** Fixture-Aufgabe (`t3.ics`, `STATUS:CANCELLED`) im Vault am **Titel** ändern und senden → Server trägt die neue `SUMMARY` **und weiterhin `STATUS:CANCELLED`**. Das Default-Profil bildet `CANCELLED` und `COMPLETED` beide auf `done` ab; die nutzersichtbare Zusage ist, dass daraus keine erledigte Aufgabe wird. Gegenprobe s. unten — sie ist **nicht** die aus dem Plan |
| P30 | Der Senden-Knopf zählt mit (`todo`) | Im offenen Modal: CTA trägt `1` → Zeile auf „Überspringen" (echtes `change`-Ereignis am `<select>`) → CTA `0` → „Alle auswählen" → CTA `1` **und** das sichtbare Dropdown steht wieder auf `vault`. Kein Unit-Test fängt das: entfernt man `aktualisiereSendenKnopf()` aus dem `onChange`, bleiben alle Tests grün (in M6b/Task 8 gemessen) |
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

## Lauf 2026-09-05 — `todo` 15/15, `generic` 14/14, `pallas` 6/6 — mit einem gefundenen Defekt

M6b/Task 11. Gegen die laufende Instanz gefahren (**mitgenutzt, nicht neu gestartet** — an ihr
hingen fünf fremde Vaults), CDP-Lock `--exclusive focus`.

`generic` und `pallas` liefen **nach** dem M6b-Merge nochmal, weil dieser mit `apply.ts` und
`execute.ts` geteilten Kern angefasst hat: 14/14 und 6/6, keine Regression. Ein Abschnitt, der
den geänderten Code gar nicht ruft, ist keine Aussage über ihn — der `claim`-Weg ist optional,
aber er liegt in derselben Schleife.

**Die Baseline hat sofort etwas gefunden.** Vor der Erweiterung mit dem *alten* Treiberstand
gefahren: **8/9**, P1 rot. Nicht das Plugin — der Prüfpunkt zählt die Kommandos hart, und M6b
hatte `todo-sync` dazugelegt. Genau dafür ist die Baseline da: ein Lauf *nach* dem Umbau hätte
dasselbe Rot gezeigt, und es wäre nicht von einem eigenen Fehler zu unterscheiden gewesen.

**P28 war rot und hat einen echten Defekt gefangen** (das, was ein Prüfpunkt können muss). Eine
im Vault entstandene Aufgabe wurde korrekt auf den Server geschrieben — aber der Resync danach
legte eine **zweite** Notiz an (`Tasks/Fahrrad reparieren (2).md`), während die Ausgangsnotiz
ohne `dav_uid` blieb. Folge: sie wäre beim **nächsten** Lauf wieder „neu" gewesen und hätte die
Aufgabe erneut angelegt — eine Aufgabe pro Lauf, unbegrenzt. Behoben über
`CommandPlan.claimsNote` (die Ausgangsnotiz beansprucht die erzeugte UID) → `ApplyInput.claim`.

⚠️ **Der erste Fix war grün im Unit-Test und rot im echten Obsidian.** Der Fake im
`execute`-Test ließ `byPath` jeden Pfad finden; `VaultNoteLookup.byPath` liefert dagegen nur
**geprimte** Pfade, und die Ausgangsnotiz steht in keinem Index und in keinem State. Der Fake
konnte mehr als das Original — die Zusicherung war dadurch keine. Seither nimmt `lookupFor`
`extraPaths`, und der Fake bildet den Vertrag nach (er merkt sich, was geprimt wurde).

### Die Gegenprobe zu P29 ist eine andere als die geplante

Der Plan sah vor, die Bewahrungsregel in `reverseStatus` auszukommentieren; P29 müsse dann rot
werden. **Gemessen: wird er nicht** — und der Grund ist strukturell. `handEditedKeys` meldet nur
Schlüssel, deren Frontmatter-Wert vom zuletzt geschriebenen abweicht; `prevWritten.status` ist
aber immer `statusValue(raw.status)`. Ist `status` also ein geänderter Schlüssel, kann
`statusValue(alt) === ziel` nicht gelten — die Bewahrung greift auf diesem Weg nie. Sie schützt
eine **andere** Bauart. Beide Hälften am 2026-09-05 gefahren:

| Gegenprobe | P29 |
|---|---|
| (b) `planTodoHandEdits` mutiert **alle** unterstützten Felder statt nur der geänderten, Bewahrung **an** | **grün** — `STATUS:CANCELLED` bleibt stehen |
| (c) dasselbe, Bewahrung **aus** | **rot** — `STATUS:COMPLETED`, die abgebrochene Aufgabe wird zur erledigten umgedeutet |

Damit ist die Regel live belegt: sie trägt genau dann, wenn eine Implementierung den Status
mitschreibt, ohne dass er sich geändert hat — die naheliegende Alternative („schreib die Notiz
auf den Server"). Für die aktuelle Fassung ist sie ein Netz, kein Wirkmechanismus; deshalb steht
in `AGENTS.md`, dass beide Eigenschaften zusammen die Zusage tragen.

Rezept für (b): in `src/core/commands/push-hand-edits.ts::planTodoHandEdits` über
`TODO_SUPPORTED.map((f) => fmKeyFor(ctx.profile, f))` iterieren statt über `keys`. Für (c)
zusätzlich Schritt 1 in `src/core/mirror/todo-reverse.ts::reverseStatus` auskommentieren.
Danach `npm run deploy` — der Treiber lädt das Plugin selbst neu, aber nur den Build, der auf
der Platte liegt.

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

## Protocol of runs 1–4

Full protocol of runs 1+2 (2026-08-22) and 3+4 (2026-08-23), merged from the former baseline files.

### GUI-Smoke Baseline — 2026-08-22

> ⓘ **Nachtrag 2026-09-01:** die Staging-Vault-Pfade unten sind nachtraeglich auf
> `~/StagingVaults/…` gekuerzt (CORE-META-14 verbietet absolute Maintainer-Pfade in
> tracked `*.md`); inhaltlich ist das der damalige Treiber-Default, den die Laeufe
> tatsaechlich benutzt haben. **Der Ort hat sich seither geaendert** — seit 2026-08-30
> loest ihn `$STAGING_VAULTS_DIR` auf (Dach-`AGENTS.md`). Die Kommandos unten sind
> Protokoll, kein Rezept.

Erster Lauf des getrackten CDP-Treibers (`scripts/gui-smoke.ts`, Skill `gui-smoke-setup`,
CORE-TEST-02 b) gegen ein laufendes Obsidian.

#### Lauf 1 (vor Matcher-Fix, Commit bbd9fe0)

##### Umgebung

- Obsidian **1.13.7**, macOS (Darwin 25.6.0), Debug-Port `9222`.
- Staging-Vault: `~/StagingVaults/calendar-notes` (`STAGING_VAULTS_DIR` war
  ungesetzt — Treiber-Default `$HOME/StagingVaults/calendar-notes` griff, per Hinweiszeile
  angesagt). Fenster-Titel: „calendar-notes“; das `10_Pallas`-Fenster wurde zu keinem
  Zeitpunkt angefasst oder in den Vordergrund geholt (kein `--focus` in diesem Lauf, P8
  entsprechend nicht gefahren).
- Deployte Plugin-Version: HEAD `bbd9fe0` — „fix(obsidian,adopt): Adoption — Fehlschläge pro
  Notiz behandeln, kaputte Server-Objekte sichtbar machen" (der parallele Agent hatte seine
  Adoption-Änderungen zu diesem Zeitpunkt bereits committet; `npm run build` +
  `OBSIDIAN_PLUGIN_DIR=.../calendar-notes npm run deploy` liefen gegen genau diesen Stand).
- Radicale auf Port **5298** (eigener, vom Treiber gestarteter Server aus
  `fixtures/radicale/`; das produktive Radicale auf 5232 aus einer früheren manuellen Session
  war zu diesem Zeitpunkt gestoppt und wurde nicht berührt).

##### Schritt 1 — `--setup`

```
$ npm run smoke:gui -- --setup
Hinweis: STAGING_VAULTS_DIR ist nicht gesetzt — verwende Default ~/StagingVaults/calendar-notes. Mit --vault-dir <pfad> ueberschreibbar, mit export STAGING_VAULTS_DIR=… dauerhaft setzbar.
  Notizen aus docs/images/fixture/notes
  Vault-Konfiguration gesetzt (nur calendar-notes aktiv, helles Theme)
  Layout zurueckgesetzt (workspace.json entfernt)
  Plugin-Einstellungen zurueckgesetzt (data.json entfernt)
  Plugin nach .obsidian/plugins/calendar-notes/ gebaut

Vault gebaut unter ~/StagingVaults/calendar-notes.
Fenster "calendar-notes" ist bereits offen — loese app:reload aus, damit Notizen + Plugin frisch geladen werden.
Warte, bis das Fenster wieder verbunden werden kann …
Fenster ist zurueck.
```

(Die Log-Zeile „Notizen aus docs/images/fixture/notes“ ist eine feste Textkonstante aus
`tools/obsidian-cdp/vault.ts`, die ursprünglich für den Screenshot-Treiber-Pfad formuliert
wurde — tatsächlich kopiert wurde `fixtures/vault/notes`, verifiziert per Verzeichnis-Diff
nach dem Lauf.)

Verifiziert nach dem Setup: `find $VAULT -not -path '*/.obsidian/*'` zeigt `Welcome.md`,
`Contacts/_index.md`, `Events/_index.md`, `Pallas/50_Ressourcen/10_Reference/10_Kontakte/{Alex
Aguado.md,ADAC.md}`, `Pallas/30_Chronos/70_Termine/10_Anstehend/2026-09-01 Zahnärztin.md`.

##### Schritt 2 — `--section generic`

```
$ npm run smoke:gui -- --section generic
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 5 Kommandos, 5 Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (generic) — 2 Sammlungen, 0 Warnungen
✔ P4a Trockenlauf (3+2 creates) — 5 creates im Trockenlauf
✔ P4b Sync legt Dateien mit Frontmatter an — 5 creates, Events/=3 Contacts/=2, FM-Keys: type, dav_uid, dav_source, dav_etag, dav_state, title, start, end, all_day, online
✔ P5 Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer) — etag "1c6ce0607e9923fd9611e477ed14ad361ab5c94b6497b54b564b75bf0f245e8f" → "b07aafe3de366e6c36cb2c12b3b00c26199e45926ccad0784775317bb3aabf37", updated=1, handEdited=0, Notices: ""
✔ P9 Notices nach P5 ohne Fehler — ""
✔ P6 Loeschung (Papierkorb, delete:trash im Plan) — Events/ 3 → 2, delete:trash im Trockenlauf-Plan=true
✔ P7 Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel) — aktiviert vorher=2 nachher=2
Radicale gestoppt.

8/8 Pruefpunkte gruen.
```

Nach dem Lauf per Diff verifiziert: Vault-Notizen wieder exakt auf dem `--setup`-Stand
(keine `Events/`/`Contacts/`-Datei außer `_index.md` übrig, keine Reste in `.trash`/Papierkorb
außerhalb des erwarteten Zwischenstands), Plugin-Settings (`data.json`) wieder
`{accounts:[],collections:[]}` mit den zwei Default-Profilen, keine neuen Dateien unter
`.obsidian/plugins/calendar-notes/state/` außer den vorbestehenden `acc1__col-*.json`
(Altlast aus einer früheren manuellen M2b-Session, vom Treiber unangetastet gelassen).

##### Schritt 3 — `--section pallas`

```
$ npm run smoke:gui -- --section pallas
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 5 Kommandos, 5 Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (pallas) — 2 Sammlungen, 0 Warnungen
✘ P3 Adoption (pallas) — Alex verknuepft=false, Zahnärztin verknuepft=false, ADAC unberuehrt=true; Notices: "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 0 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync." | "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 0 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync. | 0 Notiz(en) verknüpft, 1 übergangen, 0 entstehen beim nächsten Sync."
✘ P3b Sync nach Adoption aktualisiert statt neu anzulegen — created=5 updated=0, Alex/Zahnärztin unveraendert vorhanden=true, Body "Vorbereitung…" erhalten=true
Radicale gestoppt.

2/4 Pruefpunkte gruen.
```

Nach dem Lauf ebenfalls per Diff verifiziert: `Alex Aguado.md`, `ADAC.md`,
`2026-09-01 Zahnärztin.md` byte-identisch zum Fixture-Stand (keine Frontmatter-Reste von der
Adoption zurückgeblieben), `data.json` wieder auf `{accounts:[],collections:[]}` mit zwei
Profilen (die beiden per `createProfileFromNote` erzeugten Zusatzprofile sind durch den
Settings-Restore wieder weg) — trotz roter Prüfpunkte hat das `finally` sauber aufgeräumt.

###### Diagnose P3/P3b (kein Treiber-Defekt — Fixture/Plan-Diskrepanz)

Der Treiber hat den Fund selbst über `plugin.discoverAccount`/`plugin.createProfileFromNote`/
`plugin.startAdoption` erzeugt, keine Annahme aus dem Plan übernommen. Zwei unabhängige
Ursachen, beide reproduzierbar:

1. **`Alex Aguado.md` trägt laut Plan-Vorgabe (Vault-Cockpit `_SDD/2026-08-22-m3-adoption-smoke.md:100`)
   bereits `vcard_uid: a4843c7a6d3005dd`** — ein Platzhalterwert, der NICHT der echten
   `c4.vcf`-UID (`urn:uuid:5e2f1a9c-0000-4000-8000-000000000001`) entspricht. Ein aus
   GENAU dieser Notiz abgeleitetes Profil (`plugin.createProfileFromNote("contact", alexFile)`)
   übernimmt `vcard_uid` automatisch als `uidField` (`UID_KEYS`-Erkennung in
   `src/core/mirror/profile-from-note.ts:109-114`). `candidateNotes()`
   (`src/core/adopt/match.ts:104-114`) schließt danach jede Notiz mit bereits belegtem
   `uidField` aus dem Kandidatenpool aus — die Notiz, aus der das Profil abgeleitet wird, kann
   sich damit per Konstruktion nie selbst als Adoptions-Ziel qualifizieren. Verifiziert per
   `readFrontmatter`: Alex bleibt nach dem Adoptions-Lauf ohne echten `vcard_uid`-Treffer.
2. **Der Datums-Präfix im Dateinamen** `2026-09-01 Zahnärztin.md` senkt die Titel-Ähnlichkeit
   in `bestTitleSim` (`src/core/adopt/match.ts:163-167`, Jaccard/Dice über normalisierte
   Tokens) deutlich unter die 0.6-Schwelle für `likely`: Server-Titel „Zahnärztin Dr. Müller“
   ergibt gegen die Notiz-Basename-Tokens `["2026","09","01","zahnärztin"]` einen Wert von
   ca. 0.2 statt der für `likely` nötigen ≥0.6 — die Notice „1 übergangen“ bestätigt das
   (Confidence `weak`, Default-Aktion `skip`, nicht `link`).

Ergebnis: 0 Verknüpfungen in beiden Pallas-Sammlungen, P3b (Sync nach Adoption) findet folgerichtig
`updated=0` statt der erwarteten ≥2 und stattdessen `created=5` (der volle Satz Server-Objekte
landet als Neuanlage, weil nichts verlinkt wurde). Kein Absturz, keine Exception, keine
Fehler-Notice — der Ablauf selbst funktioniert korrekt, nur eben nicht mit dem im Plan
angenommenen Ergebnis.

**Empfehlung an den Plan-/Fixture-Owner** (nicht im Scope dieses Treibers behoben — die
Fixture-Datei liegt außerhalb der für Task 6 zugewiesenen Dateien): entweder `vcard_uid` aus
`fixtures/vault/notes/Pallas/.../Alex Aguado.md` entfernen (dann matcht Alex über Telefon
`sure`, wie ursprünglich in der Task-6-Brief-Beschreibung angenommen) und die
`likely`-Erwartung für Zahnärztin im Plan auf `weak` korrigieren — oder `bestTitleSim` um den
Dateinamen-Datumspräfix bereinigen (z. B. nur den Titel nach dem Datum vergleichen). Der
Treiber (`scripts/gui-smoke.ts`, `checkP3`) misst bereits korrekt gegen die ECHTEN
UID-Werte (nicht nur Schlüssel-Präsenz) und wird nach einer Fixture-/Matcher-Korrektur ohne
weitere Änderung grün werden.

##### Zusammenfassung (Lauf 1)

| Abschnitt | Ergebnis |
|---|---|
| `--setup` | erfolgreich, Vault + Plugin frisch geladen |
| `--section generic` | **8/8 grün** (P1, P2, P4a, P4b, P5, P9, P6, P7) |
| `--section pallas` | **2/4** (P1, P2 grün; P3, P3b rot — Fixture/Plan-Diskrepanz, s. o., kein Treiberdefekt) |
| `--focus` (P8) | nicht gefahren in dieser Baseline (Anweisung: Umgebung nicht unnötig stören, kein Fensterwechsel) |

Aufräumen nach JEDEM Lauf verifiziert (Diff gegen den `--setup`-Stand): Vault-Notizen,
Plugin-Settings, State-Dateien — alle drei Läufe hinterließen den Vault unverändert.

#### Lauf 2 (nach 14e4506, Matcher-Fix)

Commit `14e4506` — „fix(adopt): Review-Runde 2 — Kandidaten-Regel & Termin-Titelvergleich
(aus Live-Smoke)" — behebt beide in Lauf 1 gefundenen Ursachen: `candidateNotes()`
schließt Kandidaten seither nur noch über `dav_source` aus (nicht mehr über ein beliebiges
vorbelegtes `uidField`), und der Datums-Präfix wird vor dem Titelvergleich (`bestTitleSim`)
von der Notiz-Basename entfernt.

##### Umgebung

- Obsidian **1.13.7**, macOS, Debug-Port `9222`, Fenster „calendar-notes" (unverändert
  gegenüber Lauf 1). `10_Pallas`-Fenster erneut zu keinem Zeitpunkt angefasst, kein
  `Page.bringToFront`, kein `--focus`.
- `git log --oneline -3` vor dem Lauf: `14e4506` (Matcher-Fix) auf `9d60bb1` (dieser
  Treiber) auf `bbd9fe0`.
- `npm run build` + `OBSIDIAN_PLUGIN_DIR=~/StagingVaults/calendar-notes/.obsidian/plugins/calendar-notes npm run deploy`
  liefen gegen `14e4506`.
- Plugin **nicht** per Vault-Reload neu geladen, sondern gezielt per
  `app.plugins.disablePlugin("calendar-notes")` / `enablePlugin("calendar-notes")` über ein
  kurzlebiges, nicht getracktes Hilfsskript (per esbuild gebündelt, nach Gebrauch gelöscht) —
  Ausgabe: `Reload: vorher-Version=0.1.0, danach geladen=true`. Vault blieb dabei unverändert
  (kein `buildVault`/`--setup`-Aufruf).
- Radicale wieder auf Port 5298 (eigener, vom Treiber gestarteter Server), Port 5232
  weiterhin unberührt.

##### Schritt 1 — `--section pallas`

```
$ npm run smoke:gui -- --section pallas
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 5 Kommandos, 5 Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (pallas) — 2 Sammlungen, 0 Warnungen
✔ P3 Adoption (pallas) — Alex verknuepft=true, Zahnärztin verknuepft=true, ADAC unberuehrt=true; Notices: "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 1 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync." | "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 1 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync."
✔ P3b Sync nach Adoption aktualisiert statt neu anzulegen — created=3 updated=2, Alex/Zahnärztin unveraendert vorhanden=true, Body "Vorbereitung…" erhalten=true
Radicale gestoppt.

4/4 Pruefpunkte gruen.
```

Beide Sammlungen verknüpfen jetzt korrekt je eine Notiz (`1 Notiz(en) verknüpft` pro
Adoptions-Lauf, einmal für `kontakte`/Alex, einmal für `kalender`/Zahnärztin). P3b bestätigt
den erwarteten Sync-Effekt: `updated=2` (Alex + Zahnärztin aktualisiert), `created=3`
(die drei unverknüpften Server-Objekte — Dr. Florian Brandes, Weihnachten, Teamrunde —
entstehen wie erwartet neu, ADAC bleibt unberührt, da rein lokal ohne Server-Pendant).

Nach dem Lauf per Diff verifiziert: `Alex Aguado.md`, `ADAC.md`, `2026-09-01 Zahnärztin.md`
wieder byte-identisch zum Fixture-Stand, keine der drei neu angelegten Notizen
(Florian Brandes/Weihnachten/Teamrunde) im Vault übrig, `data.json` wieder
`{accounts:[],collections:[]}` mit den zwei Default-Profilen — Aufräumen funktionierte trotz
durchweg grüner Prüfpunkte identisch zu Lauf 1.

##### Schritt 2 — `--section generic` (Regressions-Kontrolle)

```
$ npm run smoke:gui -- --section generic
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 5 Kommandos, 5 Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (generic) — 2 Sammlungen, 0 Warnungen
✔ P4a Trockenlauf (3+2 creates) — 5 creates im Trockenlauf
✔ P4b Sync legt Dateien mit Frontmatter an — 5 creates, Events/=3 Contacts/=2, FM-Keys: type, dav_uid, dav_source, dav_etag, dav_state, title, start, end, all_day, online
✔ P5 Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer) — etag "1c6ce0607e9923fd9611e477ed14ad361ab5c94b6497b54b564b75bf0f245e8f" → "b07aafe3de366e6c36cb2c12b3b00c26199e45926ccad0784775317bb3aabf37", updated=1, handEdited=0, Notices: ""
✔ P9 Notices nach P5 ohne Fehler — ""
✔ P6 Loeschung (Papierkorb, delete:trash im Plan) — Events/ 3 → 2, delete:trash im Trockenlauf-Plan=true
✔ P7 Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel) — aktiviert vorher=2 nachher=2
Radicale gestoppt.

8/8 Pruefpunkte gruen.
```

Identisch zu Lauf 1 (byte-gleiches Protokoll bis auf den Zeitstempel) — keine Regression
durch den Matcher-Fix im generischen Standard-Profil-Pfad.

##### Zusammenfassung (Lauf 2)

| Abschnitt | Ergebnis | Delta zu Lauf 1 |
|---|---|---|
| `--section pallas` | **4/4 grün** (P1, P2, P3, P3b) | P3/P3b von rot auf grün |
| `--section generic` | **8/8 grün** (unverändert) | keine Regression |
| `--focus` (P8) | weiterhin nicht gefahren | unverändert (Anweisung: kein Fensterwechsel) |

Aufräumen erneut per Diff verifiziert — Vault, Settings, State-Dateien nach beiden Läufen
wieder exakt auf dem `--setup`-Stand.

#### Lauf 3 (nach Fix-Welle a957d12)

##### Umgebung

- Gleiches Setup wie Lauf 1/2: Obsidian **1.13.7** (macOS, Debug-Port `9222`), Staging-Vault
  `~/StagingVaults/calendar-notes`, Fenster-Titel „calendar-notes“; das
  `10_Pallas`-Fenster wurde nicht angefasst.
- Deployte Plugin-Version: `npm run build` + `OBSIDIAN_PLUGIN_DIR=~/StagingVaults/calendar-notes/.obsidian/plugins/calendar-notes npm run deploy`
  gegen HEAD `a957d12` (Fix-Welle: Notice-Rejection nicht mehr verschluckt, `countTypeExcluded`
  im Adoptions-Modal, `loadCandidateNotes` ohne toten `body`-Read, `CollectionSuggestModal`
  mit eigenem Placeholder, `url`-Synonym in `EVENT_SYNONYMS`, GUI-Smoke-Treiber P8/P3b/P5
  gehärtet). Plugin neu geladen per `app.plugins.disablePlugin("calendar-notes")` +
  `enablePlugin(...)` im laufenden Fenster (kein `app:reload`, kein Fensterwechsel) — kein
  `--focus` in diesem Lauf, P8 entsprechend nicht gefahren.
- Radicale auf Port **5298** (eigener, vom Treiber gestarteter Server).

##### Schritt 1 — `--section generic`

```
$ npm run smoke:gui -- --section generic
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 5 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"] (erwartet DE ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"] oder EN ["Accounts","Collections","Profiles","Sync","Actions"])
✔ P2 Konto+Discovery (generic) — 2 Sammlungen, 0 Warnungen
✔ P4a Trockenlauf (3+2 creates) — 5 creates im Trockenlauf
✔ P4b Sync legt Dateien mit Frontmatter an — 5 creates, Events/=3 Contacts/=2, FM-Keys: type, dav_uid, dav_source, dav_etag, dav_state, title, start, end, all_day, location, url, online, event_status, categories
✔ P5 Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer) — etagSettled(pollUntil)=true, etag "1c6ce0607e9923fd9611e477ed14ad361ab5c94b6497b54b564b75bf0f245e8f" → "b07aafe3de366e6c36cb2c12b3b00c26199e45926ccad0784775317bb3aabf37", updated=1, handEdited=0, Notices: ""
✔ P9 Notices nach P5 ohne Fehler — ""
✔ P6 Loeschung (Papierkorb, delete:trash im Plan) — Events/ 3 → 2, delete:trash im Trockenlauf-Plan=true
✔ P7 Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel) — aktiviert vorher=2 nachher=2
Radicale gestoppt.

8/8 Pruefpunkte gruen.
```

`FM-Keys` listet in diesem Lauf zusaetzliche optionale Felder (`location, url, event_status,
categories`) gegenueber Lauf 1/2 — reine Reihenfolge/Vollstaendigkeit der `Set`-Sammlung ueber
alle fuenf angelegten Dateien, keine Verhaltensaenderung (P4b bleibt gruen, dieselben Pflichtfelder
sind weiterhin enthalten). `P5` zeigt jetzt zusaetzlich `etagSettled(pollUntil)=true` — das
Poll-Ergebnis des ersetzten `setTimeout(500)` fliesst sichtbar in die Assertion ein.

##### Schritt 2 — `--section pallas`

Erster Versuch (mit der noch ungetesteten P3b-Fassung aus der Fix-Welle) schlug fehl: die
naive Ordner-Vorher==Nachher-Gleichheit ignorierte, dass die drei unverknuepften Server-Objekte
(Florian Brandes, Weihnachten, Teamrunde) legitim neue Notizen in genau diesen beiden Ordnern
anlegen (`createProfileFromNote` uebernimmt den Ordner der Beispielnotiz woertlich). Nach dem
Fix (Summe der Ordner-Zuwaechse muss exakt `sync.created` entsprechen, Commit `a957d12`) erneut
gefahren:

```
$ npm run smoke:gui -- --section pallas
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 5 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"] (erwartet DE ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"] oder EN ["Accounts","Collections","Profiles","Sync","Actions"])
✔ P2 Konto+Discovery (pallas) — 2 Sammlungen, 0 Warnungen
✔ P3 Adoption (pallas) — Alex verknuepft=true, Zahnärztin verknuepft=true, ADAC unberuehrt=true; Notices: "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 1 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync." | "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 1 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync."
✔ P3b Sync nach Adoption aktualisiert statt neu anzulegen — created=3 updated=2, Dateizahl Kontakte 2→3 (Δ1), Anstehend 1→3 (Δ2), Summe Δ == created=true, Body "Vorbereitung…" erhalten=true
Radicale gestoppt.

4/4 Pruefpunkte gruen.
```

Nach beiden Schritten per Diff verifiziert: Vault (`find $VAULT -not -path '*/.obsidian/*'`)
wieder exakt auf dem `--setup`-Stand (`Welcome.md`, `Contacts/_index.md`, `Events/_index.md`,
`Pallas/50_Ressourcen/10_Reference/10_Kontakte/{Alex Aguado.md,ADAC.md}`,
`Pallas/30_Chronos/70_Termine/10_Anstehend/2026-09-01 Zahnärztin.md`), `data.json` wieder
`{accounts:[],collections:[]}` mit den zwei Default-Profilen (keine Nachwirkung der
Adoptions-Profile).

##### Zusammenfassung (Lauf 3)

| Abschnitt | Ergebnis | Delta zu Lauf 2 |
|---|---|---|
| `--section generic` | **8/8 grün** | keine Regression |
| `--section pallas` | **4/4 grün** (nach Nachbesserung der P3b-Kondition im selben Lauf) | P3b jetzt gegen die tatsächlich erwarteten Neuanlagen geprüft statt gegen eine zu strenge Ordner-Gleichheit |
| `--focus` (P8) | weiterhin nicht gefahren | unverändert (Anweisung: kein Fensterwechsel) |

Deploy + Plugin-Reload liefen ohne `osascript`/App-Neustart — `disablePlugin` +
`enablePlugin` im laufenden Fenster genügt und vermeidet den Fenster-Wiederverbindungsschritt
aus `--setup`.

### GUI-Smoke Baseline — 2026-08-23 (M4, Task 8 — P10–P13)

> ⓘ **Nachtrag 2026-09-01:** die Staging-Vault-Pfade unten sind nachtraeglich auf
> `~/StagingVaults/…` gekuerzt (CORE-META-14 verbietet absolute Maintainer-Pfade in
> tracked `*.md`); inhaltlich ist das der damalige Treiber-Default, den die Laeufe
> tatsaechlich benutzt haben. **Der Ort hat sich seither geaendert** — seit 2026-08-30
> loest ihn `$STAGING_VAULTS_DIR` auf (Dach-`AGENTS.md`). Die Kommandos unten sind
> Protokoll, kein Rezept.

Obsidian 1.13.7, macOS, Staging-Vault `~/StagingVaults/calendar-notes`,
Commit `58b43d0` (Plugin-API v1) + lokale Task-8-Änderungen (`scripts/gui-smoke.ts`
P10–P13, P1-Kommandozahl 5→10). Build+Deploy vorab:

```bash
npm run build && OBSIDIAN_PLUGIN_DIR=~/StagingVaults/calendar-notes/.obsidian/plugins/calendar-notes npm run deploy
npm run smoke:gui -- --setup
npm run smoke:gui -- --section generic
npm run smoke:gui -- --section pallas
```

`--setup` löst intern `app:reload` im bereits offenen `calendar-notes`-Fenster aus (Notizen +
Plugin neu geladen, keine Vault-Neuinstallation nötig). Kein `--focus` (P8 nicht gelaufen —
ausschließlich Konsolen-Prüfpunkte gebraucht, keine Fenster-Sichtbarkeit).

#### `--setup`

```
Hinweis: STAGING_VAULTS_DIR ist nicht gesetzt — verwende Default ~/StagingVaults/calendar-notes.
  Notizen aus docs/images/fixture/notes
  Vault-Konfiguration gesetzt (nur calendar-notes aktiv, helles Theme)
  Layout zurueckgesetzt (workspace.json entfernt)
  Plugin-Einstellungen zurueckgesetzt (data.json entfernt)
  Plugin nach .obsidian/plugins/calendar-notes/ gebaut

Vault gebaut unter ~/StagingVaults/calendar-notes.
Fenster "calendar-notes" ist bereits offen — loese app:reload aus, damit Notizen + Plugin frisch geladen werden.
Warte, bis das Fenster wieder verbunden werden kann …
Fenster ist zurueck.
```

#### `--section generic` — 8/11 grün

```
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 10 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (generic) — 2 Sammlungen, 0 Warnungen
✔ P4a Trockenlauf (3+2 creates) — 5 creates im Trockenlauf
✔ P4b Sync legt Dateien mit Frontmatter an — 5 creates, Events/=3 Contacts/=2, FM-Keys: type, dav_uid, dav_source, dav_etag, dav_state, title, start, end, all_day, online
✔ P5 Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer) — etagSettled(pollUntil)=true, etag "1c6ce0607e9923fd9611e477ed14ad361ab5c94b6497b54b564b75bf0f245e8f" → "b07aafe3de366e6c36cb2c12b3b00c26199e45926ccad0784775317bb3aabf37", updated=1, handEdited=0, Notices: ""
✔ P9 Notices nach P5 ohne Fehler — ""
✔ P6 Loeschung (Papierkorb, delete:trash im Plan) — Events/ 3 → 2, delete:trash im Trockenlauf-Plan=true
✔ P7 Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel) — aktiviert vorher=2 nachher=2
✘ P10 Kommando via API (event.move) — plan=false exec=false, Server-GET moved=false (HTTP 200), Frontmatter moved=false
✘ P11 Einladung ohne Scheduling/Transport (Route ics) — plan.inviteRoute=undefined, exec.invite.route=undefined, METHOD:REQUEST=undefined, ATTENDEE kim im .ics=undefined, Server hat ATTENDEE=false
⚠ P12 Undo (Letzte Änderung zurücknehmen) — übersprungen: kein programmatischer Undo-Pfad: CommandFlow.undoLast()/runUndo() brauchen eine aktive Notiz + öffnen immer PlanPreviewModal (Bestätigung), Plugin-API kennt kein undo() und commandRegistry() hat keinen 'undo.last'-Eintrag (undo.ts exportiert nur die reine planUndoLast()-Funktion, nicht ueber die Registry erreichbar) — Nachtrag müsste die API erweitern, was außerhalb dieser Aufgabe liegt (s. Ruling im Task-8-Brief).
✘ P13 API-Lesen (events/contacts/tools==commands, keine Punkte in Tool-Namen) — events hat simple-1=true, contacts hat Florian Brandes=true, tools=0 commands=0, Tool-Name mit Punkt=false
Radicale gestoppt.

8/11 Pruefpunkte gruen.
```

Reproduziert (zweiter Lauf mit derselben Konstellation, vor dem P1-Fix an der Treiber-Erwartung
gelaufen): erster Versuch zeigte `✘ P1` mit `10 Kommandos` gegen die veraltete Erwartung `5` —
kein Plugin-Defekt, sondern eine seit M4 (Task 6: 5 neue Kommandos `run-on-note`/`new-event`/
`new-contact`/`undo-last-change`/`push-hand-edits`) veraltete Treiber-Assertion, korrigiert in
`scripts/gui-smoke.ts` (`checkP1`, 5→10). Danach erneut gelaufen → obiges Protokoll, P1 grün,
P10/P11/P13 identisch reproduziert (keine Flakiness, struktureller Befund).

##### P10/P11/P13-Befund (PLUGIN-Ursache, nicht behoben — außerhalb Task-8-Scope)

`plugin.api.commands()`/`tools()` liefern leere Arrays, `plugin.api.plan(...)` liefert
`{error:"command-not-found"}` für jede Kommando-ID. Ursache: `src/main.ts` importiert
`EVENT_COMMANDS`/`CONTACT_COMMANDS` (`src/core/commands/event-commands.ts:245-248`,
`src/core/commands/contact-commands.ts`) nirgends und ruft `registerCommands()`
(`src/core/commands/registry.ts:8`) nirgends auf — nur `tests/obsidian/api.test.ts` befüllt die
Registry manuell mit Fake-Deskriptoren. Zur Laufzeit im echten Plugin bleibt der modul-globale
`registered`-Array aus `registry.ts` leer. Betroffen: `CommandFlow.startRun()`
(`commandsFor(ctx)` → immer `[]`), `api.plan()`/`api.commands()`/`api.tools()`
(`src/obsidian/api.ts:187-215`). **Fix-Hypothese** (nicht umgesetzt — Global Constraint
„nicht über den Task-8-Scope hinaus an `src/` reparieren"): in `src/main.ts` `onload()`, vor
`this.commandFlow = new CommandFlow(...)` (Zeile ~119), einmalig mit Guard
`registerCommands([...EVENT_COMMANDS, ...CONTACT_COMMANDS])` aufrufen. Empfehlung: Follow-up-Task.

##### P12-Befund (Ruling, kein Defekt)

Übersprungen nach expliziter Task-8-Vorgabe: `CommandFlow.undoLast()`/`runUndo()`
(`src/obsidian/command-flow.ts:139-154`) hängen an `app.workspace.getActiveFile()` und öffnen am
Ende immer die `PlanPreviewModal` (Mensch bestätigt) — keine headless-Variante. Die Plugin-API
kennt kein `undo()`, und `undo.last` steht nicht in der `commandRegistry()` (nur die reine
`planUndoLast()`-Funktion aus `src/core/commands/undo.ts` existiert, nicht darüber erreichbar).
⚠ P12 übersprungen: kein programmatischer Undo-Pfad; Follow-up: `undo.last` in die Registry + API.

#### `--section pallas` — 4/4 grün, keine Regression

```
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 10 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (pallas) — 2 Sammlungen, 0 Warnungen
✔ P3 Adoption (pallas) — Alex verknuepft=true, Zahnärztin verknuepft=true, ADAC unberuehrt=true; Notices: "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 1 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync." | "Profil erzeugt (2 Feld(er) zugeordnet, 0 nicht zugeordnet). | Profil erzeugt (1 Feld(er) zugeordnet, 0 nicht zugeordnet). | 1 Notiz(en) verknüpft, 0 übergangen, 0 entstehen beim nächsten Sync."
✔ P3b Sync nach Adoption aktualisiert statt neu anzulegen — created=3 updated=2, Dateizahl Kontakte 2→3 (Δ1), Anstehend 1→3 (Δ2), Summe Δ == created=true, Body "Vorbereitung…" erhalten=true
Radicale gestoppt.

4/4 Pruefpunkte gruen.
```

Keine Regression durch M4: P3/P3b (Adoptions-Pfad aus M3) unverändert grün.

#### Zusammenfassung

| Sektion | P1 | P2 | P3/P3b | P4 | P5 | P6 | P7 | P9 | P10 | P11 | P12 | P13 | Summe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| generic | ✔ | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ | ⚠ | ✘ | 8/11 |
| pallas | ✔ | ✔ | ✔ | — | — | — | — | — | — | — | — | — | 4/4 |

`npm run gate` (Lint/Typecheck/439 Unit-Tests/`check:pure`/Build), `npm run test:integration`
(4 Tests) und `npm run typecheck:scripts` liefen vor UND nach dem Smoke-Lauf grün — kein
Regressions-Signal außerhalb der drei dokumentierten Befunde.

Full protocol of M1–M3: § "GUI-Smoke Baseline — 2026-08-22" above.

#### Lauf 2 (nach Fix-Runde 1 — dieser Commit)

Obsidian 1.13.7, macOS, Staging-Vault `~/StagingVaults/calendar-notes`,
Fenster frisch über `obsidian://open?vault=calendar-notes` geöffnet (kein anderes
Vault-Fenster gleichzeitig offen — insbesondere NICHT `10_Pallas`, per `curl
http://127.0.0.1:9222/json` vor jedem Lauf geprüft). Build+Deploy vorab:

```bash
npm run build
OBSIDIAN_PLUGIN_DIR=~/StagingVaults/calendar-notes/.obsidian/plugins/calendar-notes npm run deploy
npm run smoke:gui -- --section generic
npm run smoke:gui -- --section pallas
```

Behebt den P10/P11/P13-Befund aus Lauf 1 (`commandRegistry()` blieb leer) und macht P12
(vorher `⚠ übersprungen`) erstmals programmatisch prüfbar — s. `docs/SMOKE.md`
§ „Behobener Befund (2026-08-23, Fix-Runde 1)" für die Ursache/den Fix. Zusätzlich wurden
zwei Treiber-eigene Mess-Bugs behoben (kein Plugin-Defekt): `extractDtstart()` traf zuerst
das `DTSTART` einer `VTIMEZONE`-Unterkomponente statt des `VEVENT`s, und die
ATTENDEE/E-Mail-Prüfung in P11 scheiterte an RFC5545-Zeilenfaltung (die simulierte
`ATTENDEE`-Zeile mit `CN=Kim` überschreitet 75 Oktette und faltet vor `mailto:`).

```
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 10 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (generic) — 2 Sammlungen, 0 Warnungen
✔ P4a Trockenlauf (3+2 creates) — 5 creates im Trockenlauf
✔ P4b Sync legt Dateien mit Frontmatter an — 5 creates, Events/=3 Contacts/=2
✔ P5 Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer) — etagSettled(pollUntil)=true, updated=1, handEdited=0, Notices: ""
✔ P9 Notices nach P5 ohne Fehler — ""
✔ P6 Loeschung (Papierkorb, delete:trash im Plan) — Events/ 3 → 2, delete:trash im Trockenlauf-Plan=true
✔ P7 Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel) — aktiviert vorher=2 nachher=2
✔ P10 Kommando via API (event.move) — plan=true exec=true, Server-GET moved=true (HTTP 200), Frontmatter moved=true
✔ P12 Undo (Letzte Änderung zurücknehmen) — DTSTART zurueck auf Vor-P10-Stand — plan=true exec=true, Server-GET restored=true (HTTP 200), Frontmatter restored=true
✔ P11 Einladung ohne Scheduling/Transport (Route ics) — plan.inviteRoute=ics, exec.invite.route=ics, METHOD:REQUEST=true, ATTENDEE kim im .ics=true, Server hat ATTENDEE=true
✔ P13 API-Lesen (events/contacts/tools==commands, keine Punkte in Tool-Namen) — events hat simple-1=true, contacts hat Florian Brandes=true, tools=21 commands=21, Tool-Name mit Punkt=false
Radicale gestoppt.

12/12 Pruefpunkte gruen.
```

```
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 10 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (pallas) — 2 Sammlungen, 0 Warnungen
✔ P3 Adoption (pallas) — Alex verknuepft=true, Zahnärztin verknuepft=true, ADAC unberuehrt=true
✔ P3b Sync nach Adoption aktualisiert statt neu anzulegen — created=3 updated=2, Summe Δ == created=true, Body erhalten=true
Radicale gestoppt.

4/4 Pruefpunkte gruen.
```

**Live-Reload-Bestätigung (Idempotenz von `ensureDefaultCommands()`):** im selben Fenster
zweimal hintereinander `app.plugins.disablePlugin("calendar-notes")` +
`app.plugins.enablePlugin("calendar-notes")` per CDP ausgelöst — `plugin.api.commands().length`
blieb beide Male bei 21, kein „Doppelte Kommando-ID"-Wurf, danach erneuter
`--section generic`-Lauf weiterhin 12/12.

| Sektion | P1 | P2 | P3/P3b | P4 | P5 | P6 | P7 | P9 | P10 | P11 | P12 | P13 | Summe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| generic | ✔ | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | 12/12 |
| pallas | ✔ | ✔ | ✔ | — | — | — | — | — | — | — | — | — | 4/4 |

`npm run gate` (Lint 0 Errors/0 Warnings, Typecheck strict, 455/455 Unit-Tests, `check:pure`,
Build), `npm run test:integration` (4 Tests) und `npm run typecheck:scripts` liefen vor UND
nach dem Smoke-Lauf grün.

#### Lauf 3 (nach Review-Runde 3 — dieser Commit)

Whole-Branch-Review (1 Critical, 1 Important, 8 Minors) auf Commit `2b81195` — Fix-Commit s.
Git-Log. Kein struktureller Smoke-Befund in dieser Runde (C1/I1/M1–M9 sind reine
Unit-Test-/Code-Fixes, keiner davon aendert den GUI-Smoke-Pfad); Lauf 3 bestaetigt nur, dass
keine Regression eingeschlichen ist. Obsidian 1.13.7, macOS, Staging-Vault
`~/StagingVaults/calendar-notes`, Fenster frisch offen (per `curl
:9222/json` vor jedem Lauf geprueft: nie `10_Pallas`), Plugin per
`disablePlugin`/`enablePlugin` neu geladen (`commands().length` = 21, `version` = 1).

```bash
npm run build
OBSIDIAN_PLUGIN_DIR=~/StagingVaults/calendar-notes/.obsidian/plugins/calendar-notes npm run deploy
npm run smoke:gui -- --section generic
npm run smoke:gui -- --section pallas
```

```
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 10 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (generic) — 2 Sammlungen, 0 Warnungen
✔ P4a Trockenlauf (3+2 creates) — 5 creates im Trockenlauf
✔ P4b Sync legt Dateien mit Frontmatter an — 5 creates, Events/=3 Contacts/=2
✔ P5 Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer) — etagSettled(pollUntil)=true, updated=1, handEdited=0, Notices: ""
✔ P9 Notices nach P5 ohne Fehler — ""
✔ P6 Loeschung (Papierkorb, delete:trash im Plan) — Events/ 3 → 2, delete:trash im Trockenlauf-Plan=true
✔ P7 Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel) — aktiviert vorher=2 nachher=2
✔ P10 Kommando via API (event.move) — plan=true exec=true, Server-GET moved=true (HTTP 200), Frontmatter moved=true
✔ P12 Undo (Letzte Änderung zurücknehmen) — DTSTART zurueck auf Vor-P10-Stand — plan=true exec=true, Server-GET restored=true (HTTP 200), Frontmatter restored=true
✔ P11 Einladung ohne Scheduling/Transport (Route ics) — plan.inviteRoute=ics, exec.invite.route=ics, METHOD:REQUEST=true, ATTENDEE kim im .ics=true, Server hat ATTENDEE=true
✔ P13 API-Lesen (events/contacts/tools==commands, keine Punkte in Tool-Namen) — events hat simple-1=true, contacts hat Florian Brandes=true, tools=21 commands=21, Tool-Name mit Punkt=false
Radicale gestoppt.

12/12 Pruefpunkte gruen.
```

```
Radicale: http://127.0.0.1:5298/
✔ P1 Laden — 10 Kommandos, Settings-Gruppen: ["Konten","Sammlungen","Profile","Synchronisation","Aktionen"]
✔ P2 Konto+Discovery (pallas) — 2 Sammlungen, 0 Warnungen
✔ P3 Adoption (pallas) — Alex verknuepft=true, Zahnärztin verknuepft=true, ADAC unberuehrt=true
✔ P3b Sync nach Adoption aktualisiert statt neu anzulegen — created=3 updated=2, Summe Δ == created=true, Body erhalten=true
Radicale gestoppt.

4/4 Pruefpunkte gruen.
```

| Sektion | P1 | P2 | P3/P3b | P4 | P5 | P6 | P7 | P9 | P10 | P11 | P12 | P13 | Summe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| generic | ✔ | ✔ | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | 12/12 |
| pallas | ✔ | ✔ | ✔ | — | — | — | — | — | — | — | — | — | 4/4 |

`npm run gate` (Lint 0/0, Typecheck strict, 489/489 Unit-Tests, `check:pure`, Build),
`npm run test:integration` (4/4) und `npm run typecheck:scripts` liefen vor UND nach dem
Smoke-Lauf grün.


