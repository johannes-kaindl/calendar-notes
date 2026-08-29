/**
 * Vault-Trockenlauf: zaehlt Adoptions-Kandidaten in einem ECHTEN Vault, ohne etwas zu schreiben.
 *
 * Zweck: Eine Rollout-Vorbereitung rechnet vorab aus, wie viele Notizen die Adoption sehen wird
 * ("erwarte 129 Kontakte") und benutzt diese Zahl spaeter als Abbruchkriterium. Die Zahl altert
 * mit dem Vault. Dieses Werkzeug rechnet sie mit dem ECHTEN `candidateNotes`/`countTypeExcluded`
 * nach — nicht mit einem Nachbau — und beantwortet damit die einzige Frage, die zaehlt: gilt die
 * Erwartung heute noch?
 *
 * Es liest nur (`readFileSync`), spricht keinen Server an und braucht kein laufendes Obsidian.
 *
 *   npx tsx scripts/vault-dryrun.ts --vault <pfad> --folder <ordner> [--type <typ>] [--expect <n>]
 *
 *   --vault    Wurzel des Vaults (Pflicht)
 *   --folder   Profil-Ordner, relativ zur Vault-Wurzel (Pflicht; "" = ganzes Vault)
 *   --type     Wert von `onCreate.type` im Profil. Weglassen = Profil ohne Typ-Filter.
 *   --expect   Erwartete Kandidatenzahl. Weicht sie ab, ist der Exit-Code 1.
 *   --source-field  Marker-Feld fuer "bereits verknuepft" (Default `dav_source`).
 *
 * Grenze des Frontmatter-Lesers: er versteht skalare Top-Level-Keys, mehr braucht die Zaehlung
 * nicht (`type` und das Source-Feld). Listen- und Blockwerte werden uebersprungen, nicht geraten —
 * eine Notiz, die ihr Source-Feld als Liste fuehrt, wuerde hier faelschlich als Kandidat zaehlen.
 * Obsidian selbst liest das Frontmatter vollstaendig; diese Zaehlung ist eine Vorschau, kein Ersatz
 * fuer den `sync-preview` im Plugin.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { candidateNotes, countTypeExcluded, type CandidateNote } from "../src/core/adopt/match";
import type { MappingProfile } from "../src/core/mirror/profile";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function collectMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue; // .obsidian, .git, .trash
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectMarkdown(full, out);
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

function readFrontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) return {};
  const fm: Record<string, unknown> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    const key = m?.[1];
    if (key === undefined) continue;
    let value = (m?.[2] ?? "").trim();
    if (value === "" || value === "|" || value === ">" || value === ">-") continue; // Block-/Leerwert
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    fm[key] = value;
  }
  return fm;
}

function profileFor(folder: string, type: string | undefined, sourceField: string): MappingProfile {
  return {
    id: "dryrun", name: "dryrun", kind: "contact",
    folder, filename: "{fn}",
    uidField: "dav_uid", sourceField, etagField: "dav_etag",
    stateField: "dav_state", recurrenceIdField: "dav_recurrence_id",
    fields: {}, onCreate: type === undefined ? {} : { type },
    body: "none", attendeeLinks: false,
  };
}

const vault = arg("vault");
const folder = arg("folder");
if (vault === undefined || folder === undefined) {
  console.error("Pflicht: --vault <pfad> --folder <ordner>   (--folder \"\" fuer das ganze Vault)");
  process.exit(2);
}

const sourceField = arg("source-field") ?? "dav_source";
const type = arg("type");
const expectRaw = arg("expect");

const notes: CandidateNote[] = collectMarkdown(vault).map((file) => {
  const text = readFileSync(file, "utf8");
  const path = relative(vault, file).split(sep).join("/");
  return {
    path,
    basename: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
    frontmatter: readFrontmatter(text),
    body: text,
  };
});

const profile = profileFor(folder, type, sourceField);
const kandidaten = candidateNotes(notes, profile).length;
const ungeprueft = countTypeExcluded(notes, profile);

console.log(`Vault:        ${vault}`);
console.log(`Ordner:       ${folder === "" ? "(ganzes Vault)" : folder}`);
console.log(`Typ-Filter:   ${type ?? "(keiner — onCreate.type leer)"}`);
console.log(`Notizen:      ${notes.length} gesamt im Vault`);
console.log(`Kandidaten:   ${kandidaten}`);
console.log(`Nicht geprueft (nur wegen abweichendem type): ${ungeprueft}`);

if (expectRaw !== undefined) {
  const expect = Number(expectRaw);
  if (!Number.isInteger(expect)) {
    console.error(`--expect braucht eine ganze Zahl, bekam "${expectRaw}"`);
    process.exit(2);
  }
  if (kandidaten === expect) {
    console.log(`\nOK — die Erwartung von ${expect} gilt unveraendert.`);
  } else {
    console.error(`\nABWEICHUNG — erwartet ${expect}, gezaehlt ${kandidaten}.`);
    console.error("Das ist ein Befund, kein Fehler: entweder hat sich das Vault geaendert,");
    console.error("oder Ordner/Typ stimmen nicht mit dem Profil ueberein, das gemeint war.");
    process.exit(1);
  }
}
