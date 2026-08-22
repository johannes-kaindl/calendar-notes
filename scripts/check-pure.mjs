// uebernommen (Muster) aus audio-interface/scripts/check-pure.mjs, 2026-08-22 — angepasst:
// `src/core/` muss frei von obsidian-/electron-/node-Importen UND DOM-Globals bleiben. Das ist die
// Zusicherung aus Spec §1(a): DAV-Client, Parser, Mirror und Kommandos sind ohne Obsidian node-testbar.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/core";
const FORBIDDEN_IMPORT = /(?:from|import)\s*\(?\s*["'](obsidian|electron|node:[a-z_]+|fs|path|http|https|net|tls|child_process)(\/[^"']*)?["']/;
const FORBIDDEN_GLOBAL = /\b(document|window|navigator|DOMParser|XMLHttpRequest|localStorage|activeWindow|activeDocument|process)\b/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const offenders = [];
for (const file of walk(ROOT).filter((f) => f.endsWith(".ts"))) {
  const code = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (FORBIDDEN_IMPORT.test(code)) offenders.push(`${file}: verbotener Import`);
  // Modul-Pfade sind Bezeichner-Strings, keine ausfuehrbaren Global-Referenzen (z. B. `from "./window"`,
  // weil ApplyInput den Typ `Window` aus genau dieser Datei importiert) — fuer den DOM-/Node-Global-Scan
  // blenden wir nur den Pfad-String in `from "..."`/`import("...")` aus. FORBIDDEN_GLOBAL selbst bleibt
  // die strikte Original-Form aus Task 1 unveraendert.
  const codeForGlobals = code.replace(/(from|import)(\s*\(?\s*)(["'])[^"']*\3/g, "$1$2$3$3");
  if (FORBIDDEN_GLOBAL.test(codeForGlobals)) offenders.push(`${file}: DOM-/Node-Global`);
}
if (offenders.length > 0) {
  console.error("src/core darf weder obsidian/node importieren noch DOM-Globals anfassen:");
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`check:pure: ${ROOT} ist frei von obsidian/node/DOM`);
