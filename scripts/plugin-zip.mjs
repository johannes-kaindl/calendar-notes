// Ein-Datei-Bootstrap für die manuelle Erst-Installation eines Obsidian-Plugins.
//
// Warum das existiert: die Einzel-Assets eines Forgejo-Releases werden mit
// `content-type: text/plain` und `content-disposition: inline` ausgeliefert (gemessen
// 2026-09-06 an git.jkaindl.de). Ein Klick auf `main.js` im Browser ÖFFNET die Datei
// also als Text im Tab, statt sie zu laden — der Nutzer muss "Speichern unter", und die
// Browser hängen dabei gern `.txt` an. Das Ergebnis sieht aus wie ein kaputtes Plugin,
// nicht wie ein falscher Download, und ist damit die stillste Stelle des ganzen Wegs.
// Ein `.zip` bekommt einen echten Download-Dialog, bündelt drei Downloads zu einem und
// trägt den Ordnernamen bereits in sich — der Nutzer legt keinen Ordner mehr an und
// vertippt sich nicht in der Plugin-ID.
//
// Der Ordner im Archiv heißt nach der Plugin-ID aus `manifest.json`, NICHT nach dem
// Repo-Namen: Obsidian findet ein Plugin nur unter `.obsidian/plugins/<id>/`, und die
// beiden fallen auseinander (z.B. Repo `obsidian-letterhead` → id `letterhead`). Genau
// deshalb steht das hier zentral statt in 23 lokalen Kopien.

import { mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Liest die Plugin-ID aus einem manifest.json-Text.
 * Wirft mit erklärender Meldung, statt einen unbrauchbaren Namen zu erfinden — ein ZIP
 * mit falschem Ordnernamen installiert sich lautlos an die falsche Stelle.
 */
export function pluginIdFromManifest(manifestText) {
  let parsed;
  try {
    parsed = JSON.parse(manifestText);
  } catch (err) {
    throw new Error(`manifest.json ist kein gültiges JSON: ${err?.message ?? err}`);
  }
  const id = parsed?.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error('manifest.json hat kein nicht-leeres Feld "id" — ohne die ID ist der Ordnername im ZIP nicht bestimmbar.');
  }
  return id.trim();
}

/**
 * Name des ZIP-Assets — bewusst OHNE Version.
 *
 * Der Zweck des Assets ist ein Link, den eine README dauerhaft nennen kann:
 * `<forge>/<owner>/<repo>/releases/download/latest/<id>.zip`. Stünde die Version im
 * Namen, zeigte der Link nach dem nächsten Release ins Leere — und zwar in der Doku,
 * die ihn trägt, nicht im Release, das ihn erzeugt hat.
 */
export function pluginZipName(manifestText) {
  return `${pluginIdFromManifest(manifestText)}.zip`;
}

// Fester Zeitstempel für alle Archiv-Einträge (ZIP kennt nichts vor 1980). Mittags, damit
// die 2-Sekunden-Auflösung und Zeitzonen-Reste den Tag nicht kippen können.
const ZIP_EPOCH = new Date("2000-01-01T12:00:00Z");

/**
 * `checksums.sha256` für die übergebenen Assets, in dieser Reihenfolge
 * (`sha256sum`-Format: Hex, zwei Leerzeichen, Name). Dieselbe Funktion bedient den
 * Forgejo-Weg (release.mjs) und den GitHub-Workflow (build-release-assets.mjs).
 */
export function checksumsFile(assets) {
  const lines = assets.map((a) => `${createHash("sha256").update(a.body).digest("hex")}  ${a.name}`);
  return { name: "checksums.sha256", body: Buffer.from(lines.join("\n") + "\n") };
}

/**
 * Baut das Bootstrap-ZIP aus bereits eingelesenen Assets.
 *
 * `assets` ist dieselbe Liste, die als Einzel-Assets hochgeladen wird ({name, body}) —
 * so kann das Archiv nicht von den Einzeldateien abweichen. Gezippt wird über die
 * `zip`-CLI: das Release-Tooling läuft ausschließlich maintainer-lokal (siehe
 * package.json: "Läuft lokal, nie in CI"), dort ist sie vorhanden.
 *
 * @returns {{name: string, body: Buffer}} Asset-Eintrag, direkt anhängbar.
 */
export function buildPluginZip({ workDir, assets, run }) {
  const manifest = assets.find((a) => a.name === "manifest.json");
  if (!manifest) throw new Error("Bootstrap-ZIP nicht baubar: manifest.json ist nicht unter den Assets.");

  const id = pluginIdFromManifest(manifest.body.toString("utf8"));
  const stageDir = join(workDir, ".bootstrap-zip");
  const pluginDir = join(stageDir, id);
  const zipPath = join(stageDir, `${id}.zip`);

  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(pluginDir, { recursive: true });
  // Reproduzierbar: dasselbe Archiv aus Forgejo-Lauf (macOS, lokal) und GitHub-Workflow
  // (Linux, CI) — Zeitstempel, Modi, Eintragsreihenfolge und Zeitzone sind sonst die
  // Stellen, an denen zwei Läufe mit identischem Inhalt verschiedene Bytes liefern.
  const names = assets.map((a) => a.name).sort();
  for (const a of assets) {
    const file = join(pluginDir, a.name);
    writeFileSync(file, a.body);
    chmodSync(file, 0o644);
    utimesSync(file, ZIP_EPOCH, ZIP_EPOCH);
  }
  chmodSync(pluginDir, 0o755);
  utimesSync(pluginDir, ZIP_EPOCH, ZIP_EPOCH);

  // -X lässt macOS-Extrafelder weg (._-Dateien im Archiv verwirren beim Entpacken),
  // -q hält die Release-Ausgabe lesbar. Die Einträge stehen explizit und sortiert:
  // `-r` folgt der Verzeichnisreihenfolge des Dateisystems (APFS sortiert, ext4 nicht).
  // TZ=UTC, weil das DOS-Datum im Archiv in Ortszeit geschrieben wird.
  run("zip", ["-q", "-X", zipPath, `${id}/`, ...names.map((n) => `${id}/${n}`)],
    { cwd: stageDir, env: { ...process.env, TZ: "UTC" } });

  const body = readFileSync(zipPath);
  rmSync(stageDir, { recursive: true, force: true });
  return { name: `${id}.zip`, body };
}
