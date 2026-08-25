# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
