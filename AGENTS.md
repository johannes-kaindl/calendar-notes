# AGENTS — calendar-notes

CalDAV-Termine und CardDAV-Kontakte als Notiz-Spiegel; der Server ist die Wahrheit, geschrieben wird nur
über Kommandos. Spec: `docs/superpowers/specs/2026-08-22-calendar-notes-design.md`. Pläne: `docs/superpowers/plans/`.

> **Workspace-Standards (maintainer-lokal):** Die verbindliche Leitkonvention steht in `_docs/CONVENTIONS.md`
> im Multi-Projekt-Workspace des Maintainers, `../../_docs` relativ zu diesem Repo — nicht Teil dieses Repos,
> ignorieren falls im Klon nicht vorhanden. Modell comply-or-explain.

- `src/core/**` ist obsidian-/DOM-/node-frei (`npm run check:pure`). Transport wird injiziert.
- Kit-Module nur über `tools/sync-kit.sh` (Herkunfts-Header), nie von Hand.
- `eslint.config.mjs` + `scripts/check-no-inline-disables.mjs` sind Template-Kopien (Dach `tools/release-template/`).
- Tests: `npm test` (unit) · `npm run test:integration` (startet Radicale per `uvx`, s. `scripts/dav-server.ts`).
- DAV-Befunde echter Server: `docs/dav/befunde/` (ohne Zugangsdaten); Erhebungsliste `docs/dav/erhebung-anforderungen.md`.
- Dach-Regeln gelten: `../AGENTS.md` (Kit-first, Release über `../tools/release/`, Store-Flow).

## Transport: `requestUrl` folgt Weiterleitungen selbst

`DavResponse` trägt **keine** finale URL und kann sie nicht tragen — Obsidians `requestUrl`
gibt sie nicht her. Wer eine Zieladresse braucht, liest sie deshalb aus der **Antwort**
(`<d:href>` des Multistatus nennt die tatsächlich beantwortete Ressource), niemals aus der
Anfrage-URL: der Redirect-Zweig in `wellKnown()` (`src/core/dav/discovery.ts`) wird mit diesem
Transport nie betreten. Bis 0.1.6 wurde `/.well-known/caldav/` weiterverwendet — bei Nextcloud
eine andere Route, die über `/index.php/…` in **405** endet. Fakes in Tests müssen beide
Transport-Sorten abbilden (folgend **und** nicht folgend), sonst testen sie den anderen Fall.

**Reale Kette messen** (die einzige Probe, die den echten Transport abdeckt): `discover()` mit
einem redirect-folgenden `fetch`-Transport per `npx tsx` gegen einen echten Server fahren —
dauert eine halbe Minute, s. `_docs/LESSONS.md` 2026-08-25.

## Zugangsdaten: `SecretComponent` ist ein Verweis, kein Passwortfeld

Die Passwort-Zeile im Settings-Tab bindet **nicht** ein Passwort, sondern einen
Schlüsselbund-Eintrag. `setValue(id)` nimmt die Secret-ID, und `onChange` liefert die **ID**
des im Dialog gewählten bzw. neu angelegten Eintrags zurück — nie dessen Wert; das X löst die
Verknüpfung und ruft mit `null` zurück. Den Wert schreibt Obsidian selbst, das Plugin merkt
sich nur, **welcher** Eintrag zum Konto gehört (`account.secretId`), und ruft `setSecret` im
Normalbetrieb gar nicht mehr auf.

Bis 0.1.4 wurde der Rückgabewert als Passwort gespeichert: jedes Konto meldete sich mit dem
*Namen* seines Eintrags an und bekam von jedem Server **401** — sichtbar wurde das nicht, weil
`has()` den Müllwert als „belegt" meldete und die Zeile befüllt aussah. `repairSecretLinks()`
(`src/core/settings.ts`) räumt das beim Start auf. Die `.d.ts` deklariert nur
`setValue(value: string)`; der Beleg für die Semantik steht in der App-Implementierung
(`~/Library/Application Support/obsidian/obsidian-<ver>.asar`) — s. `_docs/LESSONS.md`
2026-08-25. **Der GUI-Smoke deckt diesen Pfad nicht ab** (Radicale läuft ohne Auth).

## Sammlungen: der Ressourcentyp sagt nicht, was drin sein darf

Eine Collection kann `<c:calendar/>` melden und trotzdem **keine Termine** annehmen — Server
führen `VEVENT` und `VTODO` in getrennten Sammlungen (bei mailbox.org der Normalfall). Die
Antwort steht in `supported-calendar-component-set`, und dieselbe Sorte Frage stellt sich
zweimal daneben: `current-user-privilege-set` (ein Kalender kann read-only sein, obwohl er wie
jeder andere aussieht) und Schedule-Inbox/-Outbox, die als Geschwister im selben Home-Set
erscheinen und keine Kalender sind. **Alle drei auswerten, keine aus dem Ressourcentyp
ableiten** — `collectionFromResponse()` (`src/core/dav/discovery.ts`) tut das.

Erheben allein genügt aber nicht: `components` wurde von Anfang an gelesen und bis 2026-08-29
**nirgends benutzt** — der Merge in `settings-tab.ts` ließ das Feld fallen, und eine
Aufgaben-Sammlung war danach von einem Kalender nicht mehr zu unterscheiden. `holdsEvents()`
(`src/core/settings.ts`) beantwortet die Frage jetzt für Sync **und** Einstellungen aus einer
Quelle; sie liegt bewusst dort und nicht im Sync, weil eine wortlos übersprungene Sammlung
schlimmer ist als eine, die gar nicht erst einschaltbar aussieht. Grundregel für alle drei
Eigenschaften: **fehlt die Angabe, wird nichts angenommen** (Radicale liefert sie nicht
zwingend).

### Die Zahlen nachrechnen, statt sie zu glauben — `scripts/vault-dryrun.ts`

Die Punkte (b)–(e) oben ergeben Erwartungswerte („129 Kontakte, 24 Termine"), die eine
Rollout-Vorbereitung als **Abbruchkriterium** benutzt. Sie altern mit dem Vault, und ohne
Werkzeug rechnet sie beim nächsten Mal jemand von Hand nach. `scripts/vault-dryrun.ts` fährt
dafür den **echten** `candidateNotes`/`countTypeExcluded` gegen ein echtes Vault — lesend, ohne
Server, ohne laufendes Obsidian, in Sekunden:

```
npx tsx scripts/vault-dryrun.ts --vault <pfad> --folder <ordner> [--type <typ>] [--expect <n>]
```

`--expect` macht es scharf: bei Abweichung Exit-Code 1 statt einer Zahl, die man überliest.
`--type` bildet `onCreate.type` nach — also genau den Schalter aus (b), der über 89 vs. 129
entscheidet. Das Repo trägt bewusst **keine** Vault-Pfade; die konkreten Aufrufe stehen dort, wo
die Vault-Spezifika hingehören (Rollout-Handover im Cockpit). Grenze: der Frontmatter-Leser
versteht skalare Top-Level-Keys — für `type` und das Source-Feld genügt das, ein Ersatz für
`sync-preview` im Plugin ist es nicht.

## Aufgaben (VTODO): TaskNotes verwaltet, calendar-notes transportiert

Die Spec führte `VTODO/Aufgaben (→ TaskNotes)` als Nicht-Ziel. Die Klammer nannte den
**Zuständigen**, wurde aber als Verbot gelesen — *TaskNotes verwaltet Aufgaben* wurde zu
*calendar-notes fasst Aufgaben nicht an*. Aufgehoben am 2026-09-02 (Anlass und Zuschnitt:
`docs/superpowers/specs/2026-09-02-vtodo-aufgaben-design.md`). Aufgaben zwischen zwei Klienten
desselben Servers zu bewegen ist Transport, nicht Verwaltung — genau die Aufgabe dieses Plugins.

**Die Grenze verläuft an der Schreibhoheit, nicht am Datentyp.** Gelesen wird ausschließlich
`api.model` und `api.catalog` der TaskNotes-Plugin-API — **niemals `api.tasks.*`**. Sobald
calendar-notes eine Aufgabe anlegte oder änderte, verwaltete es sie, und die Zuständigkeits-
grenze der Dach-`AGENTS.md` wäre verschoben statt bedient. Dieselbe Achse wie bei vault-rag:
die Quelle liefert Material und entscheidet nichts.

**Das Notiz-Format wird abgelesen, nicht erfunden** — einmalig über einen Knopf, das Ergebnis
friert als gewöhnliches `MappingProfile` ein (samt gelesener `specVersion`; die API ist ein
Release Candidate). Danach läuft der Sync ohne TaskNotes. Kein Laufzeitgriff aus `src/core/**`,
kein Fremdplugin im Sync-Pfad, und ein API-Bruch fällt beim nächsten Ableiten auf statt still.

⚠️ **Die Wertevokabulare sind die Härte, nicht die Feldnamen.** TaskNotes-Status sind frei
konfigurierbar; die Abbildung läuft über `isCompleted` + `order`, **nie über Namensgleichheit** —
die ist Zufall und bricht beim ersten Nutzer, der umbenennt. Und `taskIdentification` entscheidet
über Sichtbarkeit: wird sie nicht erfüllt, ist die gespiegelte Notiz für TaskNotes unsichtbar,
ohne Fehler und ohne Symptom außer fehlenden Aufgaben.

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

## Was M2b liefert
- Settings-Modell (`src/core/settings.ts`) mit Konten, Sammlungen, Profilen, Sync-Optionen und Normalisierung
- Obsidian-Adapter für Transport (`src/obsidian/transport.ts`), Secret-Speicher (`src/obsidian/secrets.ts`, `app.secretStorage` mit Verifizierung), State-Store (`src/obsidian/state-store.ts`, `manifest.dir/state/`), Vault-Adapter (`src/obsidian/vault-notes.ts` mit Index + Lookup + `prime()`, Plan-Ausführung über `processFrontMatter`/`vault.process`)
- `SyncService` (`src/core/sync/service.ts`) mit injizierten Interfaces (Transport/Secret/State/Lookup/Executor/Notifier) — kompletter Ablauf in 8 vitest-Tests mit Fakes; Refresh → Sync → Plan → Ausführung → State, Fehler isoliert, Notices nur bei neuen Fehlern, Trockenlauf, Epoch-Guard
- Settings-Tab (`src/obsidian/settings-tab.ts`) mit Konten-Verwaltung (Discovery, Passwort via SecretComponent im Schlüsselbund), Sammlungen pro Konto (Profil-Dropdown, Ordner-Override), Profile-Management (JSON-Modal, Im-/Export), Sync-Parameter
- Vorschau-Modal (`src/obsidian/preview-modal.ts`) für Trockenlauf: Gesamtzahl, per-Collection Zähler/Fehler, Operationen nach Typ
- Kommandos: `sync-all` (alle Sammlungen), `sync-preview` (Trockenlauf + Modal), `sync-collection` (Suggester über aktivierte Sammlungen)
- Auslöser: Start-Verzögerung (`onLayoutReady`), Intervall (Mobil vs. Desktop), Neusetzung bei Settings-Änderung
- Manueller Smoke: `OBSIDIAN_PLUGIN_DIR=<staging-vault>/.obsidian/plugins/calendar-notes npm run deploy`, Radicale via `npx esbuild scripts/dav-server.ts --bundle --platform=node --format=esm --outfile=scripts/.dav-server.mjs && node scripts/.dav-server.mjs`, Staging-Vault `$STAGING_VAULTS_DIR/calendar-notes` (Variable aus `~/.zshenv`, Ort in `../AGENTS.md` § Staging-Vaults), Anleitung `docs/smoke/2026-08-22-m2b-manual.md`
- 191 Unit-Tests + 4 Integration-Tests (0 Warnings)

## Was M3 liefert
- Adoptions-Ablauf: Kommando `adopt-collection` + Settings-Button „Bestehende Notizen verknüpfen…" → Review-Modal (Tabelle mit Matching-Grund und Konfidenz, Dropdown je Zeile für `link|skip|create`, Button „Alle sicheren übernehmen") → Verknüpfung schreibt nur nach Bestätigung (`uidField`/`sourceField`/`etagField`/`stateField:live` setzen, Notiz in Sammlungs-State eintragen); Kandidaten = Notizen im Profil-Ordner ohne `dav_source` (sourceField), später erster Sync aktualisiert statt neu anzulegen

### Vor dem ersten Lauf gegen ein gewachsenes Vault
- (a) **Trockenlauf zuerst** — `sync-preview` bzw. `--dryRun` vor jedem echten Adoptions-/Sync-Lauf gegen ein reales Vault.
- (b) **Notizen mit abweichendem `type`** im Profil-Ordner (z. B. `🏢 Organisation` statt des im Profil hinterlegten `onCreate.type`) werden bei der Adoption **nicht geprüft** — `candidateNotes()` filtert sie stillschweigend heraus. Das Modal zeigt nur ihre **Anzahl** (`countTypeExcluded`, „N Notiz(en) im Ordner mit abweichendem Typ wurden nicht geprüft"). Gibt es für sie Server-Einträge, entstehen beim Sync **neue Notizen** (mit Suffix), weil keine Zuordnung existiert.
  **Der Ausweg kostet nichts, weil die beiden Felder zu verschiedenen Zeitpunkten wirken:**
  `onCreate` liest ausschließlich der `create`-Zweig des Plans (`src/core/mirror/plan.ts`), und
  `candidateNotes()`/`countTypeExcluded()` rufen ausschließlich die Adoption auf
  (`src/main.ts`, `src/obsidian/adoption-modal.ts`) — der laufende Sync fasst weder das eine
  noch das andere an. Also: **`onCreate.type` für die Dauer der Adoption entfernen** (dann sind
  alle Notizen des Ordners Kandidat, unabhängig vom Typ), nach der Adoption wieder eintragen,
  damit später neu angelegte Notizen ihren Typ bekommen. Die Alternative — Typ gesetzt lassen
  und die Abweichler von Hand verknüpfen — ist nur bei wenigen Abweichlern billiger.
- (c) **Profil-aus-Notiz setzt den Ordner der Beispielnotiz** wörtlich. Bei Lifecycle-Unterordnern (z. B. `70_Termine/10_Anstehend`) den Ordner im generierten Profil vorher auf den übergeordneten Ordner (`70_Termine`) weiten — sonst sieht die Adoption nur den einen Unterordner, in dem die Beispielnotiz lag.
- (d) `datum`+`uhrzeit`-Termine: `uhrzeit` hat **kein Server-Gegenstück** (VEVENT kennt nur `start`/`end` als volle Zeitstempel) und bleibt unverwaltet — Änderungen daran werden von der Synchronisation weder gelesen noch überschrieben.
  **Daraus folgt eine Mapping-Regel, die `profile-from-note` seit 2026-08-30 selbst einhält:**
  die Synonym-Tabelle mappt `datum` auf `start` (`src/core/mirror/profile-from-note.ts`), aber
  trägt dieselbe Notiz ein `uhrzeit`, wird genau dieses Synonym **unterdrückt** — `start` bleibt
  leer (bzw. bekommt ein daneben vorhandenes `termin_start`) und `datum` erscheint in `unmapped`,
  damit die Notice es zeigt. Sonst schriebe der erste Sync den vollen Server-Zeitstempel
  (`"2026-09-01T10:00:00"`, `src/core/mirror/fields.ts`) in ein Feld, das bisher ein reines
  Datum trug, und `uhrzeit` widerspräche ihm ab da. Fürs **Finden** ist das Mapping ohnehin
  entbehrlich: `noteEventMoment()` (`src/core/adopt/match.ts`) setzt `datum` und `uhrzeit` selbst
  zusammen und probiert zusätzlich `termin_start`/`start` als feste Fallback-Keys — die Adoption
  erkennt solche Termine also auch bei leerem `start`-Mapping. **Der Handgriff im Rollout entfällt
  damit**; er bleibt nur dort nötig, wo ein Profil aus einer Notiz OHNE `uhrzeit` abgeleitet und
  danach auf Notizen mit `uhrzeit` angewandt wird.
- (e) **Ein Ordner, zwei Feldmuster** ist der Normalfall in gewachsenen Vaults (etwa Termine, die
  teils `termin_start`, teils `datum` tragen). Ein Profil kann pro Server-Feld nur **einen**
  Notiz-Key führen, und `suggestProfileFromNote` nimmt den ersten Treffer der
  Frontmatter-Reihenfolge — welches Muster gewinnt, hängt also an der Beispielnotiz. Vor der
  Adoption auszählen, welches Muster häufiger ist, und die Beispielnotiz danach wählen; das
  andere Muster findet der Matcher über die Fallback-Keys aus (d), sofern sie zu den dort
  genannten gehören.
- (f) **Eine fremde UID im Frontmatter ist keine DAV-UID — `event_uid` bleibt draußen.**
  `UID_KEYS` (`src/core/mirror/profile-from-note.ts`) erkennt `vcard_uid`/`ical_uid`/`uid` als
  abweichendes Identitätsfeld, **nicht** `event_uid`. Das ist eine gemessene Entscheidung
  (2026-08-30), keine Lücke: 9 der 24 Pallas-Terminnotizen tragen den Schlüssel, seine Werte sind
  Apple-Kalender-UUIDs (Großbuchstaben-Form, `kalender:` daneben), und zwei Notizen teilen sich
  denselben Wert. `adoptionPlan` **beschreibt** `profile.uidField` mit der Server-UID
  (`src/core/adopt/plan.ts`) — stünde `event_uid` in der Liste, überschriebe die Adoption einen
  fremden Bezug unwiederbringlich. Folge fürs Vault: neben `event_uid` entsteht ein zweites
  Identitätsfeld (`dav_uid`). **Das ist gewollt** — zwei Systeme, zwei Identitäten, und der
  `dav_`-Präfix trennt die Namensräume. Wer es anders will, setzt `uidField` im Profil-JSON von
  Hand. Gegen ein stilles Zurückdrehen steht ein Pin in
  `tests/core/mirror/profile-from-note.test.ts` (Gegenprobe gefahren: mit `event_uid` in
  `UID_KEYS` wird er rot).
- Profil-Ableitungs-Modul (`src/core/mirror/profile-from-note.ts`): Case-insensitives Mapping aus beliebigen Frontmatter-Keys (`organisation→org`, `mobil→tel_cell` u.a.) mit Heuristik-Synonymen; Kommando `profile-from-note` auf aktiver Notiz → Profil in Settings anlegen → Notice mit mapped/unmapped
- Matching-Regeln (E-Mail exakt → Telefon normalisiert E.164 → Name fuzzy bis Konfidenz-Schwelle; Termine: Start exakt + Titel-Ähnlichkeit) mit `sure/likely/weak`-Stufen (`src/core/adopt/match.ts`, `src/core/adopt/phone.ts`)
- Staging-Vault-Fixture (`fixtures/vault/`) mit Pallas-ähnlicher Struktur (Kontakte + Termine mit echten Feldmustern) und Default-Profil-Vorlage, über `npm run smoke:gui -- --setup|--section generic|pallas` abrufbar
- GUI-Smoke-Treiber (`scripts/gui-smoke.ts`, zentrale CDP-Brücke via `../../tools/obsidian-cdp/`) mit Prüfpunkten P1–P9 (Laden, Discovery, Adoption, Sync, Updates, Löschung, Discovery-Stabilität, Settings-UI nur mit `--focus`); Baseline `docs/smoke/baseline-2026-08-22.md`
- Vault-Open-Helfer für CDP-Treiber: `window.electron.ipcRenderer.sendSync('vault-open', dir, false)` per beliebiges Fenster; Treiber wartet bis `readyState==="complete"` oder bricht mit Anleitung ab
- 285 Unit-Tests + 4 Integration-Tests (0 Warnings)

## Was M4 liefert
- Explizite Kommandos (`src/core/commands/`): `event.move` (Start/Ende/allDay/tzid), `event.set-title/-location/-url/-description`, `event.add-attendee`/`event.remove-attendee` (setzen `plan.invite`), `event.set-partstat`, `event.delete`, `event.create`; Kontakt-Gegenstücke `contact.set-name/-email/-phone/-org/-title/-note/-birthday`, `contact.remove-email/-phone`, `contact.create`; `push-hand-edits.ts` (Frontmatter-Handänderung → Mutationen, unterstützte Felder je Art); `undo.ts` (`planUndoLast` aus dem Verlauf + `UNDO_LAST_COMMAND`, seit Fix-Runde 1 ein regulärer `commandRegistry()`-Eintrag `undo.last`, `kind: "any"` — wirkt auf Termine UND Kontakte, `appliesTo` prüft nur `ctx.history?.length`). Registry-Bootstrap `ensureDefaultCommands()` (`src/core/commands/registry.ts`, idempotent) — aufgerufen in `main.ts::onload()` VOR `CommandFlow`/`createPluginApi` UND defensiv nochmal in `createPluginApi` selbst; live per zweimaligem `disablePlugin`/`enablePlugin` bestätigt (`commands().length` bleibt stabil, kein „Doppelte Kommando-ID"-Wurf). Mini-JSON-Schema + Validator (`src/core/commands/schema.ts`, kein ajv).
- Ausführung (`src/core/sync/execute.ts`, `executeCommandPlan`): `PUT` mit `If-Match: <etag>` (create: `If-None-Match`), 412 → `{ conflict: true, freshEtag? }` (UI bietet „Mit frischem Stand erneut"), nach Erfolg gezielter `resyncObject(collectionId, href)` — GET des einzelnen Objekts, `applyDelta` mit synthetischem Delta, Notiz-Plan ausführen, State speichern.
- Einladungs-Weg (`src/obsidian/invite.ts`, `InviteRouter.route`): Server-Scheduling (`account.scheduling.outbox`, per `discoverScheduling` in `src/core/dav/scheduling.ts`) → registrierter Mail-Transport → `.ics`-Fallback (Textmodal mit Kopieren/Speichern). `src/core/commands/imip.ts` baut die iMIP-Nachricht (`METHOD:REQUEST`/`CANCEL` ins VCALENDAR eingefügt, Betreff/Klartext/`.ics`) — Vertrag mit mailstone, eigenständige Kopie der Typen (kein Import über `src/core/**`, PROF-OBS-09).
- Plugin-API v1 (`src/obsidian/api.ts` `createPluginApi`, Typen `src/core/api/types.ts`, Doku `docs/API.md`): `app.plugins.plugins["calendar-notes"].api` mit `version: 1`, `events()`/`contacts()`/`get()` (lesen aus dem State, nie live vom Server), `commands()`/`tools()` (Kommando-Schemata als LLM-Tool-Definitionen — `toolDefinitions()` ersetzt `.`→`_` in den Namen), zweistufig `plan()`/`execute()` (öffnet nie ein Modal — Bestätigung liegt beim Aufrufer), `registerMailTransport`/`unregisterMailTransport`, `on("synced"|"changed", cb)`. Jede Methode fängt selbst und liefert `{ error }`. Zweites Exemplar des Anbieter-Musters aus `vault-rag/src/plugin_api.ts` im Dach → Registry-Kandidat (s. `docs/registry-kandidaten.md`).
- UI (`src/obsidian/command-modal.ts` `SchemaFormModal`, `src/obsidian/plan-preview-modal.ts`): Formular aus Schema (Text/Toggle/Dropdown/TextArea/Datum, Email-Felder mit Kontakt-Suggester), Diff-Vorschau vor jeder Ausführung, Kommando-IDs (`addCommand`, s. `main.ts::registerCommands`) `run-on-note`/`new-event`/`new-contact`/`undo-last-change`/`push-hand-edits`.
- GUI-Smoke um P10–P13 erweitert (`scripts/gui-smoke.ts`; Protokoll `docs/smoke/baseline-2026-08-23.md`): P10 Kommando via API (`event.move`), P11 Einladung ohne Scheduling/Transport (Route `ics`), P12 Undo (`undo.last` via API, läuft direkt nach P10 — DTSTART zurück auf den Vor-P10-Stand), P13 API-Lesen (`events`/`contacts`/`tools().length === commands().length`). Lauf 3 (2026-08-23, Commit `58b43d0`) fand P10/P11/P13 strukturell rot (`commandRegistry()` blieb zur Laufzeit leer, s. Fix-Runde-1-Absatz oben) und P12 nur `⚠ übersprungen`. **Fix-Runde 1 behebt das** — Lauf 4 (`--section generic` **12/12**, `--section pallas` **4/4**, keine Regression, s. `docs/SMOKE.md` § „Behobener Befund (2026-08-23, Fix-Runde 1)"). Zwei zusätzliche Treiber-eigene Mess-Bugs (kein Plugin-Defekt) dabei behoben: `extractDtstart()` traf zuerst ein `VTIMEZONE`-`DTSTART` statt des `VEVENT`s, und die P11-ATTENDEE-Prüfung scheiterte an RFC5545-Zeilenfaltung.
- Hinweis für M5 (i18n-Schuld im Kommando-System, Review-Runde 3, M9): `CommandDescriptor.title`/`.description`, `CommandPlan.summary` UND die Schema-Feld-`description`s (`ObjectSchema`/`FieldSchema`, `src/core/commands/schema.ts`) sind fest deutschsprachige Literale in `src/core/**` (kein `t()`-Import erlaubt dort) — nicht nur `event.set-title`s `SUMMARY`-Zugriff. Eine EN-Oberfläche braucht strukturierte Nachfolger statt fertiger Strings: `titleKey`/`descriptionKey` am `CommandDescriptor`, `summaryKey` (+ Parameter) am `CommandPlan`, und `descriptionKey` je Schema-Feld — aufgelöst über `t()` erst in der Obsidian-Schicht (Formular/Vorschau-Modal). Das betrifft NICHT nur die UI: `api.commands()`/`api.tools()` geben `title`/`description`/Schema-`description` unverändert an Fremdplugins/LLM-Tool-Definitionen weiter — ein Wechsel von fertigem Text auf `*Key`-Felder wäre also eine BRECHENDE Änderung des Plugin-API-Vertrags (`CALENDAR_NOTES_API_VERSION` müsste steigen, s. `docs/API.md`), nicht nur ein internes Refactoring.
- 455 Unit-Tests + 4 Integration-Tests (0 Warnings)

## Was M5 liefert
- i18n-Abschluss der Kommandos: `CommandDescriptor.titleKey`/`.descriptionKey`,
  `CommandPlan.summaryKey`/`summaryArgs` (Pflichtfelder, `title`/`description`/`summary`
  bleiben englischer Fallback) — `src/core/commands/**` bleibt obsidian-/i18n-frei, die
  Übersetzung passiert erst in der Obsidian-Schicht (`command-flow.ts`,
  `plan-preview-modal.ts`, `api.ts`); Registry-Test prüft DE/EN-Vollständigkeit jedes
  Keys. Schließt die in M4 dokumentierte i18n-Schuld.
- README de/en (`README.md`/`README.de.md`) nach `_docs/readme/readme-spec.json`,
  Aufnahme-Rezept `scripts/shots.ts` (zentrale CDP-Brücke, Skill `readme-shots`).
- Release-Infrastruktur nach Dach-Standard: `.github/workflows/release.yml` (vendored),
  `versions.json`, `package.json`-Scripts `release`/`version-bump`/`preflight`
  (delegieren an `../tools/release/`), `LICENSE` (AGPL-3.0-or-later) + `LICENSING.md` +
  `THIRD-PARTY.md`, `docs/AUDIT.md` (npm-audit-Einordnung).
- Store-Vorbereitung: `docs/STORE.md` (Scorecard-Vorschau, Netzwerk-Erklärung für den
  Review, Einreichungs-Checkliste), `docs/RELEASE.md` (Maintainer-Handover für Remotes +
  Erst-Release + Dashboard/Rescan).
- **Veröffentlicht (2026-08-23):** README-Bilder aufgenommen (`npm run shots`), Remotes
  `origin` (Forgejo `jkaindl/calendar-notes`) + `github` (`johannes-kaindl/calendar-notes`),
  Releases 0.1.0 (Action rot — CI-Gate, s. `docs/RELEASE.md`), 0.1.1, 0.1.2 (Name ohne `&`),
  **0.1.3 im Community Store: Scorecard „Passed", 0 Warnings.** Updates laufen über
  `npm run release <version>` + Rescan im Developer Dashboard.
- **Stand 2026-08-25: 0.1.7, Rescan „Passed" / 0 Warnings.** 0.1.4–0.1.7 sind vier
  Auth-/Discovery-Fixes, die erst am echten Server sichtbar wurden (CRLF im Passwort,
  `SecretComponent`-Verweis, dessen Altbestand-Reparatur, geratene Startadresse) — die
  beiden Abschnitte oben tragen die Lehren daraus.
- **Stand 2026-08-29: 0.1.8, Rescan „Passed“ / 0 Warnings** (dritte Höchstwertung in
  Folge nach 0.1.3 und 0.1.7). Fünfter Fix derselben
  Sorte: eine Server-Eigenschaft wurde erhoben, aber nicht ausgewertet (VTODO-Sammlungen,
  s. Abschnitt „Sammlungen" oben). Auffällig geworden ist er nicht am Code, sondern an einer
  Erhebung gegen den echten Server (`docs/dav/befunde/mailbox-org.md`, 2026-08-29) — dieselbe
  Lehre wie bei 0.1.4–0.1.7, nur eine Stufe später in der Kette.
- **Stand 2026-08-29 (abends): 0.1.9, Rescan „Passed" / 0 Warnings** — vierte Höchstwertung
  in Folge. Sechster Fix derselben Sorte und der bislang heikelste, weil er **ausschließlich
  neue Nutzer** traf: eine **leere** Sammlung antwortet regulär mit selbstschließendem
  `<D:multistatus/>`, `fast-xml-parser` macht daraus einen leeren **String**, und die
  Wurzelknoten-Prüfung (`!ms || typeof ms !== "object"`) hielt das für eine fehlende Wurzel.
  Betroffen war jede leere Sammlung — also genau der Zustand beim Ersteinrichten; bestehende
  Nutzer sahen ihn nie. Gefunden wurde er erst, **nachdem die Fehlermeldung diagnostizierbar
  gemacht wurde** (sie stand wortgleich an sieben Aufrufstellen und nannte weder Anfrage noch
  Antwort); zwei direktere Wege scheiterten vorher. Beide Lehren in `_docs/LESSONS.md`
  2026-08-29. Dazu die Settings-Überarbeitung aus dem Erstkontakt-Befund.
- 498 Unit-Tests + 4 Integration-Tests (0 Warnings) — M5 fügt keine neue Fachlogik hinzu.

## Was M6a liefert

**Aufgaben als dritter Objekttyp, einbahnig Server → Vault.** Zurückgeschrieben wird nichts —
das ist M6b (Spec § 11).

- `src/core/ical/todo.ts` — `parseTodos`/`isOpen`. DTSTART **und** DUE sind bei VTODO beide
  optional (RFC 5545 4.6.2), anders als DTSTART bei VEVENT; der Anker ist DTSTART, sonst DUE.
  Die komponentenneutralen Zeit-Helfer liegen seit M6a getrennt in `ical/time.ts`.
- `src/core/mirror/todo-values.ts` — Statusabbildung, Prioritätsabbildung, Aufgaben-Block und
  die **eigene Fensterregel** `todoInWindow`: offene Aufgaben liegen IMMER im Fenster, auch
  ohne jedes Datum; erledigte nur, solange ihr Abschluss im Fenster liegt. Fehlt COMPLETED,
  entscheidet LAST-MODIFIED; fehlt auch das, wird gespiegelt statt archiviert.
- `ProfileKind` um `"todo"` erweitert, `defaultTodoProfile()` mit `statusMap`/`priorityMap`,
  Ordner `Tasks`, `onCreate: { type: "task" }`.
- `collectionSupports(col, kind)` löst `holdsEvents()` ab: die Prüfung hängt an der
  **Paarung** aus Sammlung und Profil, nicht an der Sammlung allein. mailbox.org führt VEVENT
  und VTODO in getrennten Sammlungen, die beide `kind === "calendar"` sind (gemessen, s.
  `docs/dav/befunde/mailbox-org.md`).
- Ableitungs-Knopf in den Einstellungen: liest TaskNotes' In-Process-API einmalig aus und
  **friert das Ergebnis im Profil ein** — keine Laufzeit-Kopplung. Nur `model`/`catalog`
  lesen, nie `api.tasks.*`: sonst verwaltet calendar-notes Aufgaben, und das ist TaskNotes'
  Zuständigkeit. Messbefund zur fremden API: `docs/tasknotes-api.md`.
- 609 Unit-Tests + 5 Integrationstests, GUI-Smoke `--section todo` 9/9 mit Gegenprobe.

### Zwei Sätze, die eine spätere Session braucht

**`assertNever` sichert die Erweiterung von `ProfileKind` ab** — wer den Typ um eine vierte
Sorte erweitert, bekommt vom Compiler jede Stelle gezeigt, die einen Zweig braucht. Der
Wächter heißt `assertNever` (verlangt `never` an der Aufrufstelle) bzw. `nichtUnterstuetzt`
(nimmt `ProfileKind` und wirft) in `src/core/mirror/kind.ts`.

⚠️ **Er schützt aber nur die Achse, an der er steht — und es gibt zwei.** `ProfileKind`
(contact/event/todo) sagt, *was gespiegelt wird*; `CollectionKind` (calendar/addressbook)
sagt, *wie der Server es ausliefert*. M6a erweiterte die erste, und genau deshalb blieb ein
Fehlstand auf der zweiten unsichtbar: `service.ts` entschied anhand von `col.kind`, ob der
Termin-Abrufpfad genommen wird, und dessen `calendar-query` filtert fest auf VEVENT — eine
Aufgaben-Sammlung lieferte darüber **strukturell null Treffer, ohne Fehler und ohne Warnung**.
Gefunden hat das der GUI-Smoke, nicht der Typecheck und nicht 608 grüne Unit-Tests (die
füttern `apply.ts` mit bereits geholten Rohdaten — die Lücke lag zwischen den Schichten).
**Wer an einer der beiden Achsen etwas ändert, sieht auf der anderen nach.**

**Die zwei Fenster-Ausdrücke in `apply.ts` müssen von Hand erschöpfend gehalten werden**, weil
der Compiler sie nicht sieht: sie verzweigen auf den Profil-`kind`, ohne einen `never`-Zweig
zu erzwingen. Kommt eine vierte Sorte dazu, gehört sie dort ausdrücklich eingetragen.

## Was M6b liefert

**Die Rückrichtung: Vault → Server.** Ein Sammel-Kommando (`todo-sync`) zeigt alle
Unterschiede gruppiert und fragt je Zeile, welche Seite gewinnt. Gebündelt wird die
**Bestätigung**, nicht das Schreiben ohne sie.

- `src/core/mirror/todo-reverse.ts` — `reverseStatus`/`reversePriority`, **bewahrend**.
- `src/core/sync/todo-collect.ts` — `classifyTodos`: drei Gruppen (nur im Vault geändert /
  neu / auf beiden Seiten geändert), rein, transportfrei. Der Serverstand kommt als
  **ETag-Karte je Sammlung** (ein Request, nicht einer je Notiz) — das macht die vollständige
  Konfliktanzeige bezahlbar.
- `src/core/commands/todo-commands.ts` — `planTodoCreate` (Erstanlage mit `If-None-Match`),
  `TODO_SUPPORTED`, `todoServerFeld`.
- `src/core/sync/execute.ts` — `executeCommandPlans`: mehrere Pläne unter **einem**
  Busy-Guard.
- `src/obsidian/todo-sync-modal.ts` — das Auswahl-Modal.
- 689 Unit-Tests + 6 Integrationstests, GUI-Smoke `--section todo` **15/15** mit Gegenprobe.

**Löschen bleibt Nicht-Ziel** (Spec §8): kein Weg im Plugin erzeugt einen `delete`-Plan für
eine Aufgabe. Wer eine Notiz löscht, löscht die Notiz — die Aufgabe auf dem Server bleibt.

### Drei Sätze, die eine spätere Session braucht

**Die Zusage „eine abgebrochene Aufgabe wird nicht zu einer erledigten" hängt an ZWEI
Eigenschaften, nicht an einer.** `statusMap` bildet `CANCELLED` und `COMPLETED` beide auf
`done` ab, rückwärts ist die Abbildung also nicht eindeutig. Es tragen: (a) `planTodoHandEdits`
mutiert **nur geänderte** Frontmatter-Schlüssel, und (b) `reverseStatus` schreibt nichts, wenn
der alte Serverzustand weiterhin auf den neuen Wert abbildet. Am 2026-09-05 live gemessen:
schaltet man (a) ab, hält (b) die Zusage; schaltet man beide ab, wird aus `CANCELLED` ein
`COMPLETED`. **Solange (a) steht, ist (b) unerreichbar** — `handEditedKeys` meldet `status` nur,
wenn der Frontmatter-Wert vom zuletzt geschriebenen abweicht, und dann kann
`statusValue(alt) === ziel` nicht mehr gelten. (b) ist also ein Netz für eine andere Bauart, kein
Wirkmechanismus der aktuellen. Wer (a) ändert, zieht seine Begründung aus (b) — und umgekehrt.

**Eine im Vault entstandene Aufgabe muss ihre neue UID BEANSPRUCHEN**
(`CommandPlan.claimsNote` → `ApplyInput.claim`). Ohne das findet der Resync nach dem PUT keine
Notiz zu dieser UID, legt eine zweite an, und die Ausgangsnotiz bleibt ohne `dav_uid` — beim
nächsten Lauf ist sie wieder „neu" und legt die Aufgabe **erneut** an. Am 2026-09-05 als P28 des
GUI-Smokes gemessen und behoben.

⚠️ **`VaultNoteLookup.byPath` liefert nur GEPRIMTE Pfade** — das ist Absicht (s. Klassenkopf),
aber es macht jeden Fake gefährlich, der großzügiger ist. Der erste Fix zum Absatz darüber war
im Unit-Test grün und gegen ein echtes Obsidian rot, weil der Fake jeden Pfad fand. Wer eine
Notiz auflöst, die weder im Profil-Index noch im State steht, nennt ihren Pfad in
`lookupFor(profile, extraPaths)` — und der Fake im Test bildet das nach.

## Release-Checkliste

Kurzfassung — Details in `docs/RELEASE.md` (Ablauf) und `docs/STORE.md` (Scorecard-
Vorschau + Checkliste vor dem Erst-Release):

1. `npm run gate && npm run test:integration && npm run typecheck:scripts` grün.
2. `npm run smoke:gui` (beide Sektionen) gegen ein laufendes, fokussiertes Obsidian.
3. README-Bilder aufgenommen, `shots:check` grün.
4. Remotes (Forgejo + GitHub) angelegt, `npm run release 0.1.0` gefahren.
5. Developer Dashboard: Plugin registriert, Rescan angestoßen, Status geprüft (der Tag
   ist nicht das Ende).
