// vendored from code-kit@0.68.0, src/ts/pure/filename-policy.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Rules for one path segment (a file name or a folder name): which characters a name may not carry, what replaces them, and how
 *  long it may be. Obsidian-free and import-free (the module is vendored on its own).
 *
 *  Origin: written for the `filename-sanitizer` plugin (spec 2026-11-08, § 5), which repairs wrong names written by other plugins and
 *  scripts. The sister function `sanitizeFilename` in `filename-template.ts` stays as it is: its character class `INVALID` is
 *  load-bearing for three published plugins and renames their exports silently if it moves. This module sits beside it and differs on
 *  purpose: the set also holds the link breakers `# ^ [ ]`, every replacement is a setting, and the result is explained as a list of hits.
 *
 *  Contract:
 *  - Input is ONE segment, never a path. For a file only the stem is edited; the extension (`.` plus up to 16 ASCII letters or digits at
 *    the end of the name, found AFTER the replacements) stays. A folder is edited as a whole, so `v1.2` keeps its `.2`.
 *  - Always on, no setting: control characters go; spaces and dots at the edge of the stem go; a space that a replacement creates next to
 *    another space is not doubled (existing double spaces stay); an empty result becomes `Untitled`. The caller numbers on a collision
 *    with {@link numberedName}, or lets {@link firstFreeName} ask `exists` until a name is free (three suffix styles, a limit, an async twin;
 *    unlike the rest of the module these two also take a whole path: only the last segment's extension is looked at).
 *  - `applyPolicy` is idempotent (`apply(apply(x)) === apply(x)`) for every policy, because an invalid policy is repaired before use:
 *    a replacement that carries a forbidden character falls back to its default, and an extra character that a replacement contains
 *    is not treated as extra. {@link validatePolicy} names those fields so a settings tab can refuse the input with a reason.
 *  - `checkSegment(x)` is empty exactly when `applyPolicy(x).changed` is false. Hits are in UTF-16 units of the INPUT; the edge, length
 *    and empty hits can overlap a rule hit (a space that a replacement brought in and the edge rule removed again).
 *  - Length is measured in UTF-8 bytes of the whole name and never exceeds 255; `maxBytes` (0 = off, else 32 to 255) lowers it. The cut
 *    falls between code points, keeps the extension and trims a space or dot the cut leaves at the end.
 *  - Known edge: a name that is only an extension (`.md`) has an empty stem and becomes `Untitled.md`. Obsidian lists no dot files, so
 *    the plugin never meets one. */

export type SegmentKind = "file" | "folder";

export type RuleId =
  | "colon-space"
  | "colon"
  | "question"
  | "star"
  | "quote"
  | "lt"
  | "gt"
  | "backslash"
  | "slash"
  | "pipe"
  | "hash"
  | "caret"
  | "bracket-open"
  | "bracket-close"
  | "extra"
  | "control"
  | "edge"
  | "length"
  | "empty";

/** The rules whose replacement is a setting. */
export type ReplaceableRule = Exclude<RuleId, "extra" | "control" | "edge" | "length" | "empty">;

export interface FilenamePolicy {
  /** What replaces each forbidden character. May be empty (the character goes); must not contain a forbidden character. */
  replacements: Readonly<Record<ReplaceableRule, string>>;
  /** Further characters to replace, one code point each. */
  extraChars: string;
  extraReplacement: string;
  /** UTF-8 byte limit of the whole name; 0 = off. Otherwise 32 to 255. */
  maxBytes: number;
}

/** One finding. `index`/`length` are UTF-16 units of the input segment; `replacement` is what the name got there (may be empty).
 *  Named `FilenameHit`, not `Hit`: `vector-index` already exports a `Hit`, and the barrel re-exports both. */
export interface FilenameHit {
  rule: RuleId;
  index: number;
  length: number;
  replacement: string;
}

export interface PolicyProblem {
  field: ReplaceableRule | "extraReplacement" | "maxBytes";
  /** The forbidden characters found (each once, in order); for `maxBytes` the rejected value as text. */
  badChars: string;
}

const RULES: readonly ReplaceableRule[] = [
  "colon-space",
  "colon",
  "question",
  "star",
  "quote",
  "lt",
  "gt",
  "backslash",
  "slash",
  "pipe",
  "hash",
  "caret",
  "bracket-open",
  "bracket-close",
];

const DEFAULT_REPLACEMENTS: Readonly<Record<ReplaceableRule, string>> = Object.freeze({
  "colon-space": " — ",
  colon: "-",
  question: "",
  star: "_",
  quote: "'",
  lt: "",
  gt: "",
  backslash: "-",
  slash: "-",
  pipe: "-",
  hash: " ",
  caret: " ",
  "bracket-open": "(",
  "bracket-close": ")",
});

export const DEFAULT_FILENAME_POLICY: FilenamePolicy = Object.freeze({
  replacements: DEFAULT_REPLACEMENTS,
  extraChars: "",
  extraReplacement: "",
  maxBytes: 0,
});

/** The forbidden characters that have a rule of their own (`colon-space` is the colon followed by a space). */
const CHAR_RULE: ReadonlyMap<string, ReplaceableRule> = new Map<string, ReplaceableRule>([
  [":", "colon"],
  ["?", "question"],
  ["*", "star"],
  ['"', "quote"],
  ["<", "lt"],
  [">", "gt"],
  ["\\", "backslash"],
  ["/", "slash"],
  ["|", "pipe"],
  ["#", "hash"],
  ["^", "caret"],
  ["[", "bracket-open"],
  ["]", "bracket-close"],
]);

const HARD_MAX_BYTES = 255;
const MIN_MAX_BYTES = 32;
const UNTITLED = "Untitled";
const EXTENSION = /\.[A-Za-z0-9]{1,16}$/;

function isControl(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x20 || c === 0x7f;
}

function utf8Length(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}

/** Each forbidden character of `text` once, in order of appearance. */
function badCharsOf(text: string, extra: ReadonlySet<string>): string {
  const seen = new Set<string>();
  for (const ch of text) {
    if (CHAR_RULE.has(ch) || isControl(ch) || extra.has(ch)) seen.add(ch);
  }
  return [...seen].join("");
}

function validMaxBytes(n: number): boolean {
  return n === 0 || (Number.isInteger(n) && n >= MIN_MAX_BYTES && n <= HARD_MAX_BYTES);
}

/** The fields of `policy` that the rules cannot work with, empty when it is usable. */
export function validatePolicy(policy: FilenamePolicy): PolicyProblem[] {
  const extra = new Set<string>(Array.from(policy.extraChars));
  const problems: PolicyProblem[] = [];
  for (const rule of RULES) {
    const bad = badCharsOf(policy.replacements[rule], extra);
    if (bad !== "") problems.push({ field: rule, badChars: bad });
  }
  const bad = badCharsOf(policy.extraReplacement, extra);
  if (bad !== "") problems.push({ field: "extraReplacement", badChars: bad });
  if (!validMaxBytes(policy.maxBytes)) problems.push({ field: "maxBytes", badChars: String(policy.maxBytes) });
  return problems;
}

interface Effective {
  replacements: Record<ReplaceableRule, string>;
  extraReplacement: string;
  extra: ReadonlySet<string>;
  limit: number;
}

/** `policy` with every invalid field put back to its default, so that the rules stay idempotent for any input. */
function effective(policy: FilenamePolicy): Effective {
  const replacements = { ...policy.replacements };
  let extraReplacement = policy.extraReplacement;
  let maxBytes = policy.maxBytes;
  for (const p of validatePolicy(policy)) {
    if (p.field === "maxBytes") maxBytes = 0;
    else if (p.field === "extraReplacement") extraReplacement = "";
    else replacements[p.field] = DEFAULT_REPLACEMENTS[p.field];
  }
  // A character that a replacement itself contains cannot also be replaced: the second run would replace it again.
  const produced = new Set<string>();
  for (const rule of RULES) for (const ch of replacements[rule]) produced.add(ch);
  for (const ch of extraReplacement) produced.add(ch);
  const extra = new Set<string>(Array.from(policy.extraChars).filter((ch) => !produced.has(ch) && !CHAR_RULE.has(ch) && !isControl(ch)));
  return { replacements, extraReplacement, extra, limit: maxBytes > 0 ? maxBytes : HARD_MAX_BYTES };
}

/** One code point of the output with the part of the input it stands for. */
interface Unit {
  ch: string;
  start: number;
  end: number;
}

function isEdge(u: Unit | undefined): boolean {
  return u !== undefined && (u.ch === " " || u.ch === ".");
}

function bytesOf(units: readonly Unit[]): number {
  let n = 0;
  for (const u of units) n += utf8Length(u.ch);
  return n;
}

function edgeHit(units: readonly Unit[]): FilenameHit | null {
  const first = units[0];
  const last = units[units.length - 1];
  if (first === undefined || last === undefined) return null;
  return { rule: "edge", index: first.start, length: last.end - first.start, replacement: "" };
}

function run(name: string, policy: FilenamePolicy, kind: SegmentKind): { name: string; hits: FilenameHit[] } {
  const eff = effective(policy);
  const hits: FilenameHit[] = [];

  // 1. Replace the forbidden characters.
  const units: Unit[] = [];
  let i = 0;
  while (i < name.length) {
    const ch = String.fromCodePoint(name.codePointAt(i) ?? 0);
    let rule: RuleId | undefined;
    let replacement = "";
    let consumed = ch.length;
    if (ch === ":" && name[i + 1] === " ") {
      rule = "colon-space";
      replacement = eff.replacements["colon-space"];
      consumed = 2;
    } else if (CHAR_RULE.has(ch)) {
      const r = CHAR_RULE.get(ch) as ReplaceableRule;
      rule = r;
      replacement = eff.replacements[r];
    } else if (isControl(ch)) {
      rule = "control";
    } else if (eff.extra.has(ch)) {
      rule = "extra";
      replacement = eff.extraReplacement;
    }
    if (rule === undefined) {
      units.push({ ch, start: i, end: i + ch.length });
      i += ch.length;
      continue;
    }
    const endsWithSpace = units[units.length - 1]?.ch === " ";
    // A space the replacement would put next to a space that is already there is left out.
    if (endsWithSpace && replacement.startsWith(" ")) replacement = replacement.slice(1);
    const spaceAfter = replacement === "" ? endsWithSpace : replacement.endsWith(" ");
    if (spaceAfter) while (name[i + consumed] === " ") consumed++;
    for (const c of replacement) units.push({ ch: c, start: i, end: i + consumed });
    hits.push({ rule, index: i, length: consumed, replacement });
    i += consumed;
  }

  // 2. Spaces and dots at the end of the whole name go first: they decide where the extension is.
  let tail = units.length;
  while (tail > 0 && isEdge(units[tail - 1])) tail--;
  const tailHit = edgeHit(units.slice(tail));
  if (tailHit !== null) hits.push(tailHit);
  units.length = tail;

  // 3. Split off the extension of a file.
  let extLen = 0;
  if (kind === "file") {
    const m = EXTENSION.exec(units.map((u) => u.ch).join(""));
    if (m !== null) extLen = m[0].length;
  }
  const ext = units.slice(units.length - extLen);
  let stem = units.slice(0, units.length - extLen);

  // 4. Spaces and dots at the edge of the stem.
  let lead = 0;
  while (lead < stem.length && isEdge(stem[lead])) lead++;
  const leadHit = edgeHit(stem.slice(0, lead));
  if (leadHit !== null) hits.push(leadHit);
  stem = stem.slice(lead);
  stem = trimEnd(stem, hits);

  // 5. Length: cut the stem, then trim what the cut left at its end.
  const budget = eff.limit - bytesOf(ext);
  if (bytesOf(stem) > budget) {
    let keep = 0;
    let used = 0;
    while (keep < stem.length && used + utf8Length(stem[keep]?.ch ?? "") <= budget) {
      used += utf8Length(stem[keep]?.ch ?? "");
      keep++;
    }
    const cut = stem.slice(keep);
    const first = cut[0];
    const last = cut[cut.length - 1];
    if (first !== undefined && last !== undefined) {
      hits.push({ rule: "length", index: first.start, length: last.end - first.start, replacement: "" });
    }
    stem = trimEnd(stem.slice(0, keep), hits);
  }

  // 6. Never an empty name.
  let stemText = stem.map((u) => u.ch).join("");
  if (stemText === "") {
    stemText = UNTITLED;
    hits.push({ rule: "empty", index: 0, length: ext[0]?.start ?? name.length, replacement: UNTITLED });
  }

  hits.sort((a, b) => a.index - b.index);
  return { name: stemText + ext.map((u) => u.ch).join(""), hits };
}

function trimEnd(stem: Unit[], hits: FilenameHit[]): Unit[] {
  let end = stem.length;
  while (end > 0 && isEdge(stem[end - 1])) end--;
  const hit = edgeHit(stem.slice(end));
  if (hit !== null) hits.push(hit);
  return stem.slice(0, end);
}

/** Where `name` breaks the policy; empty when it does not. */
export function checkSegment(name: string, policy: FilenamePolicy, kind: SegmentKind): FilenameHit[] {
  return run(name, policy, kind).hits;
}

/** A folder path from a setting (a log folder, an export folder): every segment must be a valid FOLDER name under the policy
 *  ({@link checkSegment} with kind `"folder"` finds nothing), and the first one must not start with `.` (Obsidian neither shows nor
 *  syncs hidden folders). `raw` is trimmed and loses the slashes at both ends; the folder comes back like that, its inner segments
 *  untouched. Refused: an empty path, an empty segment (`a//b`), `.` and `..`, a hidden first folder, a segment the policy would
 *  change. `bad` names what was refused: the segment, or for an empty segment the whole folder, or for an empty path the trimmed input.
 *
 *  The explicit refusals of the empty segment, `.`, `..` and the hidden first folder overlap with what `checkSegment` finds for kind `"folder"`
 *  today (the `empty` and `edge` rules); they stay so the verdict and the `bad` text do not depend on how the engine words those rules.
 *
 *  Origin: `checkLogFolder` of the `filename-sanitizer` plugin (`src/core/settings.ts`), lifted with the policy it checks against. */
export function checkFolderPath(raw: string, policy: FilenamePolicy): { ok: true; folder: string } | { ok: false; bad: string } {
  const folder = raw.trim().replace(/^\/+|\/+$/g, "");
  if (folder === "") return { ok: false, bad: raw.trim() };
  const segments = folder.split("/");
  const first = segments[0] ?? "";
  if (first.startsWith(".") && first !== "." && first !== "..") return { ok: false, bad: first };
  for (const segment of segments) {
    const name = segment.trim();
    if (name === "" || name === "." || name === ".." || checkSegment(name, policy, "folder").length > 0) return { ok: false, bad: name === "" ? folder : name };
  }
  return { ok: true, folder };
}

/** `name` brought into line with the policy. Idempotent, never empty. */
export function applyPolicy(
  name: string,
  policy: FilenamePolicy,
  kind: SegmentKind,
): { name: string; changed: boolean; hits: FilenameHit[] } {
  const r = run(name, policy, kind);
  return { name: r.name, changed: r.name !== name, hits: r.hits };
}

/** How the number of a collision is written: `space` is `a 2.md`, `paren` is `a (2).md` (Obsidian's own duplicate convention, what
 *  letterhead, yijing-oracle, epub-exporter and calendar-notes write), `dash` is `a-2.md` (image-to-markdown, mailstone,
 *  local-image-generator). The plugins differ only by history; the kit offers all three. */
export type NumberStyle = "space" | "paren" | "dash";

const numberTag = (n: number, style: NumberStyle): string => (style === "paren" ? ` (${String(n)})` : style === "dash" ? `-${String(n)}` : ` ${String(n)}`);

/** `name` with the number in front of the extension of a file (the last `.` and 1 to 16 letters or digits, so a path works too: only its
 *  last segment is looked at), or at the end of a folder name; `n` below 2 leaves the name as it is. `style` defaults to `space`. */
export function numberedName(name: string, kind: SegmentKind, n: number, style: NumberStyle = "space"): string {
  if (n < 2) return name;
  const m = kind === "file" ? EXTENSION.exec(name) : null;
  if (m === null) return `${name}${numberTag(n, style)}`;
  return `${name.slice(0, name.length - m[0].length)}${numberTag(n, style)}${m[0]}`;
}

export interface FirstFreeOptions {
  /** How the number is written. Default `space`. */
  style?: NumberStyle;
  /** The highest number tried, a whole number of at least 1 (1 asks for the name only). Default 10 000: a lying `exists` cannot loop forever. */
  limit?: number;
  /** What to return when every number up to `limit` is taken (calendar-notes appends a hash of the UID after 99 tries). Without it the
   *  function throws a `RangeError`. */
  onExhausted?: (name: string, limit: number) => string;
}

const DEFAULT_FREE_LIMIT = 10_000;

function freeLimit(opts: FirstFreeOptions): number {
  const limit = opts.limit ?? DEFAULT_FREE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`limit must be a whole number of at least 1, got ${String(limit)}`);
  return limit;
}

function exhausted(name: string, limit: number, opts: FirstFreeOptions): string {
  if (opts.onExhausted !== undefined) return opts.onExhausted(name, limit);
  throw new RangeError(`no free name for ${JSON.stringify(name)} among the first ${String(limit)} numbers`);
}

/** The first of `name`, then `name` numbered 2, 3, … ({@link numberedName}) that `exists` does not know. `exists` is the caller's: it may
 *  look at a vault, a set, two sources at once, or a pair of paths that must stay together (mailstone's note and its `.eml`). Carries the
 *  seven private "first free name" loops of the plugins; what stays different on purpose (chat-archive's case-insensitive, byte-clipped
 *  `uniqueChatFileName`) is in `docs/internal/decisions.md`. */
export function firstFreeName(name: string, kind: SegmentKind, exists: (candidate: string) => boolean, opts: FirstFreeOptions = {}): string {
  const limit = freeLimit(opts);
  const style = opts.style ?? "space";
  for (let n = 1; n <= limit; n++) {
    const candidate = numberedName(name, kind, n, style);
    if (!exists(candidate)) return candidate;
  }
  return exhausted(name, limit, opts);
}

/** {@link firstFreeName} for an `exists` that answers asynchronously (an adapter). Same order, same limits. */
export async function firstFreeNameAsync(
  name: string,
  kind: SegmentKind,
  exists: (candidate: string) => Promise<boolean>,
  opts: FirstFreeOptions = {},
): Promise<string> {
  const limit = freeLimit(opts);
  const style = opts.style ?? "space";
  for (let n = 1; n <= limit; n++) {
    const candidate = numberedName(name, kind, n, style);
    if (!(await exists(candidate))) return candidate;
  }
  return exhausted(name, limit, opts);
}
