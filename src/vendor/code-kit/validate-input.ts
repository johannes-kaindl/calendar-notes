// vendored from code-kit@0.31.0, src/ts/pure/validate-input.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Checks a tool call's arguments against the JSON Schema that describes the tool — a small, flat subset of it, and
 *  an honest one: what it does not judge it can name ({@link unsupportedSchemaKeywords}).
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
 *  Pure, no I/O. The only regular expressions are anchored and of fixed length; the rest is string scanning, so run time
 *  is linear in the input (tests at 1 000 / 10 000 / 50 000). */

export type StringFormat = "date-time" | "date" | "email" | "uri" | "multiline";

export type FieldSchema =
  | { type: "string"; format?: StringFormat; enum?: string[]; minLength?: number; description?: string; descriptionKey?: string; default?: string }
  | { type: "number" | "integer"; minimum?: number; maximum?: number; description?: string; descriptionKey?: string; default?: number }
  | { type: "boolean"; description?: string; descriptionKey?: string; default?: boolean }
  | { type: "array"; items?: { type: "string"; format?: StringFormat }; description?: string; descriptionKey?: string };

export interface ObjectSchema {
  type?: "object";
  properties?: Record<string, FieldSchema>;
  required?: string[];
  /** Only `false` is understood and is what the module does anyway; anything else is named by {@link unsupportedSchemaKeywords}. */
  additionalProperties?: false;
}

export type IssueCode =
  | "not-object" | "missing" | "unknown-field" | "type" | "too-short" | "not-in-enum" | "format"
  | "below-minimum" | "above-maximum" | "unsupported-type" | "bad-schema";

/** One problem. `path` is `field`, `field[2]` or `""` (the input itself, or the schema). `message` is `path: text`. */
export interface ValidationIssue { path: string; code: IssueCode; message: string }

export type ValidationResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

export interface ValidateOptions {
  /** `"reject"` (default): a field the schema does not name is an error. `"ignore"`: it is left out of `value` and
   *  not an error (vault-rag and koda-agent read only the schema's fields). */
  unknownFields?: "reject" | "ignore";
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

function checkField(path: string, schema: unknown, value: unknown, out: ValidationIssue[]): void {
  const add = (code: IssueCode, text: string): void => { out.push({ path, code, message: `${path}: ${text}` }); };
  const s = isObj(schema) ? schema : {};
  switch (s["type"]) {
    case "string": {
      if (typeof value !== "string") { add("type", "must be a string"); return; }
      const min = s["minLength"];
      if (typeof min === "number" && value.length < min) add("too-short", `too short (min. ${min})`);
      const en = s["enum"];
      if (Array.isArray(en) && !en.includes(value)) add("not-in-enum", `must be one of [${en.map(show).join(", ")}]`);
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
    case "array": {
      if (!Array.isArray(value)) { add("type", "must be an array"); return; }
      const items = s["items"];
      if (items === undefined) return;
      const itemType = isObj(items) ? items["type"] : undefined;
      if (itemType !== "string") { add("unsupported-type", `unsupported schema type "${show(itemType)}" in items`); return; }
      const format = (items as Record<string, unknown>)["format"];
      // an index loop, not forEach: a hole in a sparse array is no string
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i];
        const p = `${path}[${i}]`;
        if (typeof item !== "string") { out.push({ path: p, code: "type", message: `${p}: must be a string` }); continue; }
        const fp = formatProblem(format, item);
        if (fp !== null) out.push({ path: p, code: "format", message: `${p}: ${fp}` });
      }
      return;
    }
    default:
      add("unsupported-type", `unsupported schema type "${show(s["type"])}"`);
  }
}

/** The problems of an input against a schema; an empty list means valid. See {@link validateInput}. */
export function inputIssues(schema: ObjectSchema, input: unknown, opts: ValidateOptions | null = {}): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const bad = (text: string): ValidationIssue[] => [{ path: "", code: "bad-schema", message: `schema: ${text}` }];
  if (!isObj(schema)) return bad("must be an object");
  if (schema.type !== undefined && schema.type !== "object") return bad('type must be "object"');
  const props = schema.properties ?? {};
  if (!isObj(props)) return bad("properties must be an object");
  const required: unknown = schema.required ?? [];
  if (!Array.isArray(required) || !required.every((k): k is string => typeof k === "string")) return bad("required must be a list of names");
  // A required name the schema does not list can never be satisfied in reject mode and is a lie in ignore mode (it would
  // count as given and not appear in `value`).
  const orphans = required.filter((k) => !Object.hasOwn(props, k));
  if (orphans.length > 0) return bad(`required names a field that is not in properties: ${[...new Set(orphans)].join(", ")}`);
  if (!isObj(input)) return [{ path: "", code: "not-object", message: "input is not an object" }];

  const missing = new Set<string>();
  for (const key of new Set(required)) {
    const value = Object.hasOwn(input, key) ? input[key] : undefined;
    if (value === undefined || (typeof value === "string" && value.trim() === "")) {
      missing.add(key);
      out.push({ path: key, code: "missing", message: `${key}: missing (required)` });
    }
  }
  const ignoreUnknown = opts?.unknownFields === "ignore";
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(props, key)) {
      if (!ignoreUnknown) out.push({ path: key, code: "unknown-field", message: `${key}: unknown field` });
      continue;
    }
    if (value === undefined || missing.has(key)) continue;
    checkField(key, props[key], value, out);
  }
  return out;
}

/** `{ ok: true, value }` or `{ ok: false, errors }` (English, `path: text`, all of them). `value` is `input` itself, or with
 *  `unknownFields: "ignore"` a new object holding only the schema's fields. Never throws. */
export function validateInput(schema: ObjectSchema, input: unknown, opts: ValidateOptions | null = {}): ValidationResult {
  const issues = inputIssues(schema, input, opts);
  if (issues.length > 0) return { ok: false, errors: issues.map((i) => i.message) };
  const o = input as Record<string, unknown>;
  if (opts?.unknownFields !== "ignore") return { ok: true, value: o };
  const props = schema.properties ?? {};
  return { ok: true, value: Object.fromEntries(Object.entries(o).filter(([k]) => Object.hasOwn(props, k))) };
}

const ANNOTATIONS = new Set(["description", "descriptionKey", "default", "title", "examples", "$comment", "$schema", "$id"]);
const FORMATS = new Set<string>(["date-time", "date", "email", "uri", "multiline"]);
const FIELD_KEYWORDS: Record<string, readonly string[]> = {
  string: ["type", "format", "enum", "minLength"],
  number: ["type", "minimum", "maximum"],
  integer: ["type", "minimum", "maximum"],
  boolean: ["type"],
  array: ["type", "items"],
};

/** What a schema asks for that {@link validateInput} does not check, as sorted paths (`properties.a.pattern`,
 *  `properties.a.format=hostname`, `properties.o.type=object`, `oneOf`). Empty = the schema is inside the subset. A host that
 *  mounts tools from a third party calls this once per tool and decides: refuse, warn, or check that part itself. Silent
 *  gaps are the point — an argument the schema constrains and nobody checks passes as valid. */
export function unsupportedSchemaKeywords(schema: unknown): string[] {
  if (!isObj(schema)) return ["schema"];
  const found: string[] = [];
  for (const k of Object.keys(schema)) {
    if (ANNOTATIONS.has(k) || k === "type" || k === "properties" || k === "required") continue;
    if (k === "additionalProperties" && schema[k] === false) continue;
    found.push(k);
  }
  if (schema["type"] !== undefined && schema["type"] !== "object") found.push(`type=${show(schema["type"])}`);
  if (schema["required"] !== undefined && !(Array.isArray(schema["required"]) && schema["required"].every((k) => typeof k === "string"))) found.push("required");
  const props = schema["properties"];
  if (props !== undefined) {
    if (!isObj(props)) found.push("properties");
    else for (const [name, f] of Object.entries(props)) fieldGaps(`properties.${name}`, f, found);
  }
  return found.sort();
}

function fieldGaps(path: string, f: unknown, found: string[]): void {
  if (!isObj(f)) { found.push(path); return; }
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
  if (type === "array" && f["items"] !== undefined) {
    const items = f["items"];
    if (!isObj(items)) { found.push(`${path}.items`); return; }
    if (items["type"] !== "string") found.push(`${path}.items.type=${show(items["type"])}`);
    for (const k of Object.keys(items)) if (k !== "type" && k !== "format" && !ANNOTATIONS.has(k)) found.push(`${path}.items.${k}`);
    if (items["format"] !== undefined && !(typeof items["format"] === "string" && FORMATS.has(items["format"]))) found.push(`${path}.items.format=${show(items["format"])}`);
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
