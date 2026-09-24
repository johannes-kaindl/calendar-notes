# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.2.1] — 2026-09-24

### Changed

- `authorUrl` im Manifest zeigt wieder auf das GitHub-Profil.
- Schlüsselbund-Modul aus obsidian-kit 0.35.0 vendored (vorher eigene Kopie); Verhalten unverändert.

## [0.2.0] — 2026-09-05

- **Aufgaben aus dem Kalender werden als Notizen gespiegelt.** Wer seine Aufgaben in Thunderbird, der iOS-Erinnerungen-App oder einem anderen CalDAV-Client führt, findet sie jetzt im Vault wieder — mit Fälligkeit, Status, Priorität und Kategorien im Frontmatter, in der Schreibweise, die TaskNotes erwartet. Ein Knopf in den Einstellungen liest die Statusnamen **aus der TaskNotes-Installation dieses Vaults** aus und trägt sie ins Profil ein; mitgelieferte Vorgaben wären falsch, weil die Namen frei umbenennbar sind. Aufgaben und Termine liegen bei den meisten Anbietern in getrennten Kalendern — das erkennt das Plugin jetzt selbst und weist das passende Profil zu.
- **Aufgaben wandern jetzt in beide Richtungen.** Wer eine Aufgabe im Vault abhakt, verschiebt oder umbenennt, schickt sie mit dem Kommando **„Aufgaben mit dem Server abgleichen"** zurück — und eine Aufgabe, die im Vault entstanden ist, wird dabei auf dem Server angelegt. Das Kommando schreibt nichts von sich aus: es zeigt erst **alle** Unterschiede, gruppiert nach „im Vault geändert", „neu" und „auf beiden Seiten geändert", und fragt je Zeile, welche Seite gewinnt. Vorbelegt ist, was erkennbar gewollt war — abgehakt und neu angelegt gehen mit, ein Konflikt bleibt unangetastet, bis jemand entscheidet. Was sich nicht übertragen lässt, steht **vor** dem Senden an der Zeile, statt hinterher zu fehlen.
- **Eine abgebrochene Aufgabe wird dabei nicht zu einer erledigten umgedeutet.** In TaskNotes tragen „erledigt" und „abgebrochen" oft denselben Status; rückwärts ist daraus nicht zu erkennen, was gemeint war. Das Plugin rät deshalb nicht, sondern lässt den Serverzustand stehen, solange er weiterhin zum Wert in der Notiz passt.
- **Gelöscht wird nichts.** Wer eine Aufgaben-Notiz im Vault löscht, löscht die Notiz — die Aufgabe auf dem Server bleibt. Das ist Absicht: ein versehentlich gelöschter Spiegel darf keine Daten auf dem Server mitnehmen.
- Eine offene Aufgabe wird immer gespiegelt, auch wenn sie gar kein Datum hat — anders als Termine, die nur im eingestellten Zeitfenster erscheinen; erledigte Aufgaben verschwinden, sobald ihr Abschluss aus dem Fenster gelaufen ist.

- **Die Kalender eines Kontos stehen jetzt direkt beim Konto zur Auswahl.** Nach „Verbindung prüfen und Kalender suchen" erscheint dort die Liste des Gefundenen mit je einem Schalter — die Einrichtung ist damit ein Weg: Konto anlegen, prüfen, ankreuzen. Bis dahin waren die gefundenen Kalender ausschließlich unter „Kalender & Adressbücher" zu finden, dort aber eine Ebene tief hinter einer Seite, die den **Konto**namen trägt; beim ersten Kontakt las sich das als „ich habe nur einen Kalender, und der heißt wie mein Anbieter". Der Menüpunkt bleibt und führt weiterhin die Feineinstellung je Kalender (Profil, Ordner, Jetzt abgleichen, Bestehende Notizen verknüpfen). Es ist derselbe Schalter an beiden Orten, kein zweiter Zustand — und die Warnung „diese Sammlung führt keine Termine" steht jetzt schon bei der Auswahl statt erst danach.

## [0.1.9] — 2026-08-29

- **Fix (Abgleich): Eine leere Sammlung brach den Abgleich mit „Antwort ist kein DAV:multistatus" ab.** Ein Kalender ohne Termine antwortet regulär mit einem Wurzelknoten ohne Kinder, und mailbox.org schickt ihn selbstschließend (`<D:multistatus … />`). Der XML-Parser liefert dafür einen leeren *String* statt eines leeren Objekts — die Prüfung hielt das für „gar kein Multistatus" und meldete einen Protokollfehler. Betroffen war damit **jeder leere Kalender und jedes frisch angelegte Adressbuch**, also gerade der Zustand beim ersten Einrichten. Jetzt ist nur noch ein **fehlender** Wurzelknoten ein Fehler; ein leerer bedeutet schlicht „keine Einträge". Gegen mailbox.org verifiziert: sechs Sammlungen, kein Fehler.
- **Fehlermeldungen des DAV-Parsers nennen jetzt die Anfrage und den Antwortanfang.** Vorher lautete die Meldung an sieben verschiedenen Aufrufstellen gleich, ohne zu sagen, welche Anfrage gescheitert war oder was der Server stattdessen geschickt hat — der Fehler war aus ihr heraus nicht eingrenzbar. Genau daran ist die Ursachensuche oben zuerst gescheitert.
- **Die Einstellungen erklären sich jetzt selbst.** Jede Zeile sagt, was sie bewirkt — bis dahin standen dort Wörter aus dem DAV-Protokoll ohne Auflösung („Sammlung", „Profil", „Ordner-Override", „Trockenlauf"), und wer CalDAV nicht kennt, hatte keinen Einstiegspunkt. Konkret: „Sammlungen" heißt **„Kalender & Adressbücher"**, und die Seite darunter trägt jetzt den Kontonamen **samt Anzahl** („mailbox.org — 6 gefunden") statt nur den Kontonamen — vorher sah es aus, als gäbe es genau eine Sammlung, die so heißt wie der Anbieter. **„Profil aus der geöffneten Notiz erzeugen"** ist eine beschriftete Zeile mit Erklärung geworden statt eines unbeschrifteten Zauberstab-Icons, dessen Bedeutung nur im Tooltip stand (auf Mobilgeräten also nirgends) — es ist der zentrale Einrichtungsschritt und war praktisch unauffindbar. Die Sprachwahl steht nicht mehr unter „Synchronisation", sondern unter „Darstellung"; sie bleibt, weil sie gebraucht wird, wenn man Obsidian in einer anderen Sprache bedient, als man das Plugin lesen will.
- Fix: Der Hinweis an Sammlungen ohne Termine war grammatisch bezuglos („Sie wird nicht gespiegelt; es wäre nichts zu finden") und nannte den Gegenstand nicht. Neu formuliert.
- Fix (still, aber ernst): Eine Einstellungs-**Liste** zählt ihre Lösch-Funktion über den Index in der Zeilenliste. Eine Erklärzeile darin hätte beim Löschen das **falsche Konto** getroffen. Erklärungen stehen jetzt neben der Liste statt darin, abgesichert durch einen Test, der jede Liste mit Lösch-Funktion darauf prüft.

## [0.1.8] — 2026-08-29

- **Fix (Sammlungen): Eine Aufgaben-Sammlung sah aus wie ein Kalender und wurde still nicht gespiegelt.** Server können `VEVENT` und `VTODO` in **getrennten** Sammlungen führen (bei mailbox.org ist das der Normalfall) — beide melden `<c:calendar/>` als Ressourcentyp, aber nur die eine nimmt Termine an. Welche das ist, sagt `supported-calendar-component-set`; das Plugin erhob die Eigenschaft zwar bei der Discovery, ließ sie danach aber fallen. Wer die Aufgaben-Sammlung aktivierte, bekam einen Lauf ohne Ergebnis und keinen Hinweis warum. Der Wert wird jetzt bis in die Einstellungen durchgereicht, eine Sammlung ohne `VEVENT` wird beim Sync mit `unsupported-components` übersprungen, und die Zeile in den Einstellungen sagt es. Sagt der Server nichts (Radicale etwa liefert die Eigenschaft nicht zwingend), ändert sich nichts — es wird nichts angenommen.

## [0.1.7] — 2026-08-25

- **Fix (Discovery): 405 gegen Nextcloud — die Startadresse wurde aus der Anfrage-URL geraten statt aus der Antwort gelesen.** `wellKnown()` war darauf gebaut, den Redirect von `/.well-known/caldav` selbst zu sehen. Obsidians `requestUrl` folgt Weiterleitungen aber selbst (und behält die Methode), also kam dort direkt ein `207` an — der 301-Zweig war toter Code, und der 207-Zweig gab die **angefragte** Adresse plus Schrägstrich zurück (`/.well-known/caldav/`). Bei Nextcloud ist das eine andere Route: sie leitet auf `/index.php/.well-known/caldav/` weiter und antwortet dort mit **405**. Die richtige Adresse steht längst in der Antwort — das `<d:href>` des Multistatus nennt die Ressource, die der Server tatsächlich beantwortet hat; genau die wird jetzt genommen. Gegen die echte Nextcloud verifiziert: 16 Sammlungen, keine Warnungen.

## [0.1.6] — 2026-08-25

- **Fix (Auth): Die Reparatur aus 0.1.5 griff im Normalfall nicht.** Sie erkannte nur Konten, deren Schlüsselbund-Eintrag die eigene ID als Wert trug — entstanden ist der Schaden aber fast immer anders: unter der plugin-eigenen ID lag der **Name des Eintrags, den der Nutzer im Dialog vergeben hat**. Genau das ist jetzt die Erkennungssignatur (der Wert ist selbst ein vorhandener Eintrag), und der Fall ist verlustfrei: das Konto wird auf diesen Eintrag umgehängt, das Passwort muss nicht neu ausgewählt werden. `repairSelfReferencingSecrets()` heißt deshalb jetzt `repairSecretLinks()`.

## [0.1.5] — 2026-08-25

- **Fix (Auth): Kein Konto konnte sich anmelden — jeder Server antwortete 401.** Die Passwort-Zeile in den Einstellungen benutzt Obsidians `SecretComponent`, und die ist ein *Verweis* auf einen Schlüsselbund-Eintrag, kein Passwortfeld: ihr `onChange` liefert die **ID** des gewählten bzw. neu angelegten Eintrags zurück, nicht dessen Wert. Das Plugin speicherte diese ID als Passwort-Wert und meldete sich fortan mit dem *Namen* des Eintrags an. Das Konto merkt sich jetzt die ID (`account.secretId`), und den Wert verwaltet allein Obsidian. Betroffene Konten repariert `repairSelfReferencingSecrets()` beim Start automatisch: Sie gelten wieder als unverknüpft, der unbrauchbare Eintrag wird geleert — **das echte Passwort bleibt unter der selbst vergebenen ID erhalten und muss nur neu ausgewählt werden.**
- Fix: Das X an der Passwort-Zeile (Verknüpfung lösen) rief den Rückruf mit `null` auf und lief in einen Fehler statt die Verknüpfung zu lösen.
- Beim Löschen eines Kontos wird der Schlüsselbund-Eintrag nicht mehr überschrieben — im Verweis-Modell gehört er dem Nutzer und darf von einem zweiten Konto genutzt werden.

## [0.1.4] — 2026-08-25

- Fix: Ein per Zwischenablage kopiertes DAV-Passwort mit abschließendem Zeilenumbruch (z. B. `pbcopy < datei`) landete unverändert im Schlüsselbund und führte trotz korrekten Passworts zu 401 beim Sync. `stripCrLf()` entfernt führende/abschließende `\r`/`\n` jetzt beim Speichern in beiden `SecretStore`-Implementierungen, ohne sonstige Whitespaces im Passwort anzutasten.

## [0.1.3] — 2026-08-23

- `fast-xml-parser` 4.5.7 → 5.11.0: der Store-Gate-Scan meldet jede Version <5.7.0 (GHSA-gh4j-gqv2-49f6, betrifft nur den nicht genutzten `XMLBuilder`) als Warning — Bereichs-, nicht Codepfad-Urteil. Parser-Nutzung unverändert, alle Tests grün.
## [0.1.2] — 2026-08-23

- Plugin-Name `Calendar & Contact Notes` → **`Calendar and Contact Notes`**: das Developer Dashboard lehnt `&` ab (Manifest-Regel: keine Satzzeichen außer Bindestrich, Plus und Klammern — docs.obsidian.md/Reference/Manifest#name); `eslint-plugin-obsidianmd` prüft das nicht, der Fund kam erst bei der Store-Registrierung.
## [0.1.1] — 2026-08-23

- CI-Gate: `tsconfig.test.json` zieht `scripts/` nicht mehr mit — die Treiber importieren die zentrale CDP-Brücke aus dem Dach, die im GitHub-Checkout fehlt; `typecheck:scripts` (mit Existenz-Guard) deckt sie weiterhin ab. 0.1.0 scheiterte genau daran in der Release-Action (kein GitHub-Release, nie im Store) — 0.1.1 ist der erste veröffentlichte Stand.
## [0.1.0] — 2026-08-23

- M1: obsidian-freier DAV-Kern — Discovery (well-known → principal → home-sets), Collection-Sync (sync-collection mit Fallback auf ctag/etag-Diff), Multiget, Objekt-Client mit If-Match/412; VEVENT- und vCard-Parser/Mutationen auf ical.js; Radicale-Integrationstest (`npm run test:integration`).
- M2a: obsidian-freier Mirror-Kern — Mapping-Profile, verwaltete Werte + Attendee-Wikilinks, Body-Block-Verwaltung, Dateiname (Kit-Template) + Hash, Zeitfenster + Wiederholungs-Queries; Plan-Typen create/update/skip/archive/delete; Collection-State-Tracking mit Snapshot/Verlauf.
- M2b: Obsidian-Schicht — Settings-Modell (Konten + Secrets im Schlüsselbund), Transport/State/Secrets-Adapter, SyncService mit injizierten Interfaces (vitest mit Fakes vollständig getestet), Settings-Tab (Discovery, Profil-Management, Sync-Optionen), Vorschau-Modal, Kommandos (sync-all/sync-preview/sync-collection), Start-/Intervall-Trigger.
- M3: Adoptions-Ablauf (bestehende Notizen mit Server-Einträgen verknüpfen via Modal nach Matching-Review), Profil-Ableitung aus Frontmatter-Vorlage, Staging-Vault-Fixture, automatisierter GUI-Smoke mit Baseline.
- M5 (Nachtrag 2026-08-23): README-Bilder aufgenommen (`npm run shots`, 5 Bilder, Vertrag `docs/images/README.md`); Vorschau-Modal zeigt Sammlungs-**Namen** statt interner IDs.
- M4: Explizite Kommandos (verschieben, Felder ändern, Teilnehmer add/remove, Zu-/Absage, löschen, anlegen, Kontaktfelder, Handänderungen auf den Server schreiben) mit `If-Match`/412-Konfliktpfad + gezieltem Re-Sync, „Letzte Änderung zurücknehmen" aus dem Verlauf (`undo.last`, regulärer Registry-Eintrag), Einladungs-Weg Server-Scheduling → Mail-Transport → `.ics` (Route erst „transport", wenn ein registrierter Transport auch mindestens eine Absender-Identität hat), Plugin-API v1 (`app.plugins.plugins["calendar-notes"].api`: lesen, Kommandos planen/ausführen — mit Schema-Validierung der Eingabe —, `registerMailTransport`, `on`) — `docs/API.md`. Kommando-Registry wird beim Laden befüllt (`ensureDefaultCommands()`, idempotent). GUI-Smoke erweitert um P10–P13 (Kommando via API, Einladung ohne Scheduling/Transport, Undo, API-Lesen) — generic 12/12, pallas 4/4.
- M5: i18n-Abschluss der Kommandotitel/-zusammenfassungen (`titleKey`/`descriptionKey`/`summaryKey`), README de/en mit Aufnahme-Rezept (`scripts/shots.ts`), Release-Infrastruktur nach Dach-Standard (`release.yml`, `versions.json`, `LICENSE`/`LICENSING.md`/`THIRD-PARTY.md`, `docs/AUDIT.md`), Store-Vorbereitung (`docs/STORE.md` Scorecard-Vorschau, `docs/RELEASE.md` Maintainer-Handover für Remotes + Erst-Release + Developer-Dashboard/Rescan).
