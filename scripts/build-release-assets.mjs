// Baut die Zusatz-Assets des GitHub-Releases: `<id>.zip` (Bootstrap-ZIP) und
// `checksums.sha256` — mit derselben Logik wie der Forgejo-Weg (`tools/release/release.mjs`).
//
// Aufruf im Release-Workflow, NACH dem Build: `node scripts/build-release-assets.mjs [ausgabeordner]`.
// Liest main.js, manifest.json und styles.css (falls vorhanden) aus dem Repo-Wurzelverzeichnis,
// schreibt Zip und Prüfsummen in den Ausgabeordner (Default `release-assets/`) und meldet die
// Dateinamen. Die Zip-Logik liegt in `plugin-zip.mjs` (byte-identische Kopie von
// tools/release/lib/plugin-zip.mjs, bewacht von tools/template_drift_check.py) — hier steht nur
// der Aufruf, damit CI und Forgejo dasselbe Archiv aus demselben Stand bauen.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPluginZip, checksumsFile } from "./plugin-zip.mjs";

const root = process.cwd();
const outDir = resolve(root, process.argv[2] ?? "release-assets");

const assets = ["main.js", "manifest.json", "styles.css"]
  .filter((name) => existsSync(join(root, name)))
  .map((name) => ({ name, body: readFileSync(join(root, name)) }));
if (!assets.some((a) => a.name === "main.js") || !assets.some((a) => a.name === "manifest.json")) {
  console.error("build-release-assets: main.js und manifest.json müssen im Repo-Wurzelverzeichnis liegen (Build gelaufen?).");
  process.exit(1);
}

const zip = buildPluginZip({
  workDir: outDir,
  assets: [...assets],
  run: (cmd, args, opts) => execFileSync(cmd, args, { encoding: "utf8", ...opts }),
});
const withZip = [...assets, zip];
const checksums = checksumsFile(withZip);

mkdirSync(outDir, { recursive: true });
for (const a of [zip, checksums]) writeFileSync(join(outDir, a.name), a.body);
console.log(`build-release-assets: ${zip.name}, ${checksums.name} → ${outDir}`);
