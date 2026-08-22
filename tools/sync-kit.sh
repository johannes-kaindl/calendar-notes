#!/bin/sh
# Vendort Kit-Module byte-identisch aus den Schwester-Repos (Dach-AGENTS.md, Kit-first).
# Nie von Hand editieren — Skript neu laufen lassen. Quelle festnageln per KIT_DIR/CODEKIT_DIR
# (Lesson 2026-08-22/3d-codeblocks: sonst misst ein Wiederholungslauf ein Upgrade).
set -e
KIT=${KIT_DIR:-../obsidian-kit}
CODEKIT=${CODEKIT_DIR:-/Users/Shared/code/code-kit}
DATE=$(date +%F)
stamp() { # $1 repo $2 version $3 sha $4 dir
  printf '{\n  "source": "%s",\n  "version": "%s",\n  "sha": "%s",\n  "vendored": "%s"\n}\n' "$1" "$2" "$3" "$DATE" > "$4/VENDOR.json"
}
mkdir -p src/vendor/code-kit src/vendor/kit tests/vendor/kit
CK_VER=$(git -C "$CODEKIT" describe --tags --abbrev=0); CK_SHA=$(git -C "$CODEKIT" rev-parse HEAD)
for f in timeout sha256 filename-template settings i18n; do
  { printf '%s\n' "// vendored from code-kit@$CK_VER, src/ts/pure/$f.ts — do not hand-edit; re-vendor via tools/sync-kit.sh"; cat "$CODEKIT/src/ts/pure/$f.ts"; } > "src/vendor/code-kit/$f.ts"
done
stamp code-kit "$CK_VER" "$CK_SHA" src/vendor/code-kit
K_VER=$(git -C "$KIT" describe --tags --abbrev=0); K_SHA=$(git -C "$KIT" rev-parse HEAD)
for f in frontmatter vault-path; do
  { printf '%s\n' "// vendored from obsidian-kit@$K_VER, src/pure/$f.ts — do not hand-edit; re-vendor via tools/sync-kit.sh"; cat "$KIT/src/pure/$f.ts"; } > "src/vendor/kit/$f.ts"
done
{ printf '%s\n' "// vendored from obsidian-kit@$K_VER, src/testing/obsidian-mock.ts — do not hand-edit; re-vendor via tools/sync-kit.sh"; cat "$KIT/src/testing/obsidian-mock.ts"; } > tests/vendor/kit/obsidian-mock.ts
stamp obsidian-kit "$K_VER" "$K_SHA" src/vendor/kit
stamp obsidian-kit "$K_VER" "$K_SHA" tests/vendor/kit
echo "vendored: code-kit($CK_VER): timeout sha256 filename-template settings i18n | obsidian-kit($K_VER): frontmatter vault-path obsidian-mock"
