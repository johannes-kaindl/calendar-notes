// vendored from obsidian-kit@0.63.0, src/pure/frontmatter.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// frontmatter.ts — yaml_lite: flache Skalare + einfache Listen. Kein obsidian-Import.
//
// Gehoben aus vault-rag/src/frontmatter.ts (Serialisier-/Parse-Pfad); die smart-apply-
// Domäne (mergeFrontmatter/diffFrontmatter) bleibt dort.
//
// TYP-ASYMMETRIE (bewusst): serializeFrontmatter akzeptiert `number` und emittiert ihn
// bar (`seed: 199801046`), parseFrontmatter liefert dagegen IMMER Strings — yaml_lite
// macht keine Typinferenz. Deshalb normalisiert valueEquals Skalare über String(v),
// sonst schlüge der Round-Trip-Selbstcheck für Zahlen fehl.
//
// Diese Datei muss unter `noUncheckedIndexedAccess` fehlerfrei sein (lig compiliert
// damit) — siehe npm-Skript `check:index-strict`.

export type FmValue = string | number | string[];
export interface ParsedFrontmatter {
  data: Record<string, FmValue>;
  order: string[];
  body: string;
  comments?: Record<string, string>;
}

// Matches "---\n<block>\n---\n" at the very start of a document.
const DELIM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return s;
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  // Tokenize respecting single- and double-quoted substrings so that a comma
  // inside a quoted element does NOT split the token.
  const tokens: string[] = [];
  let cur = "";
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '"' || ch === "'") {
      // Consume the entire quoted span including escape sequences.
      const q = ch;
      cur += ch;
      i++;
      while (i < inner.length) {
        const c = inner[i];
        if (q === '"' && c === '\\' && i + 1 < inner.length) {
          cur += c + inner[i + 1];
          i += 2;
        } else if (q === "'" && c === "'" && i + 1 < inner.length && inner[i + 1] === "'") {
          cur += "''";
          i += 2;
        } else if (c === q) {
          cur += c;
          i++;
          break;
        } else {
          cur += c;
          i++;
        }
      }
    } else if (ch === ",") {
      tokens.push(unquote(cur.trim()));
      cur = "";
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  tokens.push(unquote(cur.trim()));
  return tokens;
}

/** Trennt einen YAML-Zeilenkommentar (` #…`, außerhalb von Quotes) vom Skalar/Listen-Rest.
 *  `#` zählt nur als Kommentar mit Whitespace davor ODER am rest-Anfang (Wert leer). */
function splitComment(rest: string): { value: string; comment: string } {
  let inS = false, inD = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (inD && c === "\\" && i + 1 < rest.length) { i++; continue; }
    if (c === '"' && !inS) inD = !inD;
    else if (c === "'" && !inD) inS = !inS;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(rest[i - 1] ?? ""))) {
      return { value: rest.slice(0, i).trimEnd(), comment: rest.slice(i + 1).trim() };
    }
  }
  return { value: rest, comment: "" };
}

export function parseFrontmatter(text: string, opts?: { comments?: boolean }): ParsedFrontmatter {
  const extractComments = opts?.comments ?? false;
  const m = DELIM_RE.exec(text);
  if (!m) return { data: {}, order: [], body: text };
  const block = m[1] ?? "";
  const body = text.slice(m[0].length);
  const data: Record<string, FmValue> = {};
  const order: string[] = [];
  const comments: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const kv = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/.exec(line);
    if (!kv) { i++; continue; }
    const key = (kv[1] ?? "").trim();
    let rest = kv[2] ?? "";
    if (extractComments) {
      const split = splitComment(rest);
      rest = split.value;
      if (split.comment) comments[key] = split.comment;
    }
    if (rest.trim().startsWith("[") && rest.trim().endsWith("]")) {
      data[key] = parseInlineList(rest);
      order.push(key);
      i++;
      continue;
    }
    if (rest.trim() === "") {
      // block list: following "- item" lines
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^[ \t]*-[ \t]+/.test(lines[j] ?? "")) {
        items.push(unquote((lines[j] ?? "").replace(/^[ \t]*-[ \t]+/, "")));
        j++;
      }
      if (items.length > 0) { data[key] = items; order.push(key); i = j; continue; }
      data[key] = "";
      order.push(key);
      i++;
      continue;
    }
    data[key] = unquote(rest);
    order.push(key);
    i++;
  }
  return { data, order, body, comments };
}

// Codepoints that YAML / our parser would mis-handle at scalar start.
const NEEDS_QUOTE_LEADING = /^[\s>|@`%&*!?#\-[{'"]/u;

function startsWithEmoji(s: string): boolean {
  const cp = s.codePointAt(0);
  if (cp === undefined) return false;
  // Symbols & pictographs, dingbats, misc symbols, regional indicators, etc.
  return (
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    cp === 0x2b50 || cp === 0x2705 || cp === 0x274c
  );
}

function needsQuoting(v: string): boolean {
  if (v === "") return false; // empty scalar emitted bare (key:)
  if (v !== v.trim()) return true;
  if (v.includes(": ") || v.endsWith(":")) return true;
  if (v.includes(" #") || v.includes("#")) return true;
  if (v.includes("[[") || v.includes("]]")) return true;
  if (v.includes(",")) return true; // comma would split inline-list tokenizer
  if (NEEDS_QUOTE_LEADING.test(v)) return true;
  if (startsWithEmoji(v)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(v)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return true;
  return false;
}

function quoteScalar(v: string): string {
  if (!needsQuoting(v)) return v;
  return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function serializeValue(v: FmValue): string {
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return "[" + v.map(quoteScalar).join(", ") + "]";
  return v === "" ? "" : quoteScalar(v);
}

export function serializeFrontmatter(data: Record<string, FmValue>, order: string[]): string {
  const lines: string[] = ["---"];
  for (const key of order) {
    const v = data[key];
    if (v === undefined) continue;
    const ser = serializeValue(v);
    lines.push(ser === "" ? `${key}:` : `${key}: ${ser}`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

/** Anzeigetext eines Wikilinks, der den GANZEN Wert ausmacht — die Entlinkung, die ein Spiegel (calendar-notes) oder eine Vorlesefunktion
 *  (audio-interface) braucht, um einen Link-Wert mit seinem Klartext zu vergleichen:
 *  `[[Ordner/Name|Alias]]` → `Alias`, `[[Ordner/Name]]` → `Name` (letztes Pfadsegment), `[[Name#Abschnitt]]` → `Name` (der `#…`-Teil entfällt),
 *  `[[#Abschnitt]]` → `Abschnitt` (kein Name da, dann der Abschnitt). Alles, was kein einzelner Wikilink ist, kommt **unverändert** zurück
 *  (Klartext, eine Liste von Links, Text mit einem Link darin). Ein leerer Alias (`[[a|]]`) zählt als fehlend. Wirft nie.
 *
 *  Herkunft und begründete Unterschiede (Dach-AGENTS § Kit-first Punkt 3), gelesen am 2026-10-18:
 *  - calendar-notes `src/core/mirror/hash.ts:28` (`unlink`): dieselbe Regel (Alias gewinnt, sonst letztes Segment ohne `#`). Dort trimmt
 *    die Funktion auch Klartext; das tut `valueEquals` mit `linkAware` im Vergleich, nicht diese Funktion („Klartext unverändert“).
 *  - audio-interface `src/core/speech-text.ts:30-33` und wikijs-maintainer `src/core/links.ts:32-36`: gleiche Alias-gewinnt-Regel, aber
 *    **im Fließtext** (jeder Wikilink in einem Absatz, dazu Embeds, Markdown-Links, Formatierung) — das ist ein anderer Gegenstand als ein
 *    Wert, der selbst ein Link ist, und bleibt dort. Der Unterschied am Ende der Kette: wikijs nimmt ohne Alias den Abschnitt vor dem
 *    Namen und den **ganzen** Pfad statt des letzten Segments, weil sein Label zugleich der Text eines Wiki.js-Links `[label](/pfad#anker)` ist;
 *    dafür gibt es hier keinen Grund (eine Eigenschaft heißt nicht „Ordner/Name“), das Kit folgt calendar-notes und audio-interface. */
export function wikilinkDisplayText(value: string): string {
  const m = /^\s*\[\[([^\]]*)\]\]\s*$/.exec(value);
  const inner = m?.[1];
  if (inner === undefined) return value;
  const bar = inner.indexOf("|");
  const alias = bar >= 0 ? inner.slice(bar + 1).trim() : "";
  if (alias !== "") return alias;
  const target = bar >= 0 ? inner.slice(0, bar) : inner;
  const hash = target.indexOf("#");
  const path = (hash >= 0 ? target.slice(0, hash) : target).trim();
  const name = (path.split("/").pop() ?? path).trim();
  if (name !== "") return name;
  return hash >= 0 ? target.slice(hash + 1).trim() : "";
}

export interface ValueEqualsOptions {
  /** Ein Wikilink und sein Klartext gelten als gleich (`[[Ordner/Ort|Ort]]` = `[[Ort]]` = `Ort`), verglichen über `wikilinkDisplayText` und
   *  ohne Rand-Leerraum. Ein anderer Anzeigetext bleibt eine Abweichung (`[[a|Ort]]` ≠ `Orte`). Default `false`. */
  linkAware?: boolean;
}

function strictEquals(a: FmValue, b: FmValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [String(a)];
    const bb = Array.isArray(b) ? b : [String(b)];
    return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
  }
  return String(a) === String(b);
}

/** Wertgleichheit für FmValue. Skalare werden über String(v) verglichen — ein `number`
 *  199801046 gilt als gleich zum reparsten String "199801046" (siehe Typ-Asymmetrie).
 *  Mit `{ linkAware: true }` gilt zusätzlich ein Wikilink als gleich zu seinem Anzeigetext (`wikilinkDisplayText`); die strenge Gleichheit
 *  gilt weiter (sie ist die Vorbedingung, nie lockerer). */
export function valueEquals(a: FmValue | undefined, b: FmValue | undefined, opts?: ValueEqualsOptions): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (strictEquals(a, b)) return true;
  if (opts?.linkAware !== true) return false;
  const display = (v: string): string => wikilinkDisplayText(v).trim();
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [String(a)];
    const bb = Array.isArray(b) ? b : [String(b)];
    return aa.length === bb.length && aa.every((x, i) => display(x) === display(bb[i] ?? ""));
  }
  return display(String(a)) === display(String(b));
}

export function assertParseable(fm: { data: Record<string, FmValue>; order: string[] }): void {
  const out = serializeFrontmatter(fm.data, fm.order);
  const reparsed = parseFrontmatter(out + " BODY ");
  if (reparsed.body !== " BODY ") {
    throw new Error("Frontmatter-Self-Check: Body-Delimiter nicht reparse-stabil");
  }
  for (const key of fm.order) {
    if (!valueEquals(fm.data[key], reparsed.data[key])) {
      throw new Error(`Frontmatter-Self-Check: Key "${key}" nicht reparse-stabil`);
    }
  }
  for (const key of Object.keys(reparsed.data)) {
    if (!fm.order.includes(key)) {
      throw new Error(`Frontmatter-Self-Check: unerwarteter Key "${key}" nach Reparse`);
    }
  }
}
