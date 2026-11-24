// vendored from code-kit@0.87.0, src/ts/pure/frontmatter-field.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-letterhead@e500827 src/core/frontmatter.ts:63-84 (`norm`, `buildFmIndex`, `getField`), lifted and extended (Welle 36, h1, order 3 of the
// hypertext-exporter design, spec sections 7.2, 7.3, 10, 14). Second carrier: epub-exporter src/core/frontmatter.ts (`ALIASES`, `pick`), which reads
// the exact key only and therefore does not find `Titel` or `chapter title`; it stays as it is until the breadth moves it.
// letterhead's three tests are copied into tests/frontmatter-field.test.ts and pass unchanged against this version.
//
// What it does: read one field of a frontmatter object by an alias list, tolerant of case, `_`, `-` and white space in the KEY, with a dot path
// into nested objects (`modelle.verdigado-pro.personas_genannt`). It READS: the value comes back as it is (same reference), no conversion to text or
// number, no splitting of a string into lines. A field that is missing, `null` or `""` is `undefined`; `0`, `false`, `[]` and `" "` are values.
//
// Order, in `readField`: the mapping (field → the name this folder uses), then the alias list, then the field's own name (the canonical form).
// The first one that holds a value wins; `getField` alone reads an alias list in the order given.
//
// Differences from letterhead's carrier, each with its reason:
//   * the dot is NOT stripped from a key (letterhead's `norm` removed `[\s_\-.]`): it is the path separator here. A flat key that contains a dot
//     (`"Flach.Name"`) is found by the whole alias first, then the alias is read as a path. A letterhead note with a key like `Ihr.Zeichen` no
//     longer matches the alias `ihrzeichen`; measured in letterhead's tests and sources 2026-11-19: no such key, no such alias.
//   * keys are folded with `foldCase` (NFC, then lower/upper/lower), not with `toLowerCase`: an umlaut typed as `a` + U+0308 (macOS file names, pasted
//     text) is the same key as the composed one, and `Straße` is `STRASSE`. Same reason `folder-scope` uses it; no second way to fold a name.
//   * the index is a null-prototype object and is read by own key only: letterhead's `{}` answers `getField(idx, ["constructor"])` with `Object`
//     (the function), a value that was never in the note. Measured by the "constructor" row of the hostile-input test.
//   * an alias that is empty, not a string or only separators (`"_"`) matches nothing: letterhead's `idx[""]` would match a note with the key `_`.
//   * two keys of one note that fold to the same key (`Title`, `title`): the later one in the object wins, as in letterhead; YAML keys are unique per
//     spelling, the author wrote both and the file order is theirs.
//   * nested objects only: a path step through an array, a `Date`, a scalar or `null` is `undefined` (`m.0`, `m.length` are not paths).
// Pure, no import of a host, no I/O, never throws on user input; every regular expression is one character class in one pass (linear).

import { foldCase } from "./fold-case";

/** A frontmatter object indexed by folded top-level key. Opaque: build it with {@link buildFmIndex}. */
export type FmIndex = Readonly<Record<string, unknown>>;

/** A field as `{ field: key-or-path used in this folder }`, for example `{ title: "name" }`. */
export type FieldMapping = Readonly<Record<string, string>>;

const INDEXES = new WeakSet<object>();
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** A frontmatter key or alias as it is compared: folded ({@link foldCase}), then `_`, `-` and white space removed. The dot stays (path separator).
 *  A non-string is the empty key. */
export function normFieldKey(key: unknown): string {
  return typeof key === "string" ? foldCase(key).replace(/[\s_-]+/g, "") : "";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Index a note's top-level keys by {@link normFieldKey}. A value that is not a plain object (`null`, a string, an array) is an empty note. */
export function buildFmIndex(fm: unknown): FmIndex {
  const idx: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (isPlainObject(fm)) {
    for (const k of Object.keys(fm)) idx[normFieldKey(k)] = fm[k];
  }
  INDEXES.add(idx);
  return idx;
}

const isSet = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

function child(obj: unknown, segment: string): unknown {
  if (!isPlainObject(obj)) return undefined;
  let found: unknown;
  for (const k of Object.keys(obj)) if (normFieldKey(k) === segment) found = obj[k];
  return found;
}

function lookup(idx: FmIndex, alias: unknown): unknown {
  const key = normFieldKey(alias);
  if (key === "") return undefined;
  if (hasOwn(idx, key)) {
    const flat = idx[key];
    if (isSet(flat)) return flat;
  }
  if (!key.includes(".")) return undefined;
  const segments = key.split(".");
  if (segments.some((s) => s === "")) return undefined;
  const [head = "", ...rest] = segments;
  let cur: unknown = hasOwn(idx, head) ? idx[head] : undefined;
  for (const segment of rest) {
    if (cur === undefined) break;
    cur = child(cur, segment);
  }
  return isSet(cur) ? cur : undefined;
}

/** The first alias that holds a value, in the order given; `undefined` when none does (never `""`). An alias may be a dot path. */
export function getField(idx: FmIndex, aliases: readonly string[]): unknown {
  if (!Array.isArray(aliases)) return undefined;
  for (const a of aliases) {
    const v = lookup(idx, a);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Read `field` from a note (or an index built by {@link buildFmIndex}): first the name the folder's `mapping` gives for it, then `aliases` in order,
 *  then `field` itself. A mapped name may be a dot path. `undefined` when none holds a value. */
export function readField(source: unknown, field: string, aliases: readonly string[], mapping?: FieldMapping | null): unknown {
  const idx = typeof source === "object" && source !== null && INDEXES.has(source) ? (source as FmIndex) : buildFmIndex(source);
  const names: unknown[] = [];
  // A mapped value that is missing, empty, not a string, or inherited from the prototype (`constructor`) is not a string key, so `lookup` skips it (the empty key).
  if (typeof mapping === "object" && mapping !== null) names.push(mapping[field]);
  if (Array.isArray(aliases)) names.push(...(aliases as readonly unknown[]));
  names.push(field);
  return getField(idx, names as string[]);
}
