# Calendar and Contact Notes

> [🇬🇧 English](README.md) · 🇩🇪 Deutsch

**Spiegelt CalDAV-Termine, CalDAV-Aufgaben und CardDAV-Kontakte als Notizen im Vault — der
Server bleibt die Wahrheit, und jede Änderung zurück auf den Server läuft über ein explizites
Kommando.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
![Obsidian](https://img.shields.io/badge/obsidian-1.13.0%2B%20·%20desktop%20%26%20mobile-7c3aed)

<p align="center"><img src="https://git.jkaindl.de/jkaindl/calendar-notes/raw/branch/main/docs/images/event-note.png" width="820" alt="Eine gespiegelte Termin-Notiz im Lesemodus: Frontmatter mit type, dav_uid, dav_source, dav_etag, dav_state, title, start, end, all_day, online und rrule"></p>

Kalender, Aufgaben und Kontakte liegen normalerweise auf einem Server, den man aus Obsidian
heraus nie sieht — nicht verlinkbar, nicht auswertbar, nicht Teil des Vaults. Dieses Plugin
spiegelt CalDAV-Kalender und CardDAV-Adressbücher als Markdown-Notizen, eine Notiz je Termin,
Aufgabe oder Kontakt, im Intervall synchronisiert. Der Spiegel ist per Konvention nur lesend: Frontmatter
von Hand ändern schreibt nicht auf den Server zurück. Änderungen laufen ausschließlich über
explizite Kommandos — einen Termin verschieben, eine Telefonnummer ändern, eine:n Teilnehmer:in
hinzufügen — jedes mit einer Diff-Vorschau, bevor irgendetwas gesendet wird.

## Was es tut

- **Lesen automatisch, schreiben nur bewusst.** Der Stand des Servers wird automatisch zu
  Notizen; die Notizen ändern den Server nur über ein Kommando, das man selbst ausführt und
  bestätigt.
- **Auch Aufgaben — vom Kalender-Server in den Vault.** Wer seine Aufgaben in Thunderbird, der
  iOS-Erinnerungen-App oder einem anderen CalDAV-Client führt, findet sie als Notizen wieder —
  mit Fälligkeit, Status, Priorität und Kategorien im Frontmatter, in der Schreibweise, die
  [TaskNotes](https://github.com/callumalpass/tasknotes) erwartet. Ein Knopf in den
  Einstellungen liest die Statusnamen **aus der TaskNotes-Installation dieses Vaults** aus und
  trägt sie ins Profil ein; mitgelieferte Vorgaben wären falsch, weil die Namen frei
  umbenennbar sind. Aufgaben und Termine liegen bei den meisten Anbietern in getrennten
  Kalendern — das erkennt das Plugin selbst und weist das passende Profil zu. **Dieser Weg ist
  vorerst eine Einbahnstraße** (Server → Vault): Änderungen an einer Aufgaben-Notiz werden noch
  nicht zurückgeschrieben, und aus dem Vault heraus lässt sich keine Aufgabe anlegen. Eine
  offene Aufgabe wird immer gespiegelt, auch ohne Datum — anders als Termine, die nur im
  eingestellten Zeitfenster erscheinen.
- **CalDAV und CardDAV in einem Plugin**, ein gemeinsamer Transport, server-agnostische
  Discovery (RFC 4791/6352/6578) — getestet gegen [Radicale](https://radicale.org), entworfen
  nach denselben Standards wie mailbox.org und Nextcloud (gegen keinen der beiden bisher live
  verifiziert).
- **Ein verwalteter Block, keine verwaltete Notiz.** Frontmatter-Felder und ein
  `%%dav:begin%%…%%dav:end%%`-Body-Block werden synchron gehalten; alles andere in der Notiz —
  eigene Notizen, Links, was auch immer ergänzt wird — überlebt jeden Sync unangetastet.
- **Bestehende Notizen übernehmen statt duplizieren.** Zeigt das Plugin auf einen Ordner mit
  bereits vorhandenen Kontakt- oder Termin-Notizen — migriert aus einem anderen System, von
  Hand geschrieben —, schlägt es Zuordnungen vor (E-Mail/Telefon exakt, Name/Titel fuzzy) mit
  einer Konfidenzstufe, sodass verknüpft statt dupliziert wird.
- **Explizite Kommandos zum Schreiben**, kein Freitext-Editieren: einen Termin verschieben/
  verlängern, Ort oder Teilnehmer:in ändern, ein Kontaktfeld bearbeiten, die letzte Änderung
  zurücknehmen — jedes öffnet ein kleines Formular, zeigt eine Diff-Vorschau und schreibt erst
  nach Bestätigung.
- **Eine Lese-/Schreib-API für andere Plugins**
  (`app.plugins.plugins["calendar-notes"].api`, versioniert) — Termine/Kontakte als Daten,
  Kommandos als LLM-Tool-Definitionen, ein `plan()`→`execute()`-Schritt für alles Schreibende.
  Siehe [`docs/API.md`](docs/API.md).
- **Kein eingebauter Mailversand.** Eine Einladung geht über das eigene Scheduling des Servers
  (RFC 6638), falls vorhanden, sonst über ein Mail-Plugin, das sich bei `calendar-notes`
  registriert, sonst als `.ics`-Datei zum Kopieren oder Speichern.

## Voraussetzungen

- **Obsidian 1.13.0 oder neuer**, Desktop oder Mobil (`isDesktopOnly` ist nicht gesetzt).
- **Ein per HTTPS erreichbarer CalDAV-/CardDAV-Server** mit Basic Auth — mailbox.org oder
  Nextcloud sind die vorgesehenen Ziele; getestet ist das Plugin Ende-zu-Ende gegen
  [Radicale](https://radicale.org) und folgt denselben Standards (RFC 4791/6352/6578), die
  auch die beiden anderen Server implementieren — live verifiziert ist das bei keinem der
  beiden bisher. Eine Abweichung gerne als Issue melden.
- Sonst nichts. Keine Telemetrie, kein Fremddienst außer dem konfigurierten DAV-Server und,
  falls genutzt, dem selbst registrierten Mail-Transport.

## Installation

Repository: [git.jkaindl.de/jkaindl/calendar-notes](https://git.jkaindl.de/jkaindl/calendar-notes)

> **Hinweis (2026-09-04):** Calendar and Contact Notes ist derzeit **nicht im
> Community-Plugin-Browser gelistet**. Das GitHub-Konto, auf dem der Mirror lag, ist nicht
> verfügbar, und damit entfiel auch der Store-Eintrag. Das Plugin selbst ist davon unberührt
> und wird weiter gepflegt — die Releases erscheinen auf Forgejo, und die Wege unten
> funktionieren heute.

### Mit dem AnySource Sideloader (empfohlen)

Der [AnySource Sideloader](https://git.jkaindl.de/jkaindl/anysource-sideloader) installiert und
aktualisiert Plugins aus beliebigen Git-Forges, unabhängig vom Community Store.

1. AnySource Sideloader installieren und aktivieren. (Seine eigene Erstinstallation ist manuell
   — unabhängig vom Store zu sein ist ja der Punkt —, aber sie fällt nur einmal an; danach hält
   er sich und alles andere selbst aktuell.)
2. Dieses Repository als Quelle eintragen:
   `https://git.jkaindl.de/jkaindl/calendar-notes`
3. **Calendar and Contact Notes** installieren und aktivieren.

Updates kommen danach wie bei jedem anderen Plugin.

### Manuelle Installation

`main.js`, `manifest.json` und `styles.css` aus dem
[letzten Forgejo-Release](https://git.jkaindl.de/jkaindl/calendar-notes/releases/latest)
herunterladen und in den Vault kopieren. Ab 0.1.10 liegt jedem Release zusätzlich
`checksums.sha256` bei — damit lässt sich das Heruntergeladene mit
`shasum -a 256 -c checksums.sha256` prüfen.

```bash
cp main.js manifest.json styles.css "<dein-vault>/.obsidian/plugins/calendar-notes/"
```

Danach: Obsidian → **Einstellungen → Community-Plugins → neu laden** → **Calendar and Contact
Notes** aktivieren.

### Über den Community-Plugin-Browser

Wieder verfügbar, sobald der Store-Eintrag zurück ist: **Einstellungen → Community-Plugins →
Durchsuchen**, nach **Calendar and Contact Notes** suchen, installieren und aktivieren.

### Aus dem Quelltext

```bash
git clone https://git.jkaindl.de/jkaindl/calendar-notes
cd calendar-notes && npm install && npm run build
# main.js manifest.json styles.css → <vault>/.obsidian/plugins/calendar-notes/
```

## Verwendung

### Einrichtung: Konto → Discovery → Sammlungen → Profil

<img src="https://git.jkaindl.de/jkaindl/calendar-notes/raw/branch/main/docs/images/preview.png" width="584" alt="Das Vorschau-Modal nach dem Trockenlauf: Kalender 3 neu, Kontakte 2 neu, noch nichts geschrieben — Schließen oder Jetzt ausführen">

1. **Einstellungen → Calendar and Contact Notes → Konten → Konto hinzufügen.** Name,
   Server-Basis-URL und Benutzername eintragen, dann **Verbindung testen & Sammlungen
   finden**. Das Passwort landet im eigenen Schlüsselbund von Obsidian — siehe
   [Sicherheit](#sicherheit--datenschutz).
2. Eine erfolgreiche Discovery trägt jeden vom Server gemeldeten Kalender und jedes
   Adressbuch unter **Sammlungen** ein, jeweils mit einem **Spiegeln**-Schalter (standardmäßig
   aus) und einem **Profil**-Dropdown. Die gewünschten Sammlungen einschalten.
3. Jede Sammlung nutzt ein **Zuordnungsprofil** — welche Frontmatter-Felder geschrieben
   werden, welcher Ordner, welches Dateinamensmuster. Zwei Standardprofile sind vorhanden
   (`Contacts (default)`, `Events (default)`, schreiben nach `Contacts/`/`Events/`); unter
   **Profile** lässt sich eines als JSON bearbeiten, im-/exportieren, oder aus einer
   bestehenden Notiz ableiten (**Zuordnungsprofil aus aktueller Notiz erzeugen**) — praktisch,
   wenn der Vault bereits eine eigene Kontakt-/Termin-Struktur hat.
4. **Alle Sammlungen synchronisieren** ausführen (oder das Intervall abwarten), um die erste
   Charge Notizen zu holen. **Synchronisation als Vorschau (Trockenlauf)** zeigt jederzeit, was
   passieren würde — Neu/Aktualisiert/Archiviert/Gelöscht je Sammlung —, ohne etwas zu
   schreiben.

### Adoption: bestehende Notizen verknüpfen statt duplizieren

<img src="https://git.jkaindl.de/jkaindl/calendar-notes/raw/branch/main/docs/images/adoption.png" width="584" alt="Das Adoptions-Modal schlägt vor, die bestehende Notiz 2026-09-01 Zahnärztin mit dem Server-Eintrag Zahnärztin Dr. Müller zu verknüpfen (start+title, likely 0,75) — mit Alle sicheren übernehmen, Abbrechen und Verknüpfen">

Liegen im Zielordner einer Sammlung bereits Notizen — aus einem anderen System migriert, von
Hand geschrieben —, **Bestehende Notizen verknüpfen…** ausführen (oder den Button neben der
Sammlung). Das Plugin schlägt Zuordnungen zwischen Server-Einträgen und eigenen Notizen vor
(E-Mail/Telefon exakt, Name/Titel fuzzy) in drei Konfidenzstufen — `sure` und `likely`
verknüpfen standardmäßig, `weak` bleibt zur Bestätigung offen — in einer Tabelle, die sich
zeilenweise übersteuern lässt, bevor irgendetwas geschrieben wird. Verknüpfte Notizen bekommen
ihre `dav_uid`/`dav_source`-Felder gesetzt und werden ab dem nächsten Sync aktualisiert statt
ein Duplikat zu erzeugen.

### Kommandos

<a href="https://git.jkaindl.de/jkaindl/calendar-notes/raw/branch/main/docs/images/command-form.png"><img src="https://git.jkaindl.de/jkaindl/calendar-notes/raw/branch/main/docs/images/thumbs/command-form.png" width="380" alt="Das aus dem Schema erzeugte Formular „Termin anlegen“: Titel, Start, Ende, Ganztägig, Ort, Beschreibung und URL — geschrieben wird erst mit Speichern"></a><br><sub>Vorschau anklicken für volle Größe</sub>

Die mittlere Spalte ist, was in der Befehlspalette getippt wird.

| Kommando | In der Befehlspalette | Was es tut |
|---|---|---|
| Alles synchronisieren | `Alle Sammlungen synchronisieren` | Echter Sync-Lauf über alle aktivierten Sammlungen |
| Vorschau | `Synchronisation als Vorschau (Trockenlauf)` | Zeigt geplante Operationen, ohne zu schreiben |
| Eine Sammlung synchronisieren | `Eine Sammlung synchronisieren…` | Wählt eine einzelne Sammlung zum Synchronisieren |
| Bestehende Notizen verknüpfen | `Bestehende Notizen verknüpfen…` | Öffnet die Adoptions-Übersicht für eine Sammlung |
| Profil aus Notiz | `Zuordnungsprofil aus aktueller Notiz erzeugen` | Leitet ein Zuordnungsprofil aus dem Frontmatter der aktiven Notiz ab |
| Termin/Kontakt ändern | `Termin/Kontakt ändern…` | Schlägt anwendbare Kommandos für die aktive Notiz vor, öffnet ein Formular, zeigt eine Diff-Vorschau |
| Neuer Termin | `Neuer Termin…` | Legt einen Termin auf dem Server an (und seine Notiz) über ein Formular |
| Neuer Kontakt | `Neuer Kontakt…` | Legt einen Kontakt auf dem Server an (und seine Notiz) über ein Formular |
| Rückgängig | `Letzte Änderung rückgängig machen` | Nimmt die letzte protokollierte Änderung des Ziels zurück |
| Handänderungen übertragen | `Handänderungen auf den Server übertragen` | Vergleicht manuelle Frontmatter-Änderungen mit dem Server und bietet an, sie zu schreiben |

### Konfiguration

<a href="https://git.jkaindl.de/jkaindl/calendar-notes/raw/branch/main/docs/images/settings.png"><img src="https://git.jkaindl.de/jkaindl/calendar-notes/raw/branch/main/docs/images/thumbs/settings.png" width="380" alt="Der Einstellungen-Tab mit einem Konto (Name, Server-URL, Benutzername, Passwort auf diesem Gerät hinterlegt) und der gefundenen Sammlungsgruppe mit je einem Schalter für Kalender, Aufgaben und Kontakte"></a><br><sub>Vorschau anklicken für volle Größe</sub>

| Einstellung | Was sie tut | Standard |
|---|---|---|
| Konten | Server-URL, Benutzername; Passwort im Schlüsselbund von Obsidian | — |
| Sammlungen → Spiegeln | Ob ein gefundener Kalender/Adressbuch synchronisiert wird | aus |
| Sammlungen → Profil | Welches Zuordnungsprofil eine Sammlung nutzt | das passende Standardprofil |
| Sammlungen → Ordner-Override | Überschreibt den Ordner des Profils nur für diese Sammlung | Ordner des Profils |
| Intervall (Desktop) | Minuten zwischen automatischen Syncs | 15 |
| Intervall (Mobil) | Minuten zwischen automatischen Syncs auf Mobilgeräten | 60 |
| Tage zurück | Wie weit rückwirkend Termine gespiegelt werden (ältere werden archiviert, nicht gelöscht) | 90 |
| Tage voraus | Wie weit vorausschauend Termine gespiegelt werden | 365 |
| Startverzögerung | Sekunden nach dem Laden von Obsidian bis zum ersten Sync | 10 |
| Sprache | UI-Sprache: Automatisch (folgt Obsidian), Englisch, Deutsch | Automatisch |

## Wie es denkt

**Der Server ist die Wahrheit, die Notiz ist ein Spiegel.** Jeder Sync holt den aktuellen
Server-Stand — per Sync-Token oder ctag/etag-Vergleich, je nachdem, was der Server
unterstützt — und macht daraus einen Plan: eine Notiz anlegen, ihre verwalteten Felder
aktualisieren, sie archivieren (aus dem Sync-Fenster gefallen) oder sie in Obsidians Papierkorb
schicken (auf dem Server gelöscht — außer die Notiz trägt Backlinks oder eigenen Inhalt, dann
wird sie stattdessen `dav_state: deleted` markiert, damit nichts Geschriebenes stillschweigend
verloren geht). **Frontmatter von Hand ändern schreibt nicht auf den Server** — es gibt keinen
Merge, in keine Richtung, außerhalb eines expliziten Kommandos.

Schreiben läuft bewusst schmal in die andere Richtung: ein **Kommando** nimmt das zuletzt
gespiegelte Server-Objekt, wendet eine Mutation an (Datum verschieben, Feld ändern,
Teilnehmer:in hinzufügen) und sendet ein `PUT` mit `If-Match: <etag>`. Eine widersprüchliche
Server-Änderung (412) wird als „mit frischem Stand erneut versuchen" angezeigt, nie
stillschweigend überschrieben. Jedes Kommando zeigt seine Diff-Vorschau, bevor es läuft, und
der vorherige Stand bleibt in einem Verlauf je Objekt — **Letzte Änderung rückgängig machen**
nimmt sie zurück. Deshalb erreicht Frontmatter von Hand nie den Server: ein Spiegel, der sich
per Text-Editieren zurückschreiben ließe, bräuchte einen bidirektionalen Merge, und den hat
dieses Plugin bewusst nicht (siehe [Grenzen](#grenzen)).

## Plugin-API

Andere Plugins können Termine/Kontakte lesen, die Kommandos des Plugins als LLM-Tool-
Definitionen bekommen und über denselben `plan()`→`execute()`-Schritt schreiben, den auch die
Oberfläche nutzt — nie an der Diff-Vorschau vorbei, und die API selbst öffnet nie ein Modal
(Bestätigung ist Sache des Aufrufers). Vollständige Referenz, Versionierungsregeln und ein
Mail-Transport-Vertrag: [`docs/API.md`](docs/API.md).

## Sicherheit & Datenschutz

- **Passwörter liegen im eigenen Schlüsselbund von Obsidian, pro Gerät.** Sie stehen nicht in
  Notizen, nicht in der Einstellungsdatei und werden nicht mit dem Vault synchronisiert — ein
  zweites Gerät braucht sein eigenes, einmal eingegebenes Passwort.
- **Kein Mailversand durch dieses Plugin.** Eine Einladung läuft über das eigene Scheduling
  des Servers, falls vorhanden, sonst über ein explizit registriertes Mail-Plugin, sonst gibt
  es eine `.ics`-Datei zum selbst Verschicken.
- **Keine Telemetrie, keine Analyse, kein Fremddienst.** Der einzige Netzwerkverkehr geht an
  den/die konfigurierten DAV-Server und, falls genutzt, den registrierten Mail-Transport.

## Grenzen

- **Kein bidirektionaler Merge.** Der Server ist die Wahrheit; das Frontmatter einer Notiz ist
  aus Sicht des Plugins nur lesend, außerhalb eines expliziten Kommandos (**Handänderungen auf
  den Server übertragen** ist die eine bewusste Ausnahme — eine geprüfte und bestätigte
  Diff-Vorschau, kein stiller Merge).
- **Aufgaben werden nur in eine Richtung gespiegelt** (Server → Vault). Änderungen an einer
  Aufgaben-Notiz werden nicht zurückgeschrieben, und ein Kommando zum Anlegen aus dem Vault
  gibt es noch nicht. Das Lesen ist vollständig: Fälligkeit, Status, Priorität und Kategorien
  kommen alle an.
- **Wiederholende Termine sind eine Notiz je Master**, nicht eine je Vorkommen. Eine
  serverseitige Ausnahme für ein einzelnes Vorkommen bekommt eine eigene Notiz, verlinkt mit
  dem Master.
- **Auf Mobilgeräten ist das Passwort pro Gerät** — es gibt bewusst keine geräteübergreifende
  Zugangsdaten-Synchronisation (siehe [Sicherheit](#sicherheit--datenschutz)).
- **Kalender synchronisieren innerhalb eines Zeitfensters** (standardmäßig 90 Tage zurück /
  365 Tage voraus); Termine außerhalb werden archiviert, nicht gelöscht, und tauchen bei einem
  breiteren Fenster wieder auf.
- **Gegen mailbox.org oder Nextcloud noch nicht live verifiziert** — das Plugin folgt denselben
  Standards, die diese Server implementieren, und ist Ende-zu-Ende gegen Radicale getestet;
  eine Abweichung live gerne als Issue melden.

## Entwicklung

```bash
npm install
npm run gate    # Lint + Typecheck + Unit-Tests + Build — der volle Pre-Commit-Check
npm test        # nur Unit-Tests
npm run test:integration   # startet ein wegwerfbares Radicale per uvx, fährt Integrationstests
```

Architektur, Meilenstein-Stand und der manuelle Smoke-Ablauf: [`AGENTS.md`](AGENTS.md).
GUI-Smoke-Checkliste (läuft gegen ein laufendes Obsidian per CDP):
[`docs/SMOKE.md`](docs/SMOKE.md).

## Lizenz

- **Code:** AGPL-3.0-or-later ([`LICENSE`](LICENSE)).
- **Fremdcode:** [`ical.js`](https://github.com/kewisch/ical.js) (MPL-2.0, iCalendar-/
  vCard-Parsing), [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser)
  (MIT, WebDAV-Multistatus-Parsing).
- Vollständige Drittlizenz-Hinweise: [`THIRD-PARTY.md`](THIRD-PARTY.md). Eine kommerzielle
  Lizenz ist auf Anfrage erhältlich, falls das AGPL-3.0-Copyleft nicht passt:
  [`LICENSING.md`](LICENSING.md).

Copyright © 2026 Johannes Kaindl.
