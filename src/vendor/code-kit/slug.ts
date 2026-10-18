// vendored from code-kit@0.31.0, src/ts/pure/slug.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: the slug functions that plugin repos wrote one by one (measured 2026-10-14, `obsidian-plugins/*/src`):
// mailstone `core/render/filename.ts:8` (`subjectSlug`) and `core/settings.ts:38` (`slugifyAccountId`) — the same
// chain twice —, wikijs-maintainer `core/paths.ts:15` (`slugifySegment`), neurovim-obsidian `paths.ts:3`
// (`missionNoteSlug`'s `clean`), lingotuner `core/dials.ts:58` (`userPresetId`). Needed next by calendar-notes for the
// file-name convention `YYYY-MM-DD_kategorie_kuerzel_betreff` (a slug has no `_`, so it can sit between the underscores).
// Welle 22, 2026-10-14.
//
// **Why not in `filename-template`.** `sanitizeFilename`/`sanitizeBase` keep a name *readable* (spaces, capitals, umlauts
// stay) and only remove what a file system forbids; a slug is an ASCII identifier. And `filename-template` promises
// single-file vendoring and a stable character class that renames existing exports when touched — a new function next
// to it would cost every vendor of that file a bump for code it does not use. `clipText` is not reused either: its cut
// trims blanks, the slug's cut must drop a hyphen.
//
// **What differed between the copies, and the reason found:**
// - *Transliteration.* mailstone (both), wikijs-maintainer: ä → ae, ö → oe, ü → ue, ß → ss, then the other accents by
//   Unicode decomposition (wikijs lists 18 letters by hand; decomposition gives the same for them). lingotuner and
//   neurovim-obsidian: none, "Größe" → "gr-e". For lingotuner there is a reason: preset ids are part of its public API
//   (`LingoTunerApi.tune(text, id)`, `presets()`), derived from the name at every start (`settings.ts:86`) — other plugins
//   may have stored one, and a changed derivation changes the id → `transliterate: false`. neurovim-obsidian's titles are
//   English; no reason, but the option costs nothing and keeps the throwaway note names it produced.
// - *Punctuation.* wikijs-maintainer deletes (`04:35` → `0435`, `Node.js` → `nodejs`) where the others separate
//   (`04-35`, `node-js`). The reason is written in its header: wiki paths must come out the same "over years", and its
//   tests pin `backup-taeglich-0435` → `punctuation: "drop"`.
// - *Case.* neurovim-obsidian keeps it (`M-01-The-Three-Modes`, the mission id as printed) → `keepCase: true`.
// - *Length.* mailstone 60, the others none → `maxLength`, cut then trailing hyphen dropped.
// - *Empty result.* mailstone `"account"`, lingotuner `"preset"`, mailstone's file name `"mail"` (caller side) →
//   `fallback`, verbatim.
// - *Separator.* All five use `-`; no option.
// **Where the kit differs from a copy** (measured by comparing 400 000 random strings with all five originals; mailstone
// ×2, neurovim-obsidian and lingotuner came out identical, only wikijs-maintainer differs):
// - wikijs-maintainer *deletes* every character outside `a-z0-9`, whitespace, hyphen and its 18 table letters. The kit
//   decomposes first (NFKD), so a character with a decomposition survives as its base: `Č` → `c` (was: deleted), `m²` →
//   `m2` (was `m`), `ﬁ` → `fi`, `™` → `tm`, fullwidth `Ｈ` → `h`. A wiki path that contains one changes — wikijs-maintainer
//   has to look at its pages before it switches.
// - `ẞ` (capital sharp s) is in the umlaut table, as `ß` is: `STRAẞE` → `strasse`, like wikijs-maintainer, which lowercases
//   before its table. mailstone's chain had no `ẞ` and made `stra-e`; it now gets `strasse`.
// - A decomposition that yields capitals (`™` → `TM`, `Ⅳ` → `IV`) is lowercased afterwards; mailstone's chain lowercased
//   only before it and dropped them (`Co™` → `co`, now `cotm`).
// - Letters with no decomposition (`ł`, `ø`, `đ`) are treated alike by every version, this one included: they are not `a-z`,
//   so they separate words (`Mołdova` → `mo-dova`), or vanish with `punctuation: "drop"`.
// **Not here:** wikijs-maintainer's second slug rule for heading anchors (`core/links.ts:20`, same as `transliterate: false`
// without the hyphen collapse — a different rule in the same repo, n=1), vault-crews' `core/slug-mapper.ts:31` (NFD, drops
// non-ASCII, no umlaut table — would need `ä` → `a`), mailstone's "Re:/AW:/Fwd:" prefix strip (mail-specific, stays), vault-crews' `slugify` (a lookup in a
// table, no string processing), finance-ledger's `slugifyPattern` (turns `+` and `&` into `-und-`, strips quotes: domain
// rules for category patterns).

/** Options for {@link slugify}. */
export interface SlugOptions {
  /** Cut the slug to at most this many characters, then drop a hyphen the cut leaves at the end. Default: no limit. */
  maxLength?: number;
  /** What to return when nothing is left — verbatim, not slugged, not cut. Default `""`. */
  fallback?: string;
  /** Keep capitals (`The-Three-Modes`). Default `false`: everything lowercase. */
  keepCase?: boolean;
  /** Turn `ä ö ü ß` into `ae oe ue ss` and strip accents by decomposition. Default `true`. With `false`, every character
   *  outside `A-Za-z0-9` is a separator, so `Größe` becomes `gr-e`. */
  transliterate?: boolean;
  /** What a mark that is no letter or digit does. `"separate"` (default): it splits words (`04:35` → `04-35`).
   *  `"drop"`: it vanishes (`04:35` → `0435`); only whitespace and hyphens split. */
  punctuation?: "separate" | "drop";
}

const UMLAUTS: Readonly<Record<string, string>> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "Ae", Ö: "Oe", Ü: "Ue", ẞ: "SS" };

/** A URL-, path- and file-name-safe identifier made of `a-z`, `0-9` and single `-` (plus `A-Z` with `keepCase`).
 *  Never starts or ends with a hyphen, never has two in a row, and contains no `_` — so it can sit between the
 *  underscores of `YYYY-MM-DD_kategorie_kuerzel_betreff`. Idempotent: `slugify(slugify(x)) === slugify(x)` (without
 *  `maxLength`/`fallback` interplay).
 *
 *  @example slugify("Größe / Maß: Übersicht")              // → "groesse-mass-uebersicht"
 *  @example slugify("!!!", { fallback: "account" })        // → "account"
 *  @example slugify("Backup 04:35", { punctuation: "drop" }) // → "backup-0435"
 *  @example slugify("The Three Modes", { keepCase: true }) // → "The-Three-Modes" */
export function slugify(input: string, opts: SlugOptions = {}): string {
  const keepCase = opts.keepCase === true;
  let s = input;
  if (opts.transliterate !== false) {
    s = s.replace(/[äöüßÄÖÜẞ]/g, (c) => UMLAUTS[c] ?? c);
  }
  if (!keepCase) s = s.toLowerCase();
  if (opts.transliterate !== false) {
    s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    // Decomposition can bring capitals back (`™` → `TM`, `Ⅳ` → `IV`); mailstone's chain lowercased only before it and so
    // lost them.
    if (!keepCase) s = s.toLowerCase();
  }
  s = opts.punctuation === "drop"
    ? s.replace(keepCase ? /[^A-Za-z0-9\s-]/g : /[^a-z0-9\s-]/g, "").replace(/[\s-]+/g, "-")
    : s.replace(keepCase ? /[^A-Za-z0-9]+/g : /[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  if (opts.maxLength !== undefined && s.length > opts.maxLength) {
    s = s.slice(0, Math.max(0, opts.maxLength)).replace(/-+$/, "");
  }
  return s === "" ? (opts.fallback ?? "") : s;
}
