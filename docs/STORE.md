# Store-Vorschau

Vorabschätzung der Obsidian-Community-Store-Review, basierend auf dem Skill
`obsidian-store-recherche` (gemessen 2026-08-22): der eigene Bautyp — `requestUrl` +
Basic-Auth + Notizen schreiben — hat bei `harang-contacts`, `nextcloud-tasks` und
`powerdesk` `Passed` erreicht. Diese drei sind die Vergleichsbasis für die Zeilen unten.

## Erwartete Scorecard

### `info` (unvermeidbar bei diesem Bautyp, kein Blocker)

| Zeile | Grund |
|---|---|
| Netzwerk-Calls | `requestUrl` gegen vom Nutzer konfigurierte DAV-Server (Discovery, Sync, Multiget, Objekt-PUT/DELETE) — `src/obsidian/transport.ts` |
| Base64-Encoding | `Basic`-Auth-Header (`base64Utf8` in `src/core/dav/transport.ts:6,20`) — Standard-HTTP-Basic-Auth, kein Verschleierungsversuch |
| Vault-Enumeration | `app.vault.getMarkdownFiles()` in `src/main.ts`, `src/obsidian/vault-notes.ts`, `src/obsidian/plugin-host.ts`, `src/obsidian/command-modal.ts` — Adoptions-Kandidaten finden, State-Lookup, Kontakt-Suggester |
| Clipboard-Zugriff | `navigator.clipboard.writeText` in `src/obsidian/settings-tab.ts` (Profil-Export als JSON) und `src/obsidian/invite.ts` (`.ics`-Fallback-Text kopieren) — beide mit dem Guard vor dem Property-Read (Registry: „Text in die Zwischenablage schreiben") |

### Erwartete `pass`-Zeilen

- Kein `child_process`, kein direkter `fs`-Zugriff (`grep -rln "child_process" src` → leer) — nur die Obsidian-Vault-API.
- Kein globaler State außerhalb von `manifest.dir` (State-Store unter `manifest.dir/state/`).
- Kein `eval`/`new Function`.
- `manifest.json` vollständig (`id`, `name`, `version`, `minAppVersion`, `description`, `author`, `authorUrl`, `isDesktopOnly`).

### Keine `medium`-Befunde erwartet

Store-Wissen: die Befunde, die bei diesem Bautyp typischerweise die Note kosten, sind
Code-Hygiene-Regeln von `eslint-plugin-obsidianmd` (deprecated APIs, `innerHTML`,
fehlende `Vault`-statt-Adapter-Nutzung u. ä.) — nicht die Bauart selbst. `npm run lint`
läuft genau diesen Scanner (`eslint-plugin-obsidianmd` in den devDependencies) mit
`--max-warnings 0`; ein grüner `npm run lint` ist also Scanner-Parität, nicht nur ein
Näherungswert. Vor dem Erst-Release: `npm run gate` muss 0 Errors und 0 Warnings zeigen.

## Bauart-Entscheidungen, die medium-Befunde vermeiden

| Entscheidung | statt | Begründung |
|---|---|---|
| `requestUrl` (`src/obsidian/transport.ts`) | globales `fetch` | Obsidian-API, umgeht CORS zuverlässig, ist der vom Scanner erwartete Weg für Netzwerk-Calls aus einem Plugin |
| `app.secretStorage` (`src/obsidian/secrets.ts`) | Zugangsdaten in `data.json` | Zugangsdaten OS-verschlüsselt im Schlüsselbund statt im Klartext-Settings-File; nur eine `secretId`-Referenz landet in `data.json` |
| `processFrontMatter` / `vault.process` (`src/obsidian/vault-notes.ts`) | eigener Datei-Read/Write über den Adapter | Obsidians eigener YAML-Roundtrip statt selbstgebauter Frontmatter-Parser — vermeidet Race-Conditions mit anderen Plugins/dem Editor |
| Kein `child_process`, kein direktes `fs` | ein Hilfsprozess für DAV-Zugriff | reine Netzwerk-/Vault-API-Nutzung, keine Prozess-Spawns aus dem Plugin heraus |

## Netzwerkziele — Erklärung für den Review

Das Plugin spricht ausschließlich **vom Nutzer selbst in den Settings konfigurierte**
CalDAV-/CardDAV-Server (Discovery-URL + Zugangsdaten im Schlüsselbund). Es gibt:

- **keine Telemetrie** — kein Analytics-Endpunkt, kein Absturzbericht, kein Update-Check
  außerhalb des Obsidian-Store-eigenen Mechanismus,
- **keinen eigenen Mailversand** — der Einladungs-Weg (`src/obsidian/invite.ts`) nutzt
  entweder Server-seitiges RFC-6638-Scheduling (derselbe, vom Nutzer konfigurierte
  Server) oder einen vom Nutzer registrierten Mail-Transport eines anderen Plugins
  (`registerMailTransport`, Vertrag mit mailstone) oder fällt auf einen lokalen
  `.ics`-Text zum Kopieren/Speichern zurück — nie ein selbst betriebener Mail-Endpunkt,
- **kein Drittanbieter-Backend** — keine Anfrage an einen von diesem Plugin selbst
  betriebenen oder ausgewählten Dienst; jede Netzwerkadresse kommt aus der
  Nutzer-Konfiguration.

`isDesktopOnly: false` — das Plugin nutzt nur `requestUrl`, `app.secretStorage` (≥
1.11.4, mit In-Memory-Fallback für ältere Versionen/Tests) und Vault-APIs, keine
Desktop-only-Node-Module.

## Einreichungs-Flow (Erst-Release)

Der `obsidianmd/obsidian-releases`-PR-Flow ist seit Mai 2026 retired (Dach-`AGENTS.md` §
„Store-Einreichung: der PR-Flow ist tot"). Ablauf:

1. Release fahren (`docs/RELEASE.md`) → GitHub-Release existiert.
2. Plugin im **Developer Dashboard** auf `community.obsidian.md` registrieren
   (GitHub-Account verbinden, Repo `calendar-notes` wählen).
3. Auto-Install-Gate-Scan abwarten — Warnings für ein lokal arbeitendes Plugin mit
   Netzwerk-Zugriff sind non-blocking, solange im README offengelegt (§ „Sicherheit /
   Datenschutz" in `README.md`/`README.de.md`).
4. Nach Grün zur Review einreichen.
5. **Der Tag ist nicht das Ende:** spätere Updates brauchen keine neue Einreichung
   (automatisch erfasst), aber der Review läuft **nicht von selbst an** — im Dashboard
   muss jeweils ein **Rescan** angestoßen werden, sonst passiert nichts. Ein
   durchgefallener Review nimmt das Plugin binnen 24 Stunden aus der Suche.

Details: `../AGENTS.md` (Dach) § „Store-Einreichung: der PR-Flow ist tot",
`_docs/docs/obsidian-plugin-publishing.md`.

## Checkliste vor dem Erst-Release

- [ ] `npm run gate` — 0 Errors, 0 Warnings.
- [ ] `npm run test:integration` grün (Radicale).
- [ ] `npm run typecheck:scripts` grün.
- [ ] `npm run smoke:gui -- --section generic` **und** `--section pallas` grün (gegen ein
      laufendes, fokussiertes Obsidian — Handover, nicht Teil dieses Tasks).
- [ ] `shots:check` (`readme_lint.py`) grün.
- [ ] `npm run preflight` grün (Remote-Warnungen sind vor dem Anlegen der Remotes
      erwartet, kein Blocker für den Rest).
- [ ] README-Bilder aufgenommen (`docs/images/`, Skill `readme-shots`) — Platzhalter
      ersetzt.
- [ ] Forgejo- + GitHub-Remote angelegt (`docs/RELEASE.md` § „Remotes anlegen").
- [ ] `npm run release 0.1.0` gefahren, GitHub-Release + Attestation geprüft.
- [ ] Developer-Dashboard-Eintrag + Rescan angestoßen, Status geprüft.
