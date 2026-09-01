#!/usr/bin/env node
// check-no-abs-paths.mjs — CORE-META-14-Gate.
// Kanonische Quelle: _docs/templates/scripts/check-no-abs-paths.mjs — per Repo verbatim kopiert.
// Verbietet distinktive absolute Maintainer-Pfade in tracked Markdown-Dateien.
// Generische Doku-Beispiele (/Users/you/…, /Users/<name>/…) bleiben erlaubt.
import { execFileSync } from "node:child_process";

const PATTERN = String.raw`/Users/(Shared|johannes)`;

let hits = "";
try {
  hits = execFileSync("git", ["grep", "-I", "-n", "-E", PATTERN, "--", "*.md"], {
    encoding: "utf8",
  });
} catch (err) {
  // git grep: exit 1 = keine Treffer, alles andere = echter Fehler
  if (err.status === 1) {
    console.log("check-no-abs-paths: OK — keine absoluten Maintainer-Pfade in tracked *.md");
    process.exit(0);
  }
  console.error(`check-no-abs-paths: git grep schlug fehl: ${err.message}`);
  process.exit(2);
}

console.error("check-no-abs-paths: absolute Maintainer-Pfade in tracked *.md (CORE-META-14):");
console.error(hits.trimEnd());
console.error("→ Platzhalter nutzen: $VAULT/… für Vault-Pfade, ~/… für Home, repo-relative Pfade für Kommandos.");
process.exit(1);
