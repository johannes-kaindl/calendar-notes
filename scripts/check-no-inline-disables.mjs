// Store-Review-Gate: KEIN inline `// eslint-disable*` in src/.
// Kanonische Fassung: obsidian-plugins/tools/release-template/scripts/ — nie von Hand
// editieren, Aenderungen im Template (template_drift_check.py prueft Byte-Gleichheit).
//
// Warum ein eigenes Gate: die Obsidian-Community-Store-Review wertet ein Inline-disable einer
// `obsidianmd/*`-Regel als ERROR — unabhaengig davon, wie gut es begruendet ist. Das hat
// zwei reine Wartungs-Releases gekostet (obsidian-transmute 0.3.1 und 0.6.1), weil die
// Konvention zwar in eslint.config.mjs stand, aber nichts sie erzwungen hat: ein disable
// laesst `npm run lint` gruen durchlaufen und faellt erst Tage spaeter im Review auf.
//
// Konsequenz: eine Regel, die stoert, wird entweder im Code aufgeloest (z. B. `document` →
// `workspace.rootSplit.doc`; Placeholder umformuliert) oder als file-scoped Override mit
// Begruendung in eslint.overrides.mjs eingetragen — dort ist sie sichtbar und reviewbar.
// Beides ist store-tauglich, das Inline-disable nicht.
//
// Das Gate blockt ALLE Inline-disables, nicht nur `obsidianmd/*`: die Regel-Herkunft steht dem
// Kommentar nicht zuverlaessig an (`// eslint-disable-next-line` ohne Regelnamen deaktiviert
// alles), und die file-scoped-Alternative steht ohnehin fuer jede Regel offen.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DISABLE = /\/[/*]\s*eslint-disable/;
const hits = [];

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (DISABLE.test(line)) hits.push(`${p}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}

walk("src");

if (hits.length) {
  console.error("Inline eslint-disable is not allowed in src/ (community store rejects it):");
  for (const h of hits) console.error(`  ${h}`);
  console.error("\nFix the code, or add a justified file-scoped override in eslint.overrides.mjs.");
  process.exit(1);
}
console.log("no inline eslint-disable OK");
