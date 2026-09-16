# Aufnahme-Vertrag — README-Bilder

Dieser Ordner soll die Bilder halten, die `README.md` und `README.de.md` einbetten. Diese
Datei ist der **Vertrag** dafür: welche Bilder es geben soll, was jedes zeigen muss, in
welcher Klasse es steht — und wie man sie reproduzierbar aufnimmt. Aufnahme über
`scripts/shots.ts` (`npm run shots`), Prüfung über `readme_lint.py`
(`npm run shots:check`).

## Status

**Aufnahme gefahren am 2026-08-23** (`npm run shots`, fünf Bilder, `npm run shots:check` ohne
Befund). Beide READMEs binden die Bilder per absoluter GitHub-Raw-URL ein
(`raw.githubusercontent.com/johannes-kaindl/calendar-notes/main/docs/images/…`) — die URL
trägt erst, sobald das GitHub-Remote existiert (Handover „Erst-Release"); bis dahin sind die
Bilder lokal unter `docs/images/` vorhanden.

Was die erste Aufnahme gelehrt hat (beides im Rezept verdrahtet): Discovery + aktivierte
Sammlungen sind Voraussetzung für vier der fünf Bilder, und der deklarative Settings-Tab
zeigt den Stand des letzten `update()` — wer `plugin.settings` am Tab vorbei setzt, muss
`settingTab.update()` nachziehen. Zwischen den Bildern schließt das Rezept offene Modals. Modals werden bei 584 CSS-px
Breite aufgenommen und deshalb mit `width="584"` eingebettet (`image-scale`).

## Voraussetzung für den Lauf

⚠️ **Vor dem Quit koordinieren — Obsidian ist geteilte Infrastruktur.** Dieses Rezept
braucht den frischen Start (ein Bild pro Start, jeder Lauf hinterlässt Zustand); Mitnutzen ist
hier keine Alternative. Aber Obsidian ist Single-Instance: der Quit trifft die Instanz, an der
möglicherweise eine andere Session arbeitet, und zerstört deren Zustand. Der eigene Lauf ist
danach sauber grün; der Schaden fällt nicht auf.

```bash
lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
```

Hört der Port, hängt jemand dran: **erst fragen, dann quitten.** ⚠️ Und die Prüfung ersetzt die
Frage nicht — sie zeigt aktive CDP-Treiber, aber nicht, wer ein Fenster offen hält oder auf den
Port wartet; am 2026-08-30 hätte sie einen zwei Stunden alten Reindex nicht gezeigt, denn der
hing an Ollama, nicht am Port.

```bash
# STAGING_VAULTS_DIR steht in ~/.zshenv (Ort: obsidian-plugins/AGENTS.md § Staging-Vaults).
# Hier bewusst KEIN Beispielwert: ein Beispielort in der Doku ist ein zweiter Ort.
npm run build && OBSIDIAN_PLUGIN_DIR="$STAGING_VAULTS_DIR/calendar-notes/.obsidian/plugins/calendar-notes" npm run deploy
npm run shots -- --setup                            # baut den Vault aus fixtures/vault neu

osascript -e 'quit app "Obsidian"'
open -a Obsidian --args --remote-debugging-port=9222
#   … den Aufnahme-Vault öffnen und einmalig als vertrauenswürdig bestätigen …

npm run shots                                        # nimmt alle fünf Bilder auf
npm run shots:check                                  # gleicht Vertrag ↔ Dateien ↔ README ab
```

Der Treiber startet für die Dauer des Laufs sein eigenes Radicale (Port 5299, getrennt von
`scripts/dav-server.ts`s Standardport 5232 und dem GUI-Smoke-Port 5298, damit kein
parallel laufender Server kollidiert) und stoppt es im `finally`. Fixture-Quelle ist
`fixtures/vault/` — dasselbe Vault, das auch `scripts/gui-smoke.ts --setup` baut (s. dort
„README-Screenshots" im Verwendungs-Abschnitt).

## Konventionen

Verbindlich ist der workspace-weite Bild-Standard in `_docs/readme/readme-spec.json`
(`images`-Block). Kurzfassung:

| Klasse | Einbettung | Grenze |
|---|---|---|
| `hero` | `width="820"`, zentriert, direkt nach den Badges | Querformat (H ≤ B) |
| `feature` | `width="820"` | H/B ≤ 1.6 |
| `detail` | Vorschaubild `width="380"`, verlinkt auf die Vollauflösung | keine Höhengrenze |

Aufnahme bei 1200 px Breite, Thumbs 380 px unter `thumbs/`. Einbettung ausschließlich per
`<img width="…">` (nie `![](…)`), absolute Raw-URLs, Alt-Text Pflicht. Budget: PNG ≤ 400 KB,
GIF ≤ 2 MB, Ordner ≤ 5 MB.

## Die Bilder

| Datei | Klasse | Referenziert von | Muss zeigen |
|---|---|---|---|
| `settings.png` | detail | `README.md`/`README.de.md` (Configuration) | Der Einstellungen-Tab (eigenes Fenster, Obsidian 1.13) mit einer bereits eingerichteten **Accounts**-Gruppe: ein Konto-Eintrag mit Name, Server-URL, Benutzername und dem Hinweis, dass ein Passwort auf diesem Gerät hinterlegt ist (`settings.accounts.*`, s. `src/i18n/strings.ts`), darunter die nach „Verbindung prüfen und Kalender suchen" gefundene Sammlungsgruppe **„Gefunden — was soll gespiegelt werden?"** mit je einem Schalter für Kalender/Aufgaben/Kontakte (seit B1, `4ed710c`). Zeigt, dass Zugangsdaten pro Gerät liegen (nicht im Bild lesbar), und dass die Auswahl, was gespiegelt wird, ein bewusster Schritt nach der Discovery ist. |
| `preview.png` | feature | `README.md`/`README.de.md` (Usage → Setup) | Die Vorschau-Modal (`PreviewModal`, Kommando **Preview sync (dry run)**) nach einem Trockenlauf gegen das Fixture-Radicale: Gesamtzahl der geplanten Operationen und die Aufschlüsselung nach Sammlung (create/update/skip/archive/delete). Zeigt, dass vor jedem echten Lauf ein Trockenlauf möglich ist. |
| `event-note.png` | hero | `README.md`/`README.de.md` (Kopf, direkt nach den Badges — CORE-META-01 verlangt das erste Bild dort) | Eine gespiegelte Termin-Notiz im **Lesemodus** nach einem echten Sync-Lauf: Frontmatter mit `dav_uid`/`dav_source`/`dav_etag`/`start`/`end` (Properties-Ansicht) und darunter der verwaltete Body-Block. Zeigt den „Server ist Wahrheit, Notiz ist Spiegel"-Kern ohne ein Wort Text. |
| `adoption.png` | feature | `README.md`/`README.de.md` (Adoption) | Die AdoptionModal (Kommando **Adopt existing notes…**) mit vorbelegten Zeilen: Spalten Server-Eintrag/Notiz/Grund-Konfidenz/Aktion, mindestens eine Zeile mit `sure`→`link` und eine mit `weak`→`skip` sichtbar, dazu der Button **Adopt all sure matches**. Zeigt, dass Verknüpfen ein bestätigter Schritt ist, kein automatischer. |
| `command-form.png` | detail | `README.md`/`README.de.md` (Commands) | Das schema-generierte Formular (`SchemaFormModal`) für **New event…** — Titel-/Orts-/Zeitfelder aus dem Kommando-Schema, bevor irgendetwas geschrieben wird. Zeigt, dass Schreiben immer über ein Formular läuft, nie über Frontmatter-Editieren. |

## UI-Strings (verbatim aus `src/i18n/strings.ts`)

- Settings-Gruppen: **Accounts** · **Collections** · **Profiles** · **Sync** · **Actions**
  (DE: **Konten** · **Sammlungen** · **Profile** · **Synchronisation** · **Aktionen**)
- Konto-Zeile: **Test connection & find collections** · „No password stored on this device
  yet." (DE: **Verbindung testen & Sammlungen finden**)
- Adoption: **Adopt existing notes** · **Adopt all sure matches** · Spalten **Server entry**
  / **Note** / **Reason / confidence** / **Action**
- Befehle (Palette, EN): **Sync all collections** · **Preview sync (dry run)** ·
  **Sync one collection…** · **Adopt existing notes…** · **Create mapping profile from
  active note** · **Change event/contact…** · **New event…** · **New contact…** ·
  **Undo last change** · **Write hand edits to the server**

## Fixture

`fixtures/vault/` (s. `fixtures/vault/README.md`) — dasselbe Fixture wie beim GUI-Smoke,
bewusst nicht dupliziert: eine Pallas-ähnliche Struktur (Kontakte/Termine) plus generische
`Events/`/`Contacts/`-Ordner für die Standard-Profile. Server-Gegenstück:
`fixtures/radicale/` (drei Termine — `simple-1`, `allday-1`, `rec-1` — samt Kontakten),
gestartet über `scripts/dav-server.ts::startRadicale`. **Nichts Privates:** Namen und
Adressen im Fixture sind generisch (s. `fixtures/vault/notes/Pallas/…/Alex Aguado.md`,
`ADAC.md` — Platzhalter, keine echten Kontakte).
