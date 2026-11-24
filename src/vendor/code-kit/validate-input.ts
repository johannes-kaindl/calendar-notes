// vendored from code-kit@0.87.0, src/ts/pure/validate-input.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Checks a tool call's arguments against the JSON Schema that describes the tool — a small subset of it (flat, and nested objects since
 *  order 12, see below), and an honest one: what it does not judge it can name ({@link unsupportedSchemaKeywords}).
 *
 *  Origin: calendar-notes `src/core/commands/schema.ts` (`validateInput`, the first fix 2026-08-23) and its copy in
 *  mailstone (2026-08-30, with three changes of its own); vault-rag's `check()` per tool and koda-agent's argument
 *  readers are hand-written and do not interpret a schema — they are the reason for the options (`unknownFields`) and for
 *  `integer`. Measured 2026-10-16 over every tool definition in koda-agent (16), calendar-notes (6 + 21 commands) and
 *  vault-rag (2): the schemas use `type` object/string/integer/boolean/array (no `number`, no nested object, no array of
 *  objects), `properties`, `required`, `enum` (strings), `minLength`, `minimum`/`maximum`, `format` (date-time, date, email,
 *  uri, multiline), `items` (strings), plus the annotations `description`/`descriptionKey`. Nothing else occurs: no
 *  `pattern`, `maxLength`, `oneOf`/`anyOf`/`allOf`, `minItems`, `additionalProperties`, `nullable`, `const`.
 *
 *  The subset:
 *
 *  | schema | checked |
 *  |---|---|
 *  | root | `type` absent or `"object"`; `properties` (absent = none); `required` |
 *  | `string` | `minLength` (UTF-16 code units), `enum` (strings), `format` |
 *  | `integer`, `number` | `Number.isInteger` / `Number.isFinite`, `minimum`, `maximum` |
 *  | `boolean` | `typeof` |
 *  | `array` | `Array.isArray`; `items` `{ type: "string", format? }` per element, no `items` = elements not judged |
 *  | `object` (a field, or an element) | `properties`, `required`, `exactlyOne`, recursively; see "Nested schemas" |
 *
 *  `format`: `date` is `YYYY-MM-DD` of a day that exists (the empty string means "not set" and passes — a required field
 *  is caught by the required rule first); `date-time` is `YYYY-MM-DD` + `T` or a space + `HH:MM[:SS]` + optional `Z`, a
 *  real date and a real time, **no offset** (calendar-notes ruling C1: an accepted offset that the consumer's parser ignores
 *  is silent data loss — deliberately stricter than RFC 3339); `email` is "contains `@`"; `uri` and `multiline` are known
 *  names that are not judged; any other format name is an annotation and ignored.
 *
 *  Unknown fields are an error by default; a required string that is empty or only whitespace is missing; all problems
 *  are collected, required first, then the fields in the order of the input. Values are never converted (`"5"` is not
 *  a number) — a form that sends strings converts first. `null` is a value, not an absent one.
 *
 *  Never throws, for any schema (including values JSON cannot carry: BigInt, cycles, symbols) and any input a parse of JSON can give: a schema the module cannot read gives an issue with the code `bad-schema`, a
 *  field whose type it cannot judge gives `unsupported-type`. The messages are English and stable; a host that shows
 *  German text maps the `code` (and `path`) from {@link inputIssues}.
 *
 *  **Nested schemas (Welle 36, h1b, order 12 of the hypertext-exporter design, spec 10.10).** A field may be `type: "object"` (with
 *  `properties`, `required`, `exactlyOne`) and an array's `items` may be an object schema, or a LIST of alternatives chosen by the
 *  type of each element (`[{ type: "string" }, { type: "object", … }]`: a source is a path or a path with a key). Issues carry the path
 *  of the place (`sections[2].overview[0]`, `fold.headings_from`). Added keywords, all optional, a flat schema reads as before:
 *  - `exactlyOne: ["folder", "note", "source"]` on an object: exactly one of these names must be given (a blank text does not count),
 *    else the code `one-of`; the alias of a name counts as the name.
 *  - `aliases: ["ordner"]` on a field: the field is found under its name and each alias, tolerant of case, `_`, `-` and blanks
 *    (`normFieldKey` of `frontmatter-field`); a field WITHOUT `aliases` is found under its exact name only, which is what a flat schema
 *    always did. Two keys of one object that are the same field (`folder` and `Ordner`) are the code `duplicate-key`; the one spelled as the
 *    field's name (else the first) is the one that is checked. Nothing is renamed or copied: read the value afterwards with
 *    `readField(note, name, aliases)`, the aliases being the ones the schema lists.
 *  - `futureValues: { live: "valid from version 2" }` on a string field: a value that is not in `enum` but is named there gets that
 *    sentence in its message (code `not-in-enum` as ever): "an unknown VALUE of a known key is an error that says from which version it holds".
 *  - `unknownFields: "warn"` (option): an unknown key is an issue with `severity: "warning"` instead of an error, at every level; a
 *    reader of a newer version stays readable. `validateInput` then returns the warnings next to `ok: true` (`warnings`, only when there are some).
 *  Depth is limited to 32 levels (`too-deep`), so a hostile input cannot overflow the stack.
 *
 *  Pure, no I/O. The only regular expressions are anchored and of fixed length; the rest is string scanning, so run time
 *  is linear in the input (tests at 1 000 / 10 000 / 50 000). */

import { normFieldKey } from "./frontmatter-field";

export type StringFormat = "date-time" | "date" | "email" | "uri" | "multiline";

export type FieldSchema =
  | { type: "string"; format?: StringFormat; enum?: string[]; futureValues?: Record<string, string>; minLength?: number; aliases?: string[]; description?: string; descriptionKey?: string; default?: string }
  | { type: "number" | "integer"; minimum?: number; maximum?: number; aliases?: string[]; description?: string; descriptionKey?: string; default?: number }
  | { type: "boolean"; aliases?: string[]; description?: string; descriptionKey?: string; default?: boolean }
  | { type: "array"; items?: ItemSchema | ItemSchema[]; aliases?: string[]; description?: string; descriptionKey?: string }
  | NestedObjectSchema;

/** One element of a list: a text, or an object. */
export type ItemSchema = { type: "string"; format?: StringFormat } | NestedObjectSchema;

/** An object inside an object or a list, see the header. */
export interface NestedObjectSchema {
  type: "object";
  properties?: Record<string, FieldSchema>;
  required?: string[];
  exactlyOne?: string[];
  aliases?: string[];
  description?: string;
  descriptionKey?: string;
}

export interface ObjectSchema {
  type?: "object";
  properties?: Record<string, FieldSchema>;
  required?: string[];
  /** Exactly one of these names must be given. */
  exactlyOne?: string[];
  /** Only `false` is understood and is what the module does anyway; anything else is named by {@link unsupportedSchemaKeywords}. */
  additionalProperties?: false;
}

export type IssueCode =
  | "not-object" | "missing" | "unknown-field" | "type" | "too-short" | "not-in-enum" | "format"
  | "below-minimum" | "above-maximum" | "unsupported-type" | "bad-schema" | "one-of" | "duplicate-key" | "too-deep";

/** One problem. `path` is `field`, `field[2]`, `sections[2].overview[0]` or `""` (the input itself, or the schema). `message` is `path: text`.
 *  `severity` is `"warning"` only for an unknown key under `unknownFields: "warn"`; every other issue leaves it out, and an issue without it is an
 *  error (so a list built by an older vendored copy, or by hand, reads as before). */
export interface ValidationIssue { path: string; code: IssueCode; message: string; severity?: "error" | "warning" }

export type ValidationResult =
  | { ok: true; value: Record<string, unknown>; warnings?: string[] }
  | { ok: false; errors: string[]; warnings?: string[] };

export interface ValidateOptions {
  /** `"reject"` (default): a field the schema does not name is an error. `"ignore"`: it is left out of `value` and
   *  not an error (vault-rag and koda-agent read only the schema's fields). `"warn"`: it is a warning (`severity`), not an error, at every
   *  level; `value` keeps it. */
  unknownFields?: "reject" | "ignore" | "warn";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A schema value as text for a message: a string as it is, anything else as JSON (`undefined` when it has none). */
const show = (v: unknown): string => {
  try { return typeof v === "string" ? v : JSON.stringify(v) ?? "undefined"; } catch { return typeof v; } // BigInt, cycles, a throwing toJSON
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?Z?$/;

function dayExists(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
  return d <= days;
}

function formatProblem(format: unknown, value: string): string | null {
  switch (format) {
    case "date": {
      if (value === "") return null;
      const m = DATE_RE.exec(value);
      return m && dayExists(Number(m[1]), Number(m[2]), Number(m[3])) ? null : "must be a date (YYYY-MM-DD)";
    }
    case "date-time": {
      const m = DATE_TIME_RE.exec(value);
      const ok = m !== null && dayExists(Number(m[1]), Number(m[2]), Number(m[3]))
        && Number(m[4]) <= 23 && Number(m[5]) <= 59 && (m[6] === undefined || Number(m[6]) <= 59);
      return ok ? null : "must be a date and time (YYYY-MM-DD[T]HH:MM[:SS][Z], no offset)";
    }
    case "email":
      return value.includes("@") ? null : "not a valid e-mail address";
    default:
      return null; // uri, multiline: known, not judged; any other name is an annotation
  }
}

const MAX_DEPTH = 32;

type UnknownMode = "reject" | "ignore" | "warn";
interface Ctx { unknown: UnknownMode }

const isNames = (v: unknown): v is string[] => Array.isArray(v) && v.every((k): k is string => typeof k === "string");

/** What is wrong with an object schema's own keywords (not with its fields), as text, or `null`. The texts of the first three are the ones the flat root always gave. */
function objectSchemaProblem(s: Record<string, unknown>): string | null {
  const props = s["properties"] ?? {};
  if (!isObj(props)) return "properties must be an object";
  const required: unknown = s["required"] ?? [];
  if (!isNames(required)) return "required must be a list of names";
  // A required name the schema does not list can never be satisfied in reject mode and is a lie in ignore mode (it would
  // count as given and not appear in `value`).
  const orphans = required.filter((k) => !Object.hasOwn(props, k));
  if (orphans.length > 0) return `required names a field that is not in properties: ${[...new Set(orphans)].join(", ")}`;
  const one = s["exactlyOne"];
  if (one !== undefined) {
    if (!isNames(one) || one.length === 0) return "exactlyOne must be a non-empty list of names";
    const lost = one.filter((k) => !Object.hasOwn(props, k));
    if (lost.length > 0) return `exactlyOne names a field that is not in properties: ${[...new Set(lost)].join(", ")}`;
  }
  for (const [name, def] of Object.entries(props)) {
    if (isObj(def) && def["aliases"] !== undefined && !isNames(def["aliases"])) return `aliases of ${name} must be a list of names`;
  }
  return null;
}

const given = (v: unknown): boolean => v !== undefined && !(typeof v === "string" && v.trim() === "");

/** An object against its schema (already known to be readable), `path` is where it sits (`""` for the root). Collects, never throws. */
function checkObject(path: string, s: Record<string, unknown>, input: Record<string, unknown>, out: ValidationIssue[], ctx: Ctx, depth: number): void {
  const at = (key: string): string => (path === "" ? key : `${path}.${key}`);
  const push = (p: string, code: IssueCode, text: string, warning = false): void => {
    out.push({ path: p, code, message: p === "" ? text : `${p}: ${text}`, ...(warning ? { severity: "warning" as const } : {}) });
  };
  if (depth > MAX_DEPTH) { push(path, "too-deep", `nested deeper than ${MAX_DEPTH} levels`); return; }
  const props = (s["properties"] ?? {}) as Record<string, unknown>;

  // Which field a key is: its exact name, else (only for a field that lists `aliases`) its name or an alias, tolerant of case, `_`, `-`.
  const byNorm = new Map<string, string>();
  for (const [name, def] of Object.entries(props)) {
    if (!isObj(def) || !Array.isArray(def["aliases"])) continue;
    for (const a of [name, ...(def["aliases"] as unknown[])]) {
      const n = normFieldKey(a);
      if (n !== "" && !byNorm.has(n)) byNorm.set(n, name);
    }
  }
  const fieldOf = (key: string): string | null => (Object.hasOwn(props, key) ? key : (byNorm.get(normFieldKey(key)) ?? null));

  // The spelling that counts for each field: the one spelled as the field's name, else the first in the input.
  const winner = new Map<string, string>();
  for (const key of Object.keys(input)) {
    const name = fieldOf(key);
    if (name === null) continue;
    const prior = winner.get(name);
    if (prior === undefined || (key === name && prior !== name)) winner.set(name, key);
  }
  const valueOf = (name: string): unknown => {
    const key = winner.get(name);
    return key === undefined ? undefined : input[key];
  };

  const missing = new Set<string>();
  for (const name of new Set((s["required"] ?? []) as string[])) {
    if (!given(valueOf(name))) {
      missing.add(name);
      push(at(name), "missing", "missing (required)");
    }
  }
  const one = s["exactlyOne"];
  if (isNames(one)) {
    const names = [...new Set(one)];
    const present = names.filter((name) => given(valueOf(name)));
    if (present.length === 0) push(path, "one-of", `exactly one of ${names.join(", ")} is required`);
    else if (present.length > 1) push(path, "one-of", `only one of ${names.join(", ")} may be given (got ${present.join(" and ")})`);
  }

  for (const [key, value] of Object.entries(input)) {
    const name = fieldOf(key);
    if (name === null) {
      if (ctx.unknown !== "ignore") push(at(key), "unknown-field", "unknown field", ctx.unknown === "warn");
      continue;
    }
    if (winner.get(name) !== key) {
      push(at(name), "duplicate-key", `given twice (as "${winner.get(name) ?? name}" and "${key}")`);
      continue;
    }
    if (value === undefined || missing.has(name)) continue;
    checkField(at(name), props[name], value, out, ctx, depth);
  }
}

/** A nested object schema is checked for its own keywords first; a broken one is one `bad-schema` at its place. */
function checkNested(path: string, schema: unknown, value: Record<string, unknown>, out: ValidationIssue[], ctx: Ctx, depth: number): void {
  const s = isObj(schema) ? schema : {};
  const problem = objectSchemaProblem(s);
  if (problem !== null) { out.push({ path, code: "bad-schema", message: `${path}: schema: ${problem}` }); return; }
  checkObject(path, s, value, out, ctx, depth + 1);
}

function checkField(path: string, schema: unknown, value: unknown, out: ValidationIssue[], ctx: Ctx, depth: number): void {
  const add = (code: IssueCode, text: string): void => { out.push({ path, code, message: `${path}: ${text}` }); };
  const s = isObj(schema) ? schema : {};
  switch (s["type"]) {
    case "string": {
      if (typeof value !== "string") { add("type", "must be a string"); return; }
      const min = s["minLength"];
      if (typeof min === "number" && value.length < min) add("too-short", `too short (min. ${min})`);
      const en = s["enum"];
      if (Array.isArray(en) && !en.includes(value)) {
        const future = s["futureValues"];
        const note = isObj(future) && Object.hasOwn(future, value) ? future[value] : undefined;
        if (typeof note === "string") add("not-in-enum", `"${value}" is not available yet (${note}); must be one of [${en.map(show).join(", ")}]`);
        else add("not-in-enum", `must be one of [${en.map(show).join(", ")}]`);
      }
      const fp = formatProblem(s["format"], value);
      if (fp !== null) add("format", fp);
      return;
    }
    case "number":
    case "integer": {
      const integer = s["type"] === "integer";
      if (typeof value !== "number" || !(integer ? Number.isInteger(value) : Number.isFinite(value))) { add("type", integer ? "must be an integer" : "must be a number"); return; }
      const min = s["minimum"], max = s["maximum"];
      if (typeof min === "number" && value < min) add("below-minimum", `below minimum ${min}`);
      if (typeof max === "number" && value > max) add("above-maximum", `above maximum ${max}`);
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") add("type", "must be a boolean");
      return;
    case "object":
      if (!isObj(value)) { add("type", "must be an object"); return; }
      checkNested(path, s, value, out, ctx, depth);
      return;
    case "array": {
      if (!Array.isArray(value)) { add("type", "must be an array"); return; }
      const items = s["items"];
      if (items === undefined) return;
      const alts: unknown[] = Array.isArray(items) ? items : [items];
      if (alts.length === 0) { add("unsupported-type", "items must not be an empty list"); return; }
      for (const alt of alts) {
        const t = isObj(alt) ? alt["type"] : undefined;
        if (t !== "string" && t !== "object") { add("unsupported-type", `unsupported schema type "${show(t)}" in items`); return; }
      }
      const asString = alts.find((a) => (a as Record<string, unknown>)["type"] === "string") as Record<string, unknown> | undefined;
      const asObject = alts.find((a) => (a as Record<string, unknown>)["type"] === "object");
      const wanted = asString && asObject ? "a string or an object" : asObject ? "an object" : "a string";
      // an index loop, not forEach: a hole in a sparse array is no string
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i];
        const p = `${path}[${i}]`;
        if (typeof item === "string" && asString) {
          const fp = formatProblem(asString["format"], item);
          if (fp !== null) out.push({ path: p, code: "format", message: `${p}: ${fp}` });
        } else if (isObj(item) && asObject) {
          checkNested(p, asObject, item, out, ctx, depth);
        } else {
          out.push({ path: p, code: "type", message: `${p}: must be ${wanted}` });
        }
      }
      return;
    }
    default:
      add("unsupported-type", `unsupported schema type "${show(s["type"])}"`);
  }
}

/** The problems of an input against a schema; an empty list means valid. See {@link validateInput}. */
export function inputIssues(schema: ObjectSchema, input: unknown, opts: ValidateOptions | null = {}): ValidationIssue[] {
  const bad = (text: string): ValidationIssue[] => [{ path: "", code: "bad-schema", message: `schema: ${text}` }];
  if (!isObj(schema)) return bad("must be an object");
  if (schema.type !== undefined && schema.type !== "object") return bad('type must be "object"');
  const problem = objectSchemaProblem(schema);
  if (problem !== null) return bad(problem);
  if (!isObj(input)) return [{ path: "", code: "not-object", message: "input is not an object" }];
  const out: ValidationIssue[] = [];
  const mode = opts?.unknownFields;
  checkObject("", schema, input, out, { unknown: mode === "ignore" || mode === "warn" ? mode : "reject" }, 0);
  return out;
}

/** `{ ok: true, value }` or `{ ok: false, errors }` (English, `path: text`, all of them). `value` is `input` itself, or with
 *  `unknownFields: "ignore"` a new object holding only the schema's top-level fields. `warnings` (the messages of the issues with
 *  `severity: "warning"`) is there only when there are some, on either side. Never throws. */
export function validateInput(schema: ObjectSchema, input: unknown, opts: ValidateOptions | null = {}): ValidationResult {
  const issues = inputIssues(schema, input, opts);
  const errors = issues.filter((i) => i.severity !== "warning").map((i) => i.message);
  const warned = issues.filter((i) => i.severity === "warning").map((i) => i.message);
  const warnings = warned.length > 0 ? { warnings: warned } : {};
  if (errors.length > 0) return { ok: false, errors, ...warnings };
  const o = input as Record<string, unknown>;
  if (opts?.unknownFields !== "ignore") return { ok: true, value: o, ...warnings };
  const props = schema.properties ?? {};
  return { ok: true, value: Object.fromEntries(Object.entries(o).filter(([k]) => Object.hasOwn(props, k))), ...warnings };
}

const ANNOTATIONS = new Set(["description", "descriptionKey", "default", "title", "examples", "$comment", "$schema", "$id"]);
const FORMATS = new Set<string>(["date-time", "date", "email", "uri", "multiline"]);
const FIELD_KEYWORDS: Record<string, readonly string[]> = {
  string: ["type", "format", "enum", "minLength", "aliases", "futureValues"],
  number: ["type", "minimum", "maximum", "aliases"],
  integer: ["type", "minimum", "maximum", "aliases"],
  boolean: ["type", "aliases"],
  array: ["type", "items", "aliases"],
  object: ["type", "properties", "required", "exactlyOne", "aliases"],
};

/** What a schema asks for that {@link validateInput} does not check, as sorted paths (`properties.a.pattern`,
 *  `properties.a.format=hostname`, `properties.o.type=map`, `oneOf`). Empty = the schema is inside the subset. A host that
 *  mounts tools from a third party calls this once per tool and decides: refuse, warn, or check that part itself. Silent
 *  gaps are the point — an argument the schema constrains and nobody checks passes as valid. */
export function unsupportedSchemaKeywords(schema: unknown): string[] {
  if (!isObj(schema)) return ["schema"];
  const found: string[] = [];
  for (const k of Object.keys(schema)) {
    if (ANNOTATIONS.has(k) || k === "type" || k === "properties" || k === "required" || k === "exactlyOne") continue;
    if (k === "additionalProperties" && schema[k] === false) continue;
    found.push(k);
  }
  if (schema["type"] !== undefined && schema["type"] !== "object") found.push(`type=${show(schema["type"])}`);
  if (schema["required"] !== undefined && !(Array.isArray(schema["required"]) && schema["required"].every((k) => typeof k === "string"))) found.push("required");
  if (schema["exactlyOne"] !== undefined && !isNames(schema["exactlyOne"])) found.push("exactlyOne");
  const props = schema["properties"];
  if (props !== undefined) {
    if (!isObj(props)) found.push("properties");
    else for (const [name, f] of Object.entries(props)) fieldGaps(`properties.${name}`, f, found, 0);
  }
  return found.sort();
}

function fieldGaps(path: string, f: unknown, found: string[], depth: number): void {
  if (!isObj(f)) { found.push(path); return; }
  if (depth > MAX_DEPTH) { found.push(`${path}.depth`); return; }
  const type = f["type"];
  const known = typeof type === "string" && Object.hasOwn(FIELD_KEYWORDS, type) ? FIELD_KEYWORDS[type] : undefined;
  if (known === undefined) { found.push(`${path}.type=${show(type)}`); return; }
  for (const k of Object.keys(f)) {
    if (!ANNOTATIONS.has(k) && !known.includes(k)) found.push(`${path}.${k}`);
  }
  // A keyword whose value the module cannot apply (`enum: "abc"`, `minLength: "3"`) is not checked either.
  const isNum = (v: unknown): boolean => typeof v === "number";
  if (f["enum"] !== undefined && !(Array.isArray(f["enum"]) && f["enum"].every((e) => typeof e === "string"))) found.push(`${path}.enum`);
  for (const k of ["minLength", "minimum", "maximum"]) if (f[k] !== undefined && !isNum(f[k])) found.push(`${path}.${k}`);
  if (type === "string" && f["format"] !== undefined && !(typeof f["format"] === "string" && FORMATS.has(f["format"]))) found.push(`${path}.format=${show(f["format"])}`);
  if (f["aliases"] !== undefined && !isNames(f["aliases"])) found.push(`${path}.aliases`);
  const future = f["futureValues"];
  if (future !== undefined && !(isObj(future) && Object.values(future).every((v) => typeof v === "string"))) found.push(`${path}.futureValues`);
  if (type === "object") {
    if (f["required"] !== undefined && !isNames(f["required"])) found.push(`${path}.required`);
    if (f["exactlyOne"] !== undefined && !isNames(f["exactlyOne"])) found.push(`${path}.exactlyOne`);
    const props = f["properties"];
    if (props !== undefined) {
      if (!isObj(props)) found.push(`${path}.properties`);
      else for (const [name, g] of Object.entries(props)) fieldGaps(`${path}.properties.${name}`, g, found, depth + 1);
    }
  }
  if (type === "array" && f["items"] !== undefined) {
    const items = f["items"];
    // One item schema keeps the path `items`; a list of alternatives is `items[0]`, `items[1]`.
    const alts: unknown[] = Array.isArray(items) ? items : [items];
    if (alts.length === 0) found.push(`${path}.items`);
    alts.forEach((alt, i) => {
      const at = Array.isArray(items) ? `${path}.items[${i}]` : `${path}.items`;
      if (!isObj(alt)) { found.push(at); return; }
      if (alt["type"] === "object") { fieldGaps(at, alt, found, depth + 1); return; }
      if (alt["type"] !== "string") found.push(`${at}.type=${show(alt["type"])}`);
      for (const k of Object.keys(alt)) if (k !== "type" && k !== "format" && !ANNOTATIONS.has(k)) found.push(`${at}.${k}`);
      if (alt["format"] !== undefined && !(typeof alt["format"] === "string" && FORMATS.has(alt["format"]))) found.push(`${at}.format=${show(alt["format"])}`);
    });
  }
}

/** The name of the first field whose list of choices is EMPTY (`type: "string"`, `enum: []`), else `null`.
 *
 *  Origin: mailstone `src/core/commands/schema.ts`. Such a field makes a form unusable: the dropdown shows no option and every attempt
 *  to send fails with `must be one of []`, cancelling is the only way out. A flow asks BEFORE it opens the form. A field with no `enum`
 *  at all is a free field and does not count. calendar-notes builds the same form without this check.
 *  Never throws, for a malformed schema either (it is no choice field). */
export function emptyChoiceField(schema: ObjectSchema): string | null {
  const props = isObj(schema) && isObj(schema.properties) ? schema.properties : {};
  for (const [name, field] of Object.entries(props)) {
    if (isObj(field) && field["type"] === "string" && Array.isArray(field["enum"]) && field["enum"].length === 0) return name;
  }
  return null;
}

/** The input that is already decided, or `null` when the user has something to decide. The counterpart of {@link emptyChoiceField} on
 *  the same axis: **no** option — the form is unusable and does not open; **one** option — there is nothing to choose and it need not
 *  open; **two or more** — the user chooses. (Confirmation in a preview stays, so no consent is lost, only a click without content.)
 *
 *  Only a field that is a choice with exactly one option is decided. NOT decided: a `default` (a pre-fill is a suggestion and wants to be
 *  edited), a switch (`false` is its start, not the user's decision), any free field. A schema without fields gives `{}`.
 *
 *  Origin: mailstone `src/core/commands/schema.ts`. Never throws; `null` for a schema that is no object. */
export function predeterminedInput(schema: ObjectSchema): Record<string, unknown> | null {
  if (!isObj(schema)) return null; // a schema nobody can read decides nothing
  const props = isObj(schema.properties) ? schema.properties : {};
  const out: [string, unknown][] = [];
  for (const [name, field] of Object.entries(props)) {
    if (!isObj(field) || field["type"] !== "string" || !Array.isArray(field["enum"]) || field["enum"].length !== 1) return null;
    out.push([name, field["enum"][0]]);
  }
  return Object.fromEntries(out);
}
