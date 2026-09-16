#!/usr/bin/env node
// check-no-nul-bytes.mjs — verbietet ROHE C0-Steuerzeichen in tracked Textdateien.
// Kanonische Quelle: _docs/templates/scripts/check-no-nul-bytes.mjs — per Repo verbatim kopiert.
//
// ⚠️ Der Dateiname ist enger als der Check und bleibt es: er steht in 22 `package.json` als
// Gate-Schritt, und ein Rename kostete 22 Repos fuer null Gewinn. Geprueft wird der ganze
// C0-Bereich ausser Tab, LF und CR.
//
// ZWEI Schadensbilder, ein Fix — und die Begruendungen sind verschieden:
//
// (1) NUL (U+0000): git und grep stufen eine Datei mit einem einzigen NUL-Byte als BINAER
//     ein. `grep -r <symbol>` findet ihren Inhalt dann nicht mehr — und genau davon lebt der
//     Kit-first-Vorher-Check. Kein Test wird dabei je rot.
//     Belegt: vault-rag/src/frontmatter.ts trug vier NUL-Bytes in einem String-Literal
//     ("\x00BODY\x00" statt " BODY "), json_viewer/src/core/schema.ts eines als Trennzeichen
//     in einem Composite-Key.
//
// (2) Uebriges C0 (U+0001–U+0008, U+000B, U+000C, U+000E–U+001F): die Datei bleibt Text, das
//     Zeichen ist aber fuer JEDEN LESER UNSICHTBAR — im Editor, in `git diff`, im
//     Review-Paket. Es wird als leerer String gelesen und wandert unbemerkt in den Bundle.
//     Belegt: lingotuner/src/obsidian/view-render.ts trug 2x U+0002 und 1x U+0001 als
//     Join-Trenner in `structureKey`; ZWEI unabhaengige Leser (Implementierer und ein
//     Opus-Reviewer) lasen "leerer String", und die Zeichen standen anschliessend in
//     `main.js`. Gefunden hat es niemand beim Lesen — nur ein Byte-Scan (2026-09-08).
//
// Der Fix ist in beiden Faellen derselbe und NIE "das Zeichen rauswerfen": als Trennzeichen in
// einem Composite-Key ist es inhaltlich richtig (es kann in keinem der verbundenen Werte
// vorkommen — das ist sein Zweck). Falsch ist nur die Schreibweise als ROHES Byte. Die
// Escape-Sequenz (Backslash-u-0002) erzeugt denselben Laufzeitwert und haelt die Datei lesbar.
//
// Exit 0 = sauber, 1 = Fund, 2 = Werkzeugfehler (git nicht verfuegbar, Datei unlesbar).
// Die Trennung ist Absicht: ein kaputtes Werkzeug darf nicht wie ein bestandener Check aussehen.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Endungen, die als Text gelten. Bewusst eine Positivliste: alles andere (Bilder, Fonts,
// PDFs, Binaerartefakte) darf und muss Steuerzeichen enthalten.
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|mts|md|json|css|yml|yaml|html|sh|py)$/;

// Minifizierte Vendor-Bundles tragen legitim rohe Steuerzeichen (ANSI-Escapes in
// eingebetteten Regexes) und sind kein Code, den hier jemand liest.
const AUSGENOMMEN = /(^|\/)(node_modules|vendor)\/|\.min\.(js|css)$/;

// Erlaubt: Tab (09), LF (0A), CR (0D). Verboten: der Rest von C0.
const ERLAUBT = new Set([0x09, 0x0a, 0x0d]);
const istVerboten = (b) => b < 0x20 && !ERLAUBT.has(b);

let files;
try {
  files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && TEXT_EXT.test(f) && !AUSGENOMMEN.test(f));
} catch (err) {
  console.error(`check-no-nul-bytes: git ls-files schlug fehl: ${err.message}`);
  process.exit(2);
}

const hits = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    console.error(`check-no-nul-bytes: ${file} nicht lesbar: ${err.message}`);
    process.exit(2);
  }
  for (let i = 0; i < buf.length; i += 1) {
    if (!istVerboten(buf[i])) continue;
    const code = buf[i].toString(16).padStart(4, "0").toUpperCase();
    const art = buf[i] === 0 ? "NUL-Byte (Datei gilt als binaer)" : "unsichtbares Steuerzeichen";
    hits.push(`${file}: U+${code} an Offset ${i} — ${art}`);
    break; // ein Fund je Datei genuegt; die Meldung soll lesbar bleiben
  }
}

if (hits.length > 0) {
  console.error("check-no-nul-bytes: rohe C0-Steuerzeichen in tracked Textdateien:");
  for (const h of hits) console.error(`  ${h}`);
  console.error("NUL macht die Datei fuer grep/git-grep binaer; die uebrigen sind fuer jeden");
  console.error("Leser unsichtbar und wandern unbemerkt in den Bundle.");
  console.error("Fix: das Byte als Escape-Sequenz schreiben (\\u0002), nicht roh.");
  process.exit(1);
}

console.log(`check-no-nul-bytes: OK — ${files.length} Textdateien ohne rohe C0-Steuerzeichen`);
