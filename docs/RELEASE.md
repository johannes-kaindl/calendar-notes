# Release

> ## Stand 2026-09-26: Release mit GitHub, Store-Weg wieder offen
>
> Seit der Entscheidung vom 2026-09-24 (das GitHub-Konto ist wieder frei) läuft ein Release wieder
> über beide Forges: `origin` (Forgejo) und `github` (`johannes-kaindl/calendar-notes`) sind als
> Remotes gesetzt, `npm run release` trägt **kein** `--no-github` mehr, und das Repo steht nicht
> mehr in `mirror_drift_check.AUSNAHMEN`. Gemessen 2026-09-26: `git remote -v`, `package.json`,
> `tools/mirror_drift_check.py`. `release.mjs` pusht Branch und Tag per Dual-Push nach GitHub, der
> Tag triggert `.github/workflows/release.yml`. Der Forgejo-Push-Mirror ist gelöscht — GitHub
> bekommt Branch und Tag **nur** vom Release, ein normaler Push auf `origin` erreicht es nicht
> (Dach-`AGENTS.md`, § Store-Einreichung).
>
> Die Abschnitte unten, die den Ausstieg vom 2026-09-04 beschreiben, sind als **historisch**
> markiert. Handlungsleitend ist dieser Block.

Release-Infrastruktur ist nach dem Dach-Standard (`obsidian-plugins/AGENTS.md`,
Skill `plugin-release-setup`) vorbereitet: `.github/workflows/release.yml` (vendored,
byte-identisch zu `../tools/release-template/`), `versions.json`, `CHANGELOG.md`,
`package.json`-Scripts `release`/`version-bump`/`preflight` (delegieren nach
`../tools/release/`), `LICENSE`/`LICENSING.md`/`THIRD-PARTY.md`, `docs/AUDIT.md`.

**Stand 2026-08-23: Erst-Release gelaufen.** Remotes `origin` (Forgejo `jkaindl/calendar-notes`)
und `github` (`johannes-kaindl/calendar-notes`) existieren; **0.1.1** ist das erste
veröffentlichte Release (GitHub-Release mit `main.js`/`manifest.json`/`styles.css`, Action grün,
Mirror synchron). Die Abschnitte unten bleiben als Verfahren für den nächsten Maintainer stehen.

> **Lehre aus 0.1.0 (Tag existiert, aber kein GitHub-Release):** die Release-Action fährt
> `npm run gate` im **Einzel-Repo-Checkout** — alles, was die zentrale CDP-Brücke
> `../../tools/obsidian-cdp/` importiert (`scripts/gui-smoke.ts`, `scripts/shots.ts`), darf
> dort nur hinter einem Existenz-Guard typgeprüft werden. `tsconfig.test.json` zog `scripts/`
> mit → TS2307 → Gate rot. Lokal war das unsichtbar, weil das Dach da ist. Seit `b065ba2`
> prüft `typecheck:test` nur `src/` + `tests/`; `typecheck:scripts` (mit Guard) deckt die
> Treiber ab. **Vor einem Tag einmal so prüfen, wie CI prüft:** `tsc -p tsconfig.test.json`
> darf nichts aus `scripts/` einschließen, das außerhalb des Repos liegt.


> **Hinweis zu `npm run preflight 0.1.0` VOR dem Release:** Er meldet „CHANGELOG.md hat keinen
> Eintrag mit Inhalt für 0.1.0" — das ist erwartbar, solange alles unter `[Unreleased]` steht:
> `release.mjs` setzt die `[0.1.0]`-Überschrift selbst und schiebt den Unreleased-Inhalt darunter,
> erst danach läuft sein eigener preflight. Eine handgeschriebene `[0.1.0]`-Überschrift wäre
> dagegen eine Dublette und lässt den echten Lauf scheitern (der dry-run zeigt das nicht).

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
`preflight` → Commit → Tag → Push (Forgejo) → Build → Dual-Push von Branch und Tag nach GitHub →
Forgejo-Release mit `main.js`/`manifest.json`/`styles.css`/`checksums.sha256`. Der GitHub-Tag
triggert `.github/workflows/release.yml` → Attestation + GitHub-Release.

*Historisch (2026-09-04 bis 2026-09-24):* `npm run release` fuhr mit `--no-github`, das `github`-Remote war entfernt, und der Workflow feuerte nicht.

### 3. Registrieren + verifizieren

- `python3 ../tools/mirror_drift_check.py` — prüft, ob GitHub-`main` den Commit des höchsten
  SemVer-Tags trägt; steht es dahinter, ist der Release-Push gescheitert.
- **Stattdessen anonym nachmessen, was Nutzer wirklich sehen** — mit Token verdeckt man genau
  den Fall, um den es geht:
  ```
  curl -s -o /dev/null -w '%{http_code}\n' \
    https://git.jkaindl.de/api/v1/repos/jkaindl/calendar-notes/releases/latest
  ```
  Erwartet: `200`, und die Assets enthalten `checksums.sha256`.
- `python3 ../tools/template_drift_check.py` — vendorte Dateien synchron zum Template.
- GitHub-Actions-Tab manuell prüfen (die Action läuft asynchron, `release.mjs` kann das
  nicht feststellen). Außerdem: Tag, `package.json`, `manifest.json` und
  `versions.json` müssen dieselbe Version tragen.
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

> **Gilt wieder seit 2026-09-24.** Das Plugin steht in `community-plugins.json` (gemessen
> 2026-09-26). Updates brauchen keine Einreichung; Rescans stößt der Maintainer im Dashboard an.

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
