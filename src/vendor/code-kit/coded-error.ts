// vendored from code-kit@0.74.0, src/ts/pure/coded-error.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// New in code-kit (2026-11-15), lifted out of two plugins that carried the same pattern twice with drift for no reason:
// json-editor (`CoreError`, src/core/errors.ts:23-33; `errorText`, src/obsidian/error-text.ts:8-11, prefix `err.`) and
// calendar-notes (`CoreError`, src/core/errors.ts:21-26; `coreErrorOf`, :28-34; `describeError`, src/obsidian/error-i18n.ts:7-11,
// prefix `core.error.`). The code union stays in the plugin; this module holds only the mechanism.
import { errorMessage } from "./error-message";

/** The values an error's text mentions, in the order the translations use them (`{0}`, `{1}`); what `t` from `i18n` takes. */
export type CodedErrorArg = string | number;

/** An error that names its case with a `code` and the values its text mentions with `args`, so a UI can translate it.
 *  `message` stays the English fallback for a log, a test and a plain `catch`. A plugin derives its own class
 *  (`class CoreError extends CodedError<CoreErrorCode>`), sets its own `name` and keeps its code union. */
export class CodedError<C extends string = string> extends Error {
  readonly code: C;
  readonly args: readonly CodedErrorArg[];

  constructor(code: C, message: string, args: readonly CodedErrorArg[] = []) {
    super(message);
    this.name = "CodedError";
    this.code = code;
    this.args = args;
  }
}

/**
 * Reads `code` and `args` off a value that carries them, by shape and not by `instanceof`: an error from another
 * class (calendar-notes' `DavError`) carries a code without inheriting from the plugin's error. Recognised is an
 * `Error` whose `code` is a non-empty string and whose `args` is an array holding only strings and finite numbers.
 * A Node error with a `code` but no `args` (`ENOENT`) is not a coded error, and neither is a thrown string.
 */
export function codedErrorOf(e: unknown): { code: string; args: readonly CodedErrorArg[] } | undefined {
  if (!(e instanceof Error)) return undefined;
  const c = e as Error & { code?: unknown; args?: unknown };
  if (typeof c.code !== "string" || c.code === "") return undefined;
  if (!Array.isArray(c.args)) return undefined;
  const args: unknown[] = c.args;
  if (!args.every((a) => typeof a === "string" || (typeof a === "number" && Number.isFinite(a)))) return undefined;
  return { code: c.code, args: args as CodedErrorArg[] };
}

/**
 * The text of an error for the user. A coded error is translated: `translate(prefix + code, ...args)`. When
 * `translate` hands back the very key (it knows no translation; `t` from `i18n` does exactly that) the error's
 * `message` is shown, so the user never sees a raw key. Any other value keeps its own text (`errorMessage`).
 * The prefix is a parameter because the keys live in the plugins' language files (`err.` against `core.error.`);
 * renaming one would change files with no effect for the user.
 */
export function codedErrorText(
  e: unknown,
  translate: (key: string, ...args: CodedErrorArg[]) => string,
  prefix: string,
): string {
  const coded = codedErrorOf(e);
  if (coded !== undefined) {
    const key = prefix + coded.code;
    const text = translate(key, ...coded.args);
    return text === key ? errorMessage(e) : text;
  }
  return errorMessage(e);
}
