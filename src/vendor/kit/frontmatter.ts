// vendored from obsidian-kit@0.92.0, src/pure/frontmatter.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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
// WAS IST BLOCK (Welle 34, Paket C1; gemessen 2026-11-14 in Obsidian 1.15.1, Pilot `pilot/frontmatter-leser.ts`, Lauf ohne Abweichung: `parseFrontmatter` stimmt in `exists` und Textbeginn mit `getFrontMatterInfo` in allen 17 Dokumenten überein):
//   Zaun, Zaun, Text                      → Block (null Zeilen), Text ab 8        | mit späterer Trennlinie im Text: derselbe Block, die Trennlinie ist Text
//   Zaun, Leerzeile, Zaun, Text           → Block (eine Leerzeile), Text ab 9     | Zaun, Zaun am Dateiende: Block, Text ab 7 | CRLF: Block, Text ab 10 | Zaun, Zaun, Zaun: Block, der dritte Zaun ist Text
//   `---  ` oder `---\t` als ÖFFNENDER Zaun → kein Block                          | als SCHLIESSENDER Zaun → schließt nicht (leerer Block mit `---  `: kein Block; mit späterem echtem Zaun: der schließt, Text ab 24)
//   BOM vor dem ersten Zaun               → kein Block                              | Text, der nie mit einer Zeile `---` schließt → kein Block | `---x` im Block ist Text im Block
//   Text nach einem Zaun mit späterer Trennlinie (ohne gültiges YAML) → Block (`getFrontMatterInfo`), `metadataCache` kennt keinen Schlüssel
// ⚠️ Obsidian liest an zwei Stellen verschieden: `getFrontMatterInfo` (diese Regel) ist streng, der `metadataCache` schließt auch an `---  `, `---\t` und `---x` und liest einen BOM davor mit (gemessen: `---\na: 1\n---  \nText` → Cache `{a:1}`,
// `getFrontMatterInfo` `exists: false`). Dieses Kit folgt `getFrontMatterInfo`, weil sie den Textbeginn nennt, den `insertAtCursor` und `patchFrontmatter` brauchen; ein Dokument mit `---  ` als einzigem Schluss hat damit für `patchFrontmatter` keinen
// lesbaren Block (`unparseable`, nie geschrieben, auch nicht mit `create: true`). Tabelle (Dokument, `getFrontMatterInfo`, `metadataCache`, Kit) als Datei: Ausgabeordner des Laufs, `frontmatter-leser.md`.
//
// Diese Datei muss unter `noUncheckedIndexedAccess` fehlerfrei sein (lig compiliert
// damit) — siehe npm-Skript `check:index-strict`.

import { baseName } from "../code-kit/rel-path";

export type FmValue = string | number | string[];
export interface ParsedFrontmatter {
  data: Record<string, FmValue>;
  order: string[];
  body: string;
  comments?: Record<string, string>;
}

/** Wo ein Dokument seinen Frontmatter-Block hat (Welle 34, Paket C1). Die EINE Antwort auf „was ist Block, was ist Text“ für `parseFrontmatter` und `patchFrontmatter` (und den Fake `getFrontMatterInfo`):
 *  `open` ist der öffnende Zaun samt Zeilenende, `raw` der Text dazwischen ohne das Zeilenende vor dem schließenden Zaun, `close` der schließende Zaun samt dem Zeilenende davor (bei einem leeren Block ohne), `bodyFrom` der Beginn des Textes,
 *  `empty` ein Block ohne eine Zeile (`---` direkt auf `---`, `raw` und die Zeilenende-Teile sind dann leer). */
export interface FrontmatterSpan { open: string; raw: string; close: string; bodyFrom: number; empty: boolean }

/** Findet den Frontmatter-Block am Anfang von `text`, sonst `null` (kein öffnender Zaun in Zeile 1, oder der Block schließt nie). Zeilenweise, linear: ein Block ist alles zwischen dem öffnenden Zaun und der ERSTEN Zeile, die genau `---` ist
 *  (bis zum Zeilenende oder Dateiende; `---x` und `---` mit Leerzeichen oder Tab dahinter sind keine Zaunzeile). Regel gemessen am 2026-11-14 in Obsidian 1.15.1 (`getFrontMatterInfo`, Pilot `frontmatter-leser`, Tabelle im Kopf dieser Datei); der `metadataCache` ist dort großzügiger, das Kit folgt `getFrontMatterInfo`. Zwei Zaunzeilen direkt nacheinander sind ein leerer Block, der Text beginnt hinter der zweiten (die alte Regex las dort die erste spätere
 *  Trennlinie im Text als schließenden Zaun, `patchFrontmatter` schrieb dann in den Text). Der öffnende Zaun ist genau `---` in Zeile 1 (Leerzeichen dahinter und ein BOM davor ergeben keinen Block). */
export function locateFrontmatter(text: string): FrontmatterSpan | null {
  const first = /^---\r?\n/.exec(text);
  if (!first) return null;
  const open = first[0];
  let pos = open.length;
  for (;;) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, text[lineEnd - 1] === "\r" && lineEnd > pos ? lineEnd - 1 : lineEnd);
    if (/^---$/.test(line)) {
      const bodyFrom = nl === -1 ? text.length : nl + 1;
      if (pos === open.length) return { open, raw: "", close: text.slice(pos, bodyFrom), bodyFrom, empty: true };
      const eolLen = text[pos - 2] === "\r" ? 2 : 1;
      return { open, raw: text.slice(open.length, pos - eolLen), close: text.slice(pos - eolLen, bodyFrom), bodyFrom, empty: false };
    }
    if (nl === -1) return null;
    pos = nl + 1;
  }
}

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
  const span = locateFrontmatter(text);
  if (!span) return { data: {}, order: [], body: text };
  const block = span.raw;
  const body = text.slice(span.bodyFrom);
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

/** Ein Skalar so, wie `serializeFrontmatter` ihn schreibt: bei Bedarf in Anführungszeichen (auch für die Einträge einer Blockliste in `frontmatter-patch`). */
export function quoteScalar(v: string): string {
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
  const name = baseName(path).trim();
  if (name !== "") return name;
  return hash >= 0 ? target.slice(hash + 1).trim() : "";
}

/** Ein Vault-Pfad als Wikilink: `A/B/Notiz.md` → `[[A/B/Notiz]]`. Die Endung `.md` fällt (ohne Rücksicht auf Groß und Klein, nur am Ende), jede andere bleibt (`bild.png` → `[[bild.png]]`).
 *  `null`, wenn sich der Pfad nicht als Link schreiben lässt: leer, mit einem der Zeichen `[ ] # ^ |` (in `[[…]]` gibt es kein Fluchtzeichen, der Link zeigte auf etwas anderes), mit leerem Ziel (nur `.md`) oder mit `/` am Ende (kein Dateiname).
 *  Bei `null` schreibt der Aufrufer den Pfad als Text: ein sichtbarer Pfad ist eine Unbequemlichkeit, ein Link auf die falsche Notiz ein Fehler. Mit `{ alias: true }` bekommt ein Pfad MIT Ordner den Dateinamen als Anzeige (`[[A/B/Notiz|Notiz]]`),
 *  ein Pfad ohne Ordner nie; die Vorgabe ist ohne Alias (ein Link als Wert einer Eigenschaft braucht keinen, ein Link im Fließtext liest sich mit ihm besser). Das Gegenstück zum Lesen ist `wikilinkDisplayText`. Wirft nie, ein Wert, der kein Text ist, ist `null`.
 *
 *  Herkunft und begründete Unterschiede (Dach-AGENTS, Bibliothek ab Eins), gelesen am 2026-11-14:
 *  - mailstone `src/core/render/wikilink.ts:15` (`wikilink`): derselbe Guard und dasselbe `null`; ließ `.md` stehen, ohne Grund (dort kommen nur Pfade ohne Endung an), das Kit folgt den beiden anderen.
 *  - vault-rag `src/link_writer.ts:23` (`wikilinkFor`): `.md` fällt, bei einem Pfad mit Ordner IMMER der Alias, weil der Link dort im Fließtext einer Notiz steht: hier `alias: true`.
 *  - diachronic (`src/core/commit-note.ts`, dritte Kopie, vom Gegenleser des Bibliothek-Gates abgelehnt): `.md` fällt, kein Alias; das ist die Vorgabe.
 *  Leeres Ziel und `/` am Ende prüfte keine Kopie; beide ergäben einen Link auf keine Datei (`[[]]`, `[[A/]]`).
 *  @example
 *  wikilinkOf("A/B/Notiz.md")                  // → "[[A/B/Notiz]]"
 *  wikilinkOf("A/B/Notiz.md", { alias: true }) // → "[[A/B/Notiz|Notiz]]"
 *  wikilinkOf("Was #1.md")                     // → null */
export function wikilinkOf(path: string, opts?: { alias?: boolean }): string | null {
  if (typeof path !== "string" || path === "" || /[[\]#^|]/.test(path)) return null;
  const target = path.replace(/\.md$/i, "");
  const name = baseName(target);
  if (target === "" || name === "") return null;
  return opts?.alias === true && name !== target ? `[[${target}|${name}]]` : `[[${target}]]`;
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
