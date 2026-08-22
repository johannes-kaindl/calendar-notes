# Changelog

## [Unreleased]
- M1: obsidian-freier DAV-Kern — Discovery (well-known → principal → home-sets), Collection-Sync (sync-collection mit Fallback auf ctag/etag-Diff), Multiget, Objekt-Client mit If-Match/412; VEVENT- und vCard-Parser/Mutationen auf ical.js; Radicale-Integrationstest (`npm run test:integration`).
- M2a: obsidian-freier Mirror-Kern — Mapping-Profile, verwaltete Werte + Attendee-Wikilinks, Body-Block-Verwaltung, Dateiname (Kit-Template) + Hash, Zeitfenster + Wiederholungs-Queries; Plan-Typen create/update/skip/archive/delete; Collection-State-Tracking mit Snapshot/Verlauf.
- M2b: Obsidian-Schicht — Settings-Modell (Konten + Secrets im Schlüsselbund), Transport/State/Secrets-Adapter, SyncService mit injizierten Interfaces (vitest mit Fakes vollständig getestet), Settings-Tab (Discovery, Profil-Management, Sync-Optionen), Vorschau-Modal, Kommandos (sync-all/sync-preview/sync-collection), Start-/Intervall-Trigger.
