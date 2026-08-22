# Staging-Vault-Fixture

Dieser Ordner enthält ein getracktes Fixture-Vault für die GUI-Smoke-Tests des calendar-notes-Plugins
und für README-Screenshots.

## Struktur

- **`notes/`** — Markdown-Dateien für das Staging-Vault, darunter:
  - `Welcome.md` — Willkommens-Notiz
  - `Pallas/` — Pallas-ähnliche Beispielstruktur mit Kontakten und Terminen
    - `50_Ressourcen/10_Reference/10_Kontakte/` — Kontakt-Notizen (z. B. Alex Aguado, ADAC)
    - `30_Chronos/70_Termine/10_Anstehend/` — Termin-Notizen (z. B. Zahnärztin-Termin)
  - `Contacts/` und `Events/` — generische Struktur-Platzhalter

- **`obsidian/`** — Obsidian-Vault-Konfiguration:
  - `app.json` — Anwendungseinstellungen
  - `appearance.json` — Erscheinungsbild-Einstellungen
  - `community-plugins.json` — aktivierte Community-Plugins (calendar-notes)
  - `core-plugins.json` — aktivierte Kern-Plugins (file-explorer, global-search, command-palette,
    page-preview, switcher)

## Verwendung

Dieses Fixture wird in zwei Kontexten benutzt:

1. **GUI-Smoke-Tests** — `scripts/gui-smoke.ts --setup` baut das Staging-Vault aus diesem Fixture
   über die Funktion `buildVault` aus `tools/obsidian-cdp/vault.ts` neu auf. Die Smoke-Tests prüfen
   die Plugin-Funktionalität gegen diesen bekannten Vault-Zustand.

2. **README-Screenshots** — `readme-shots` nutzt später dasselbe Vault-Fixture als Quelle für die
   Bebilderung der README.

Das Fixture ist bewusst einfach, aber repräsentativ gehalten: Es enthält sowohl eine
Pallas-ähnliche Organisationsstruktur (für die Kompatibilitätsprüfung) als auch generische
Notiz-Typen (Kontakte, Termine), um die Kernfunktionalität des Plugins zu zeigen.
