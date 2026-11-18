// vendored from code-kit@0.75.0, src/ts/pure/rel-path.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The segment rules of a relative path that must stay inside a root (a vault, a sync folder, an export folder): no `..`
 *  that leaves it, no absolute path, no empty or `.` segment that makes two spellings of one file, no `\` that one platform
 *  reads as a separator and another as a name, no NUL. String logic only — it never touches a file system and never decodes
 *  (`%2e%2e` is a name here; a caller that reads URIs decodes first).
 *
 *  Origin: six local versions of the same few lines, measured 2026-10-18, each with its own outcome:
 *  - koda-agent `core/tools/path-guard.ts` `resolveNotePath` / `resolveFolderPath` and vault-rag `retrieval_facade.ts`
 *    `resolveNotePath`: split at `/` and `\`, drop empty and `.` segments, a leading `/` is an error (folder variant: dropped),
 *    `..` throws — {@link normalizeRelPath};
 *  - wikijs-maintainer `core/paths.ts` `anchorFromFrontmatter`: **nothing is rewritten**, an empty, `.` or `..` segment or a `\`
 *    makes the whole value unusable (`null`), because the value is a name that goes to a server — {@link checkRelPath};
 *  - 3d-codeblocks `core/gltf-uri.ts` `classifyUri`: a reference is resolved against the folder of the model, `..` climbs inside
 *    the vault and is refused only where it would leave it — {@link resolveRelPath};
 *  - vault-crews `core/paths.ts` `normalizeVaultPath`: like the first group, but it **kept** a `.` segment (`./a` stayed `./a`,
 *    so a deny-list written for `a` did not see it) — the kit drops it;
 *  - obsidian-kit `obsidian/share-export.ts` `assertFileName`: the name must be ONE segment — {@link isPathSegment}.
 *
 *  Three results differ from every local version, on purpose: a NUL byte is refused everywhere (only share-export did), and a
 *  segment that is `.` or `..` once its whitespace is trimmed (`".. "`) counts as `.` or `..` (a file system that trims trailing
 *  blanks reads it so). A leading `\` is, as in all six, a separator and not an absolute path. A Windows drive letter (`C:/x`) is
 *  not a form this module knows. Look-alikes are the caller's too, like percent-encoding: `U+2215`, `U+FF0F` or the full-width `．．／` are names here, and
 *  `U+200B` is not whitespace to `trim()`; a caller that normalises with NFKC or applies a Windows best-fit mapping afterwards does
 *  it before this module, not after. `absolute: "strip"` in {@link resolveRelPath} reads `/a` as `a` **below the base** (the
 *  3d-codeblocks reading), not below the root; `baseDir` is the caller's own folder and gets no absolute check.
 *
 *  Pure, no I/O; linear in the length of the path (tested at 1 000 / 10 000 / 50 000 for many segments, separators and dots). */

/** Why a path was refused. `empty`: nothing is left (or nothing was given); `absolute`: starts with `/`; `backslash`: a `\`
 *  in a path that is checked, not rewritten; `empty-segment` / `dot-segment`: `//` or `/./` in a path that is checked, not
 *  rewritten; `traversal`: a `..` segment that is not allowed (any, in {@link normalizeRelPath} and {@link checkRelPath}; one
 *  that leaves the root, in {@link resolveRelPath}); `nul`: a NUL byte. */
export type RelPathProblem = "empty" | "absolute" | "backslash" | "empty-segment" | "dot-segment" | "traversal" | "nul";

export type RelPathResult = { ok: true; path: string; segments: string[] } | { ok: false; problem: RelPathProblem };

export interface RelPathOptions {
  /** A leading `/`: `"reject"` (default) answers `absolute`; `"strip"` reads it as an empty segment and goes on (a model writes a
   *  folder as `/20_Projekte/` and means no escape). */
  absolute?: "reject" | "strip";
  /** The root itself (`""` after normalising) is a valid answer. Default: it is `empty`. */
  allowEmpty?: boolean;
}

type SegmentKind = "empty" | "dot" | "up" | "name";

function kindOf(segment: string): SegmentKind {
  if (segment === "") return "empty";
  const t = segment.trim();
  if (t === ".") return "dot";
  if (t === "..") return "up";
  return "name";
}

const SEPARATORS = /[\\/]/;

const fail = (problem: RelPathProblem): RelPathResult => ({ ok: false, problem });
const done = (segments: string[]): RelPathResult => ({ ok: true, path: segments.join("/"), segments });

/** Splits at `/` and `\`, drops empty and `.` segments and joins the rest with `/`. Any `..` segment is `traversal`, wherever it
 *  stands — this function never resolves one (use {@link resolveRelPath} for that). */
export function normalizeRelPath(path: string, options: RelPathOptions = {}): RelPathResult {
  if (path.includes("\0")) return fail("nul");
  if (path.startsWith("/") && options.absolute !== "strip") return fail("absolute");
  const segments: string[] = [];
  for (const segment of path.split(SEPARATORS)) {
    const kind = kindOf(segment);
    if (kind === "up") return fail("traversal");
    if (kind === "name") segments.push(segment);
  }
  if (segments.length === 0 && options.allowEmpty !== true) return fail("empty");
  return done(segments);
}

/** Accepts a path that needs no rewriting and refuses every other one, naming the first problem it meets (checked in the order
 *  NUL, empty, `\`, leading `/`, then each segment left to right). For a value that is not a path in the file system but a name
 *  that goes somewhere else, where `a//b` and `a/b` must not be two names. `absolute` is not an option here; a caller that
 *  wants to tolerate outer slashes trims them first. */
export function checkRelPath(path: string, options: Pick<RelPathOptions, "allowEmpty"> = {}): RelPathResult {
  if (path.includes("\0")) return fail("nul");
  if (path === "") return options.allowEmpty === true ? done([]) : fail("empty");
  if (path.includes("\\")) return fail("backslash");
  if (path.startsWith("/")) return fail("absolute");
  const segments = path.split("/");
  for (const segment of segments) {
    const kind = kindOf(segment);
    if (kind === "up") return fail("traversal");
    if (kind === "dot") return fail("dot-segment");
    if (kind === "empty") return fail("empty-segment");
  }
  return { ok: true, path, segments };
}

/** Resolves a reference against a base folder: `..` climbs out of the base but never out of the root, so the result is always
 *  inside it (`traversal` where it would not be). Empty and `.` segments are dropped, `\` is a separator. The base goes through
 *  the same walk, so a base that itself climbs out is `traversal`. The base folder itself is a result (`a/..` against `m` is
 *  `m`); only a result that is the root is `empty`. */
export function resolveRelPath(baseDir: string, path: string, options: RelPathOptions = {}): RelPathResult {
  if (baseDir.includes("\0") || path.includes("\0")) return fail("nul");
  if (path.startsWith("/") && options.absolute !== "strip") return fail("absolute");
  const segments: string[] = [];
  for (const part of [baseDir, path]) {
    for (const segment of part.split(SEPARATORS)) {
      const kind = kindOf(segment);
      if (kind === "name") segments.push(segment);
      else if (kind === "up") {
        if (segments.length === 0) return fail("traversal");
        segments.pop();
      }
    }
  }
  if (segments.length === 0 && options.allowEmpty !== true) return fail("empty");
  return done(segments);
}

/** True if `name` is ONE path segment: not empty, not `.` or `..` (also not padded with whitespace), no `/`, no `\`, no NUL.
 *  Whether it also has an extension, a length limit or a legal character set is the caller's. */
export function isPathSegment(name: string): boolean {
  return kindOf(name) === "name" && !/[\\/\0]/.test(name);
}

/** The last segment of a `/`-separated path (`"a/b/c.m4a"` → `"c.m4a"`); no `/` returns the path itself, a trailing `/` returns `""`.
 *  No validation (see {@link checkRelPath}); backslashes are not separators here (a vault path never has them). */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** A file name split into stem and extension. Directories in front of it (`/` or `\`, the latter for names a file picker hands over) are dropped;
 *  the extension is lower-cased and carries no dot. No extension — or a leading dot only (`.gitignore`) — gives `ext: ""` and the whole name as stem. */
export function splitFileName(fileName: string): { stem: string; ext: string } {
  const name = fileName.slice(Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? { stem: name, ext: "" } : { stem: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

/** Where `path` lies after the file or folder `from` was renamed or moved to `to` (the pair Obsidian's `rename` event delivers). `path` itself or any path
 *  below it moves along (`"a/b/c"` after `a/b` → `a/x`: `"a/x/c"`); anything else, including a sibling that only shares the prefix (`"a/bc"`), returns `null`.
 *  Plain string work on `/`-separated paths, no validation. */
export function pathAfterRename(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : null;
}
