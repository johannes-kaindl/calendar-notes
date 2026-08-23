# Release

Release-Infrastruktur ist nach dem Dach-Standard (`obsidian-plugins/AGENTS.md`,
Skill `plugin-release-setup`) vorbereitet: `.github/workflows/release.yml` (vendored,
byte-identisch zu `../tools/release-template/`), `versions.json`, `CHANGELOG.md`,
`package.json`-Scripts `release`/`version-bump`/`preflight` (delegieren nach
`../tools/release/`), `LICENSE`/`LICENSING.md`/`THIRD-PARTY.md`, `docs/AUDIT.md`.

Was noch fehlt, ist ausschließlich Account-/Auth-Territorium — das läuft nicht autonom
und ist hier für die Übergabe an Johannes festgehalten.

## Erst-Release (Maintainer)

### 1. Remotes anlegen

Braucht Forgejo- + GitHub-Accounts. Muster aus einem laufenden Nachbar-Repo
(`git -C ../audio-interface remote -v`):

```
origin  git@git.jkaindl.de:jkaindl/audio-interface.git
github  git@github.com:johannes-kaindl/audio-interface.git
```

Für `calendar-notes` entsprechend:

1. Forgejo-Repo `jkaindl/calendar-notes` anlegen (leer).
2. GitHub-Repo `johannes-kaindl/calendar-notes` anlegen (leer, Mirror-Ziel).
3. Remotes setzen:
   ```
   git remote add origin git@git.jkaindl.de:jkaindl/calendar-notes.git
   git remote add github git@github.com:johannes-kaindl/calendar-notes.git
   git push -u origin main
   ```
4. `~/.forgejo-token` muss existieren (API-Token für den Forgejo-Release).

### 2. Erst-Release fahren

Vom Default-Branch, sauberer Arbeitsbaum:

```
npm run release -- 0.1.0 --dry-run   # vorher trocken prüfen
npm run release 0.1.0
```

Der Lauf: 3-File-Bump (`package.json`/`manifest.json`/`versions.json`) → CHANGELOG →
`preflight` → Commit → Tag → Push (Forgejo) → Build → GitHub-Mirror + Verifikation →
Forgejo-Release. Der GitHub-Tag triggert `.github/workflows/release.yml` → Attestation +
GitHub-Release.

### 3. Registrieren + verifizieren

- `python3 ../tools/mirror_drift_check.py` — prüft **Tags UND den `main`-Branch**
  Forgejo→GitHub synchron (nicht nur Tags — ein toter Mirror fällt an Tags gerade nicht
  auf, weil `release.mjs` sie per Dual-Push ohnehin selbst nachträgt).
- `python3 ../tools/template_drift_check.py` — vendorte Dateien synchron zum Template.
- GitHub-Actions-Tab manuell prüfen (Action läuft asynchron, `release.mjs` kann das
  nicht feststellen) — Tag-/`package.json`-/`manifest.json`-Konsistenz +
  `versions.json` deckt den Tag.
- **Gotcha (Dach-`AGENTS.md`):** meldet `release.mjs` „Store-Release entsteht erst nach
  manuellem Push", zuerst `git ls-remote --tags github` prüfen, bevor von Hand
  nachgepusht wird — der native Forgejo-Push-Mirror gewinnt oft das Rennen gegen den
  eigenen Dual-Push von `release.mjs`, dessen `git push github <tag>` dann mit
  „cannot lock ref … reference already exists" scheitert. Zeigt der GitHub-Tag schon auf
  denselben Commit, ist alles in Ordnung und die Meldung ist falsch — nicht blind
  nachpushen.
- `npm run release -- 0.1.0 --dry-run` überspringt sowohl `preflight` als auch das
  CHANGELOG-Rewrite — ein grüner `--dry-run` bestätigt also nicht, dass `preflight` oder
  die CHANGELOG-Heading-Einfügung beim echten Lauf funktionieren.

### 4. Community-Store einreichen

**Der `obsidianmd/obsidian-releases`-PR-Flow ist seit Mai 2026 retired.** Einreichung
läuft über das **Developer Dashboard** auf `community.obsidian.md`:

1. Plugin registrieren (id `calendar-notes`, Repo).
2. Auto-Install-Gate-Scan abwarten/prüfen (manifest/releases/behavior/source gegen die
   Guidelines — Warnings für ein lokal arbeitendes Plugin, das fs/Netzwerk nutzt, sind
   non-blocking, solange im README offengelegt).
3. Nach Grün zur Review einreichen.
4. **Updates brauchen keine Einreichung** (neues GitHub-Release wird automatisch
   erfasst), **aber der Review läuft nicht von selbst an** — im Developer Dashboard
   einen **Rescan anstoßen**, sonst passiert nichts. Status danach dort nachsehen.

Details: `obsidian-plugins/AGENTS.md` § „Store-Einreichung: der PR-Flow ist tot" und
`_docs/docs/obsidian-plugin-publishing.md`.

## Was hier NICHT ausgeführt wurde

Dieses Dokument beschreibt Schritte, die absichtlich nicht automatisiert ausgeführt
wurden (kein `git remote add`, kein `git push`, kein `git tag`, kein
`npm run release`, kein `gh repo create`) — Account-Anlage und Auth sind
Maintainer-Territorium.
