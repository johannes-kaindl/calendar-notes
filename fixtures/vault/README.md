# Staging Vault Fixture

This directory contains a tracked fixture vault for the calendar-notes plugin smoke tests and README screenshots.

## Structure

- **`notes/`** — Markdown files for the staging vault, including:
  - `Welcome.md` — Welcome note
  - `Pallas/` — Sample Pallas-style structure with contacts and appointments
    - `50_Ressourcen/10_Reference/10_Kontakte/` — Contact notes (e.g., Alex Aguado, ADAC)
    - `30_Chronos/70_Termine/10_Anstehend/` — Appointment notes (e.g., Zahnärztin appointment)
  - `Contacts/` and `Events/` — Generic structure placeholders
  
- **`obsidian/`** — Obsidian vault configuration:
  - `app.json` — Application settings
  - `appearance.json` — Visual appearance settings
  - `community-plugins.json` — Enabled community plugins (calendar-notes)
  - `core-plugins.json` — Enabled core plugins (file-explorer, global-search, command-palette, page-preview, switcher)

## Usage

This fixture is used in two contexts:

1. **GUI Smoke Tests** — `scripts/gui-smoke.ts --setup` builds the staging vault from this fixture via the `buildVault` function from `tools/obsidian-cdp/vault.ts`. The smoke tests validate plugin functionality against this known vault state.

2. **README Screenshots** — `readme-shots` later uses the same vault fixture as a source for generating README documentation images.

The fixture is designed to be simple yet representative: it includes both Pallas-style organizational structure (for compatibility testing) and generic note types (contacts, events) to demonstrate the plugin's core functionality.
