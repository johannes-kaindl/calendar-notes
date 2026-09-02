# calendar-notes — Design-Spec

**Datum:** 2026-08-22 · **Status:** vom Maintainer abgenommen (Abschnitte 1–6 einzeln), Umsetzung freigegeben
**Repo:** `obsidian-plugins/calendar-notes/` · **Arbeitsname:** `calendar-notes` (Anzeigename-Vorschlag „Calendar & Contact Notes", entscheidbar bis Erst-Release)
**Nachbar-Spuren:** `<shared>/40_Tools/mailbox-org/` (DAV-Quelle, liefert Befunde nach `docs/dav/befunde/`), `../mailstone/` (künftiges IMAP-Plugin, Vertrag in `mailstone/docs/2026-08-22-anforderungen-aus-calendar-notes.md`)

---

## 0. Problem und Entscheidungen in einem Absatz

Kalender und Kontakte liegen auf DAV-Servern (mailbox.org heute, Nextcloud möglich) und sind in Obsidian nicht verlinkbar, nicht auswertbar, nicht SSOT-fähig. Das Plugin spiegelt CalDAV-Termine und CardDAV-Kontakte als Notizen in den Vault. **Der Server ist die Wahrheit, die Notiz ist Spiegel.** Geschrieben wird ausschließlich über explizite Kommandos (`PUT` mit `If-Match`), nie durch Editieren der Notiz — kein bidirektionaler Merge. Ein Plugin für beide Protokolle (gemeinsamer Transport, getrennte Adapter), server-agnostisch nach RFC 4791/6352/6578, mobil-fähig über `requestUrl`. Mail (IMAP), WebDAV-Dateien (Remotely Save) und Aufgaben (TaskNotes) sind außerhalb.

Store-Recherche 2026-08-22: die Kombination „Kontakte **und** Termine als Notizen, Server = Wahrheit, Schreibkommandos, server-agnostisch" existiert nicht. Bauart „`requestUrl` + Basic Auth + Notizen schreiben" erreicht gemessen `Passed` (harang-contacts, nextcloud-tasks, powerdesk).

## 1. Architektur

```
src/
  core/                  ← obsidian-frei, pure, vitest-getestet
    dav/                 discovery · propfind/report-Builder · xml-parse (namespace-tolerant) · sync (sync-token ∨ ctag+etag) · Transport-Interface (injiziert)
    ical/                VEVENT-Parser/-Serializer via ical.js (RRULE/EXDATE/VALARM/ATTENDEE/TZ)
    vcard/               vCard 3.0/4.0 via ical.js
    mirror/              Server-Stand → Notiz-Plan (create/update/archive/delete), verwaltete Keys, Mapping, Body-Block-Merge
    commands/            Kommando = { id, schema, describe, plan, execute } — Mutation + If-Match-PUT-Plan
    adopt/               Matching bestehender Notizen gegen Server-Einträge
  obsidian/              requestUrl-Transport · Vault-Adapter (Vault-API, metadataCache-Suche nach uidField) · Settings-Tab · Commands/Modals · Notices · Plugin-API
  main.ts
```

Regeln: **(a)** `core/` importiert nie `obsidian`; Transport, Dateisystem, Uhr, Secret-Zugriff werden injiziert. **(b)** `mirror/`/`commands/` entscheiden *was*, `obsidian/` führt aus. **(c)** Kit-first: `withTimeout`, Settings-Merge, i18n, `folder-suggest`, `confirm` aus `obsidian-kit` vendoren (Sync-Skript + Herkunftsstempel); Snapshot-Zustand nach dem `wikijs-maintainer`-Muster (eine JSON je Sammlung). Runtime-Dependencies: `ical.js` (MPL-2.0, iCalendar + vCard) und `fast-xml-parser` (MIT, WebDAV-Multistatus ohne DOM — `core/` darf keinen `DOMParser` anfassen).

## 2. Datenmodell

**Identität.** Jede gespiegelte Notiz trägt `uidField` (Default `dav_uid`; Wert = UID aus VEVENT/VCARD) und `sourceField` (Default `dav_source`, Wert `<konto-id>/<sammlung-id>`). Notizen werden **nur** über diese Felder im Metadata-Cache gefunden — nie über Pfad/Dateiname. Zusätzlich verwaltet: `dav_etag`, `dav_state` (`live|archived|deleted`), bei Abweichungs-Instanzen `dav_recurrence_id`.

**Drei Feldklassen im Frontmatter:**

| Klasse | Beispiele | Verhalten |
|---|---|---|
| verwaltet | Kontakt: `email, tel_*, adr, org, title, url, bday, photo` · Termin: `start, end, allday, location, online, attendees, organizer, rrule, status, categories` | vom Server überschrieben; Feldname via Mapping; leerer Server-Wert entfernt den Key |
| einmalig | `type, status, created, up` (aus `onCreate` des Profils) | nur bei Neuanlage gesetzt |
| frei | alles andere | nie angefasst |

`attendees`/`organizer` werden zu Wikilinks aufgelöst, wenn eine gespiegelte Kontakt-Notiz mit dieser E-Mail existiert, sonst Text.

**Body.** Verwalteter Block zwischen `%% dav:begin %%` … `%% dav:end %%` (Beschreibung, weitere Nummern/Adressen, Foto). Alles außerhalb ist Nutzerinhalt und überlebt jeden Sync. Fehlt der Block, wird er ans Ende gesetzt — oder per Profil (`body: "none"`) nie geschrieben.

**Wiederholungen.** Eine Notiz je VEVENT-Master (mit `rrule`), keine Instanz-Notizen. Server-seitige Einzelabweichungen (`RECURRENCE-ID`) bekommen eigene Notiz mit `dav_recurrence_id` + Link auf den Master. Expansion ist keine Stufe-1-Aufgabe.

**Zeitfenster.** Termine in `[heute − N, heute + M]` (Default 90/365 Tage). Herausfallende Termine → `dav_state: archived`, nicht gelöscht. Vom Server Gelöschtes: hat die Notiz Backlinks oder freien Body → `dav_state: deleted` + Notice; sonst `app.fileManager.trashFile(file)` (ehrt die Papierkorb-Einstellung des Nutzers: System-Papierkorb oder `.trash/`; Entscheidung M2b — die Store-Lint-Regel `prefer-file-manager-trash-file` verlangt genau das).

**Dateiname** bei Neuanlage aus Profil-Template in der Kit-Syntax `filename-template` (`{start_date} {title}` / `{fn}`; Platzhalter: `title`, `start_date`, `start_time`, `uid`, `fn`, `family`, `given`, `org`), Kollision → Suffix ` (2)`. Nie automatisches Umbenennen; `title` folgt dem Server, Dateiname bleibt.

## 3. Sync (Stufe 1)

**Konto** `{ id, name, baseUrl, username, secretId }` in `data.json`; Passwort in `app.secretStorage` unter `secretId = "calendar-notes-<konto-id>"` (Obsidian ≥ 1.11.4, OS-verschlüsselt via Electron safeStorage, **nicht** vault-synct → je Gerät einmal eingeben). Settings-Tab nutzt `SecretComponent`. Nach `setSecret` Rücklesen (TaskNotes-Kniff). Fehlt das Secret auf einem Gerät → Status „Passwort auf diesem Gerät nicht hinterlegt", Konto pausiert ohne Fehler-Spam. Offen: Verfügbarkeit von `secretStorage` auf Mobile — beim Smoke am Gerät prüfen.

**Discovery** beim Anlegen: `PROPFIND /.well-known/caldav|carddav` (Redirect folgen) → `current-user-principal` → `calendar-home-set` / `addressbook-home-set` → Sammlungen mit `displayname`, `resourcetype`, `supported-calendar-component-set`, `current-user-privilege-set`, `getctag`, `sync-token`. Nutzer hakt Sammlungen an und weist Zielordner + Mapping-Profil zu. Mehrere Konten sind Normalfall.

**Abgleich je Sammlung:**
1. Server meldet `sync-token` → `REPORT sync-collection` → geänderte/gelöschte hrefs → `multiget`.
2. Sonst `PROPFIND Depth:1` (href+etag) vs. Snapshot → `multiget` der Geänderten; Kalender zusätzlich `calendar-query` mit `time-range`.

**Snapshot** `.obsidian/plugins/<id>/state/<konto>-<sammlung>.json`: `syncToken|ctag`, je href `{ etag, uid, raw, writtenHash }`. `writtenHash` = Hash der zuletzt geschriebenen verwalteten Felder → unverändert = Notiz nicht anfassen; weicht das Frontmatter davon ab = Nutzer hat verwaltetes Feld von Hand geändert → Notice mit Angebot „auf den Server schreiben" (Stufe 2) oder Überschreiben beim nächsten Sync. `raw` = letztes Server-Objekt (Basis für Kommandos), Verlauf der letzten 10 je UID für „Änderung zurücknehmen".

**Auslöser:** Start (verzögert, nicht im `onload`-Pfad), Intervall (Default 15 min, 0 = aus, mobil eigener Wert), Kommando „Jetzt synchronisieren" (alle / je Sammlung). Epoch-Guard: nie zwei Läufe parallel.

**Fehler:** je Sammlung isoliert; Status-Zeile in den Settings (letzter Lauf, Zähler, letzter Fehler); Notice nur bei *neuen* Fehlern. `requestUrl({throw:false})` + `withTimeout`; 401/404/412/429 unterschieden; unparsbares Einzelobjekt wird übersprungen und geloggt.

**Trockenlauf:** jeder Sync und jede Adoption hat einen Vorschau-Modus (Plan als Modal/Notiz, keine Schreibvorgänge). Erster Lauf gegen einen echten Vault nur so.

## 4. Mapping-Profile und Adoption

**Profil** (benannt, je Sammlung zugewiesen, in `data.json`, export-/importierbar als JSON):
```
{ name, kind: "contact"|"event", folder, filename, uidField, sourceField,
  fields: { <serverFeld>: <frontmatterKey> | null }, onCreate: { type, status, up, ... }, body: "block"|"none" }
```
`null` = Feld nicht spiegeln. Zwei generische Default-Profile liegen bei (englische Keys). „Profil aus dieser Notiz erzeugen" liest die Keys einer Beispielnotiz und schlägt die Zuordnung vor. Beispiel Pallas: `kind: contact`, `folder: 50_Ressourcen/10_Reference/10_Kontakte`, `uidField: vcard_uid`, `fields: { email:"email", tel_cell:"mobil", tel_home:"telefon", org:"organisation", title:"rolle", adr:"adresse", url:"website" }`, `onCreate: { type:"👤 Kontakt", status:"3-evergreen 🌿", up:"[[10_Kontakte]]" }`. Termine: `termin_start/termin_ende/datum/ort/online/teilnehmer`, `type: 📅 Termin`, Ordner `30_Chronos/70_Termine/10_Anstehend`.

**Adoption** („Bestehende Notizen mit Server-Einträgen verknüpfen", je Sammlung):
1. Kandidaten = Notizen im Profil-Ordner ohne `uidField`, mit `onCreate.type`.
2. Match: exakte E-Mail → Telefon (E.164-normalisiert) → Name (fn vs. Dateiname/`title`/`aliases`, fuzzy mit Schwelle). Termine: `start` exakt **und** Titel-Ähnlichkeit.
3. Review-Modal (Notiz · Server-Eintrag · Grund), je Zeile Verknüpfen/Überspringen/Neu anlegen, „alle sicheren übernehmen". Erst Bestätigen schreibt `uidField`+`sourceField`.
4. Nicht-Gematchte bleiben unberührt; Notizen ohne Server-Eintrag (z. B. Organisationen) werden nie angefasst; das Plugin legt nie aus Notizen Server-Einträge an.

## 5. Stufe 2: Kommandos

Kommando = `(uid, Mutation)` auf dem **zuletzt gespiegelten Server-Objekt** (`raw` im Snapshot), nie auf dem Frontmatter. `PUT` mit `If-Match`; 412 → Re-Sync des Objekts, Kommando mit frischem Stand erneut anbieten; nach Erfolg gezielter Re-Sync, Spiegel folgt. Jedes Kommando: Bestätigung, nie im Intervall-Sync; vorheriges Objekt bleibt im Verlauf → „letzte Änderung zurücknehmen".

**Satz 2a:** Termin verschieben/verlängern · Ort/Online-Link/Titel ändern · Teilnehmer:in hinzufügen/entfernen (Suggester über Kontakt-Notizen oder freie Adresse) · eigene Zu-/Absage (PARTSTAT) · Termin löschen (Notiz bleibt `deleted`) · Kontaktfeld bearbeiten · neuen Termin/Kontakt anlegen (Notiz entsteht *nach* erfolgreichem PUT durch den Spiegel) · „Handänderung auf den Server schreiben" (Diff-Modal).

**Einladungen:** kein Mailversand durch das Plugin. Reihenfolge: Server-Scheduling (RFC 6638, `schedule-outbox-URL` vorhanden) → Server verschickt iTIP · sonst registrierter Mail-Transport (§ 5b) · sonst `.ics` zum Kopieren/Speichern mit ehrlichem Hinweis.

**Stufe 2b (eigene Spec, später):** Sidebar „Heute/Woche", Inline-Buttons im verwalteten Block, Tagesnotiz-Einbettung.

### 5b. Plugin-API (Tool-Calling, Mail-Transport)

`app.plugins.plugins["calendar-notes"].api`, versioniert (`version: 1`), nach dem Anbieter-Muster `vault-rag/src/plugin_api.ts`:
```
events({from,to,calendars?})  contacts({query?})  get(uid)          // lesen
commands(): { id, schema (JSON Schema), description }[]               // Tool-Definitionen für LLMs
plan(commandId, input) → { summary, diff, etag }                       // schreibt nichts
execute(plan) → { ok, uid, etag } | { conflict } | { error }
registerMailTransport(t) / unregisterMailTransport(id)
on("synced"|"changed", cb)
```
Die API öffnet nie ein Modal — Bestätigung liegt beim Aufrufer (Koda bestätigt je Schreibvorgang; eine Crew dürfte nur schema-validiert `plan`+`execute`). Modals sind Formulare über dasselbe `schema`. Mail-Transport: `{ id, label, accounts(), send(imip) }` mit `imip = { method, from, to[], subject, text, ics }` (RFC 6047) — der Versender registriert sich bei uns, wir kennen keine Plugin-ID.

## 6. Tests, Staging, Release

1. **Unit (vitest)** in `core/`: DAV-Parser gegen rohe XML-Antworten (Fixtures je Server-Dialekt: Radicale, Nextcloud, mailbox.org aus `docs/dav/befunde/`), ical/vcard-Roundtrips, `mirror`-Plan (create/update/archive/delete, Feldklassen, Body-Block, RRULE/RECURRENCE-ID), Adoption-Matching, Kommando-Mutationen, 412-Pfad. Obsidian-Mock aus `obsidian-kit/testing`.
2. **Integration gegen Radicale**: `scripts/dav-server.ts` startet Radicale mit Fixture-Ordner (~30 synthetische Einträge: Umlaute, ganztägig, RRULE+EXDATE, vCard 3 und 4, Foto); Discovery → Sync → Kommando → 412 → Rollback. Wegwerfbar, CI-fähig, Ort für destruktive Tests.
3. **GUI-Smoke** (Skill `gui-smoke-setup`, zentrale Brücke `tools/obsidian-cdp/`), Staging-Vault aus `fixtures/vault/` (Pallas-ähnliches Profil **und** generisches Profil). Prüfpunkte: Konto + Discovery, Secret, Trockenlauf, Sync legt Notizen an, Adoption-Modal, ein Kommando mit If-Match. Baseline vor jedem Umbau.
4. **Gegenproben** manuell: Nextcloud-Testaccount (Scheduling, sync-collection), mailbox.org read-only. Schreibtests dort nur in eigens angelegten Test-Sammlungen.

Pallas und 80_Arbeit werden erst nach grünem Smoke angefasst, zuerst im Trockenlauf.

**Release:** Skill `plugin-release-setup`, `npm run lint` = Store-Scanner, Ziel `Passed` mit 0 Warnings. `isDesktopOnly: false`, `minAppVersion: 1.13.x`, `authorUrl: https://github.com/johannes-kaindl`. Registry-Einträge nach Umsetzung: `secretStorage`-Muster (erstes Exemplar), DAV-Client, Mirror-Feldklassen, Kommando-Schema-als-Tool.

**Meilensteine:** M1 DAV-Core + ical/vcard + Radicale-Integration (ohne Obsidian) · M2 Spiegel (Kontakte, Termine), Settings, Secret, Trockenlauf · M3 Adoption + Staging-Vault + GUI-Smoke · M4 Kommandos 2a + API v1 · M5 Release · **M6a** VTODO Server→Vault · **M6b** VTODO Vault→Server (eigene Spec, s. § 7).

## 7. Nicht-Ziele (bewusst)
IMAP/Mail (→ mailstone) · WebDAV-Dateien · bidirektionaler Merge · eigene Verschlüsselung von Zugangsdaten · Kalender-UI in dieser Spec · Instanz-Notizen für Wiederholungen · automatisches Umbenennen/Verschieben von Notizen.

⚠️ **`VTODO/Aufgaben (→ TaskNotes)` stand hier bis zum 2026-09-02 und ist aufgehoben.** Die
Klammer nannte den Zuständigen, wurde aber als Verbot gelesen: *TaskNotes verwaltet Aufgaben*
wurde zu *calendar-notes fasst Aufgaben nicht an*. Die erste Hälfte gilt weiter — das
Zurückschreiben läuft wie bei Terminen über explizite Kommandos, und `api.tasks.*` bleibt
unangetastet. Anlass und Zuschnitt: `2026-09-02-vtodo-aufgaben-design.md`.
