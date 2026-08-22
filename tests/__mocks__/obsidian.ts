// Dünnes Alias-Ziel für vitest (PROF-OBS-08): re-exportiert den vendorten Kit-Mock.
export * from "../vendor/kit/obsidian-mock";

// Override: der vendorte Kit-Mock (Stand 0.28.0) kennt `getFrontMatterInfo` noch nicht.
// Minimale, aber zur echten Obsidian-API kompatible Nachbildung (node_modules/obsidian/
// obsidian.d.ts) — NICHT in den vendorten Mock schreiben, der wird per `tools/sync-kit.sh`
// ueberschrieben. Erkennt nur den einfachen "---\n...\n---\n"-Block am Dateianfang
// (kein YAML-Parsing noetig, nur die Offsets).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  from: number;
  to: number;
  contentStart: number;
}

export function getFrontMatterInfo(content: string): FrontMatterInfo {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
  const block = m[1] ?? "";
  return { exists: true, frontmatter: block, from: 4, to: 4 + block.length, contentStart: m[0].length };
}
