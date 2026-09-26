#!/bin/sh
# Vendort Kit-Module byte-identisch aus den Schwester-Repos (Dach-AGENTS.md, Kit-first).
# Nie von Hand editieren — Skript neu laufen lassen.
#
# CORE-META-22: Gelesen wird aus festen Git-Refs, NICHT aus dem Arbeitsstand der Nachbar-Repos.
# Ein `cat ../obsidian-kit/src/...` liefert je nach dessen HEAD etwas anderes oder gar nichts,
# waehrend die Herkunftsangabe in VENDOR.json einen Pin behauptet — zwei Messungen, die
# auseinanderlaufen, ohne dass es jemand sieht. `git show <ref>:<pfad>` ist reproduzierbar, an
# den Pin gebunden und stoert keine parallele Session im Nachbar-Repo (kein `checkout`).
#
# ZWEI QUELL-REPOS, und das ist der Unterschied zu vault-rag/epub-exporter: die reinen Module
# liegen seit Kit 0.28.0 in `code-kit` (eigenes Repo, eigene Versionsreihe), die
# Obsidian-gebundenen weiter in `obsidian-kit`. Beide Refs sind getrennt hebbar; wer hebt,
# aendert vendorierten Code und faehrt danach `npm run gate`.
#
# Zweiter Lauf darf keinen Diff erzeugen — das ist die Probe darauf, dass Header und
# VENDOR.json deterministisch sind. Deshalb steht hier KEIN Vendor-Datum mehr: es erzeugte
# bei jedem Lauf einen Diff und machte die Probe unmoeglich. Was der Stand ist, sagt die Ref.
set -e
KIT=${KIT_DIR:-../obsidian-kit}
CODEKIT=${CODEKIT_DIR:-"$HOME/Projects/jkaindl/libs/code-kit"}
KIT_REF=${KIT_REF:-0.28.0}
CODEKIT_REF=${CODEKIT_REF:-0.1.0}
# secrets liegt bewusst auf einer EIGENEN, neueren Ref als der restliche obsidian-kit-Bestand
# (Kit-Regel „Staffelung ist der Normalfall", Dach-AGENTS.md § obsidian-kit). Ein Versuch, am
# 2026-09-13 KIT_REF fuer ALLE Module auf 0.35.0 zu heben, brach tests/vendor/kit/obsidian-mock.ts
# unter tsconfig.test.json (vier TS2532 aus neuem Editor-Double-Code, unabhaengig von secrets) —
# deshalb bleibt der Rest auf 0.28.0 und nur secrets zieht separat nach.
SECRETS_REF=${SECRETS_REF:-0.35.0}
# help-setting (Hilfe-Zeile, UI-STANDARD 8) kam mit Kit 0.43.0, haengt an keinem anderen Modul und
# steht deshalb auf einem DRITTEN Pin — der Rest bleibt unberuehrt.
HELP_REF=${HELP_REF:-0.43.0}

# `^{commit}` ist Pflicht, nicht Kosmetik: beide Repos taggen ANNOTIERT (gemessen 2026-09-04,
# `git cat-file -t` sagt `tag`), ohne die Peelung landet das Tag-OBJEKT in VENDOR.json. Diese
# SHA kommt in `git log --all` null mal vor, und der Pin zeigt dann auf etwas, das niemand
# wiederfindet.
#
# Und der zweite Grund, warum hier ueberhaupt aus der Ref gestempelt wird: bis 2026-09-04 nahm
# dieses Skript die Version aus `describe --tags` und die SHA aus `rev-parse HEAD` — zwei
# verschiedene Messungen. Gemessen war der code-kit-Stempel dadurch in sich widerspruechlich
# (`"version": "0.1.0"` neben `38d034f`, waehrend `0.1.0^{commit}` = `b62fb59` ist). Inhaltlich
# deckungsgleich, aber der Pin log — genau die Sorte Fehlstand, die eine Pruefsumme beglaubigt.
sha_von() { git -C "$1" rev-parse --short "$2^{commit}"; }
ver_von() { git -C "$1" describe --tags --abbrev=0 "$2"; }

git -C "$KIT" rev-parse --verify --quiet "$KIT_REF^{commit}" >/dev/null \
  || { echo "FEHLER: Ref '$KIT_REF' existiert nicht in $KIT." >&2; exit 1; }
git -C "$KIT" rev-parse --verify --quiet "$SECRETS_REF^{commit}" >/dev/null \
  || { echo "FEHLER: Ref '$SECRETS_REF' existiert nicht in $KIT." >&2; exit 1; }
git -C "$KIT" rev-parse --verify --quiet "$HELP_REF^{commit}" >/dev/null \
  || { echo "FEHLER: Ref '$HELP_REF' existiert nicht in $KIT." >&2; exit 1; }
git -C "$CODEKIT" rev-parse --verify --quiet "$CODEKIT_REF^{commit}" >/dev/null \
  || { echo "FEHLER: Ref '$CODEKIT_REF' existiert nicht in $CODEKIT." >&2; exit 1; }

K_SHA=$(sha_von "$KIT" "$KIT_REF");          K_VER=$(ver_von "$KIT" "$KIT_REF")
SEC_SHA=$(sha_von "$KIT" "$SECRETS_REF");    SEC_VER=$(ver_von "$KIT" "$SECRETS_REF")
HELP_SHA=$(sha_von "$KIT" "$HELP_REF");        HELP_VER=$(ver_von "$KIT" "$HELP_REF")
CK_SHA=$(sha_von "$CODEKIT" "$CODEKIT_REF"); CK_VER=$(ver_von "$CODEKIT" "$CODEKIT_REF")

CK_PURE="timeout sha256 filename-template settings i18n"
K_PURE="frontmatter vault-path"
K_OBS="settings_walker folder-suggest confirm"
K_TEST="obsidian-mock"
K_SECRETS="secrets"
K_HELP="help-setting"

# VORPRUEFUNG, bevor irgendetwas geschrieben wird.
#
# Ein Abbruch mitten im Lauf ist zu spaet: `set -e` rettet nur die Datei, an der es ausloest,
# und laesst alle vorher geschriebenen zurueck. Am 2026-09-04 in einer Sandbox gegen die alte
# Fassung dieses Skripts reproduziert (ein fehlendes `i18n.ts`): vier code-kit-Module waren
# ueberschrieben, `i18n.ts` war ein 107-Byte-Stummel aus nur der Stempelzeile, die uebrigen
# sechs Module und alle vier VENDOR.json fehlten — ein halb zerstoerter Vendor-Ordner, der wie
# ein gueltiges Vendoring aussieht, und `set -e` hatte "korrekt" abgebrochen.
# Deshalb: erst pruefen, ob JEDE Quelle in ihrer Ref existiert, dann schreiben.
fehlend=""
for f in $CK_PURE; do
  git -C "$CODEKIT" cat-file -e "$CODEKIT_REF:src/ts/pure/$f.ts" 2>/dev/null \
    || fehlend="$fehlend code-kit@$CODEKIT_REF:src/ts/pure/$f.ts"
done
for f in $K_PURE; do
  git -C "$KIT" cat-file -e "$KIT_REF:src/pure/$f.ts" 2>/dev/null \
    || fehlend="$fehlend obsidian-kit@$KIT_REF:src/pure/$f.ts"
done
for f in $K_OBS; do
  git -C "$KIT" cat-file -e "$KIT_REF:src/obsidian/$f.ts" 2>/dev/null \
    || fehlend="$fehlend obsidian-kit@$KIT_REF:src/obsidian/$f.ts"
done
for f in $K_TEST; do
  git -C "$KIT" cat-file -e "$KIT_REF:src/testing/$f.ts" 2>/dev/null \
    || fehlend="$fehlend obsidian-kit@$KIT_REF:src/testing/$f.ts"
done
for f in $K_SECRETS; do
  git -C "$KIT" cat-file -e "$SECRETS_REF:src/pure/$f.ts" 2>/dev/null \
    || fehlend="$fehlend obsidian-kit@$SECRETS_REF:src/pure/$f.ts"
  git -C "$KIT" cat-file -e "$SECRETS_REF:src/obsidian/$f.ts" 2>/dev/null \
    || fehlend="$fehlend obsidian-kit@$SECRETS_REF:src/obsidian/$f.ts"
done
for f in $K_HELP; do
  git -C "$KIT" cat-file -e "$HELP_REF:src/obsidian/$f.ts" 2>/dev/null \
    || fehlend="$fehlend obsidian-kit@$HELP_REF:src/obsidian/$f.ts"
done
if [ -n "$fehlend" ]; then
  echo "FEHLER: Quellen fehlen:$fehlend" >&2
  echo "        Nichts geschrieben. Ab Kit 0.28.0 sind die pure/-Module nach code-kit gezogen —" >&2
  echo "        eine Ref zu heben verlangt eine Entscheidung ueber die QUELLE, nicht nur ueber die Version." >&2
  exit 1
fi

# vendor <zielpfad> <repo-verzeichnis> <git-ref> <version-label> <quell-repo-name> <quellpfad>
#
# Schreibt ERST nach .tmp und verschiebt NUR bei Erfolg. Grund: die naheliegende Form
# `{ printf header; git show ...; } > ziel` legt die Zieldatei an, BEVOR `git show` laeuft —
# fehlt die Quelle in der Ref, bleibt genau der oben beschriebene Stummel zurueck. Die
# Vorpruefung deckt den bekannten Fall ab, diese Klammer den unbekannten (Repo-Korruption,
# volle Platte, abgebrochenes `git show`).
# Die Parameter werden benannt statt als $3/$6 durchgereicht — zum Lesen, und weil
# `tools/vendor_leseart_check.py` im Dach die Leseart per TEXTMUSTER misst
# (`show\s+"?\$?\{?[A-Z_]*REF`). Ein `show "$3:$6"` liest korrekt aus der Ref und faellt bei
# diesem Waechter trotzdem auf `?? pruefen` — gemessen am 2026-09-04 an genau dieser Datei.
# Das ist die Bauart aus LESSONS 2026-09-03/koda-agent: wer eine per Muster gepruefte Datei
# umbaut, kann die Erkennung kippen, ohne am Verhalten etwas zu aendern. Also GROSS und
# sprechend — `SRC_REF`, nicht `$3`.
vendor() {
  ZIEL="$1"; SRC_REPO="$2"; SRC_REF="$3"; SRC_VER="$4"; SRC_NAME="$5"; SRC_PFAD="$6"
  tmp="$ZIEL.tmp"
  { printf '%s\n' "// vendored from $SRC_NAME@$SRC_VER, $SRC_PFAD — do not hand-edit; re-vendor via tools/sync-kit.sh"
    git -C "$SRC_REPO" show "$SRC_REF:$SRC_PFAD"; } > "$tmp" || {
      rm -f "$tmp"
      echo "FEHLER: $SRC_PFAD fehlt in $SRC_NAME@$SRC_VER — nichts geschrieben." >&2
      exit 1
    }
  mv "$tmp" "$ZIEL"
}

mkdir -p src/vendor/code-kit src/vendor/kit src/vendor/kit-obsidian tests/vendor/kit

for f in $CK_PURE; do
  vendor "src/vendor/code-kit/$f.ts" "$CODEKIT" "$CODEKIT_REF" "$CK_VER" code-kit "src/ts/pure/$f.ts"
done
for f in $K_PURE; do
  vendor "src/vendor/kit/$f.ts" "$KIT" "$KIT_REF" "$K_VER" obsidian-kit "src/pure/$f.ts"
done
for f in $K_OBS; do
  vendor "src/vendor/kit-obsidian/$f.ts" "$KIT" "$KIT_REF" "$K_VER" obsidian-kit "src/obsidian/$f.ts"
  # Import-Umschreibung: obsidian-kit haelt die reinen Module unter src/pure/, dieser Konsument
  # vendort sie sibling zu src/vendor/kit-obsidian/ unter src/vendor/kit/ — ein Import
  # "../pure/x" aus der Kit-Quelle muss deshalb auf "../kit/x" zeigen (gleiche relative Tiefe,
  # nur anderer Ordnername). Betrifft z. B. secrets.ts (importiert ../pure/secrets).
  sed -i.bak 's#from "\.\./pure/#from "../kit/#g' "src/vendor/kit-obsidian/$f.ts"
  rm -f "src/vendor/kit-obsidian/$f.ts.bak"
done
for f in $K_TEST; do
  vendor "tests/vendor/kit/$f.ts" "$KIT" "$KIT_REF" "$K_VER" obsidian-kit "src/testing/$f.ts"
done
for f in $K_SECRETS; do
  vendor "src/vendor/kit/$f.ts" "$KIT" "$SECRETS_REF" "$SEC_VER" obsidian-kit "src/pure/$f.ts"
  vendor "src/vendor/kit-obsidian/$f.ts" "$KIT" "$SECRETS_REF" "$SEC_VER" obsidian-kit "src/obsidian/$f.ts"
  sed -i.bak 's#from "\.\./pure/#from "../kit/#g' "src/vendor/kit-obsidian/$f.ts"
  rm -f "src/vendor/kit-obsidian/$f.ts.bak"
done
for f in $K_HELP; do
  vendor "src/vendor/kit-obsidian/$f.ts" "$KIT" "$HELP_REF" "$HELP_VER" obsidian-kit "src/obsidian/$f.ts"
done

# write_vendor_json <verzeichnis> <quell-repo> <version> <sha> <modul-liste> [zusatz-note]
#
# Der "note"-Text traegt optional einen Staffel-Hinweis: das Verzeichnis kann Module aus ZWEI
# Refs enthalten (Kit-Regel „Staffelung ist Normalfall"). Die einzelne Datei ist dabei die
# verbindliche Wahrheit (eigener Header je Modul), dieses JSON ist nur die Aggregat-Ansicht
# fuer die Basis-Ref — Dach-AGENTS.md: „Der Ordner ist die Absicht, der Header ist die Wahrheit."
write_vendor_json() {
  zusatz=""
  if [ -n "${6:-}" ]; then zusatz=" $6"; fi
  printf '{\n  "source": "%s",\n  "version": "%s",\n  "sha": "%s",\n  "modules": "%s",\n  "note": "Verbatim snapshot aus der Git-Ref %s (CORE-META-22: feste Ref, nicht Arbeitsstand). Never hand-edit. Re-vendor via tools/sync-kit.sh.%s"\n}\n' \
    "$2" "$3" "$4" "$5" "$3" "$zusatz" > "$1/VENDOR.json"
}
liste() { printf '%s.ts, ' $1 | sed 's/, $//'; }

SEC_NOTE="secrets.ts liegt in diesem Verzeichnis auf einer EIGENEN, neueren Ref: obsidian-kit@$SEC_VER ($SEC_SHA) — s. eigener Datei-Header, nicht diese Basis-Version."
HELP_NOTE="help-setting.ts steht auf einer DRITTEN Ref: obsidian-kit@$HELP_VER ($HELP_SHA) — s. eigener Datei-Header."

write_vendor_json src/vendor/code-kit    code-kit     "$CK_VER" "$CK_SHA" "$(liste "$CK_PURE")"
write_vendor_json src/vendor/kit         obsidian-kit "$K_VER"  "$K_SHA"  "$(liste "$K_PURE") + secrets.ts@$SEC_VER" "$SEC_NOTE"
write_vendor_json src/vendor/kit-obsidian obsidian-kit "$K_VER" "$K_SHA"  "$(liste "$K_OBS") + secrets.ts@$SEC_VER + help-setting.ts@$HELP_VER" "$SEC_NOTE $HELP_NOTE"
write_vendor_json tests/vendor/kit       obsidian-kit "$K_VER"  "$K_SHA"  "$(liste "$K_TEST")"

echo "vendored: code-kit@$CK_VER ($CK_SHA) → $CK_PURE | obsidian-kit@$K_VER ($K_SHA) → $K_PURE $K_OBS $K_TEST | obsidian-kit@$SEC_VER ($SEC_SHA) → $K_SECRETS (separat gepinnt)"
