// vendored from code-kit@0.31.0, src/ts/pure/marker-zone.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Finds, wraps and defends a **managed zone** in a note: a block between two marker lines that a sync or an importer owns and
 *  replaces, with text before and after it that belongs to the user.
 *
 *  Origin: calendar-notes `src/core/mirror/body.ts` (`splitBody`, `%% dav:begin %%`), mailstone `src/core/merge/fences.ts`
 *  (`splitBody`, `wrapBlock`, `%% mailstone:begin %%`) and finance-ledger `src/core/notes/markers.ts` (`splitBody`,
 *  `<!-- BEGIN: AUTO-GENERATED -->`). Three copies of one idea (five, with the two in yijing-oracle) with different answers to the same questions. What is fixed
 *  here, and why:
 *
 *  0. Five copies exist, not three: yijing-oracle `src/core/llm/insert.ts` and `src/core/artwork.ts` find a zone with `indexOf` on
 *     both markers and append a second one when it is incomplete — the same loss as in 2 below.
 *  1. **Which END closes the zone.** calendar-notes took the first END after the BEGIN, finance-ledger the first of the whole
 *     text, mailstone the **last**. First (after the BEGIN) is the default: with the markers neutralized in everything the zone
 *     is built from ({@link neutralizeMarkers}), a second END can only be the user's, and the user's text after the zone must stay
 *     the user's — "last" would put it INSIDE the zone, and the next sync replaces it. Measured 2026-10-16 on calendar-notes'
 *     `mergeBody`: an event description holding `%% dav:end %%` (it comes from the server) made the note grow by 33 characters
 *     per sync, because the rest of the description fell out of the zone. Both ends of that are closed together: neutralize what
 *     goes in, read the first END. A BEGIN or END quoted by the user is the limit of that: `nestedBegins` and `strayEnds` make it
 *     visible, and a caller that sees either refuses to write. `{ end: "last" }` is mailstone's rule for its existing notes and is kept as an option; the
 *     END markers left over after a "first" read are counted in `strayEnds`, so a caller can warn.
 *  2. **A BEGIN without its END (or an END alone) is not "no zone".** calendar-notes and mailstone returned `block: null` and
 *     appended a second zone; the next merge then read a zone from the orphan BEGIN to the new END and replaced everything
 *     between — measured 2026-10-16 on calendar-notes: text the user wrote under a BEGIN whose END they had deleted was gone after
 *     the second sync. finance-ledger threw (`MarkerError`: "whoever guesses at an asymmetry risks exactly the loss the markers
 *     are there to prevent"). Here it is a value, `{ kind: "broken", reason }`, which the caller must handle — refuse to write and
 *     say so — and nothing is thrown. An END that stands before the BEGIN while a proper pair follows is the user's text
 *     (a quotation) and not a break.
 *  3. **Whitespace.** The inner text loses one line break (`\n` or `\r\n`) at each end: calendar-notes and mailstone did, and
 *     {@link wrapZone} puts exactly those back, so `splitZone(wrapZone(x)).block === x` for every `x` that holds no marker (also with
 *     blank lines or a lone `\r` at its ends; in a CRLF note the block comes back with CRLF). The line end the zone was written
 *     with is the one after the BEGIN — an LF zone does not eat a `\r` that belongs to the block. finance-ledger kept the inner text raw and trimmed at assembly; that and the other merge policies (calendar-notes
 *     `mergeBody`: where an absent zone is appended, how the seam collapses on removal; finance-ledger `assembleBody`: header
 *     trimmed right, user part dropped when blank; mailstone `zoneHash`: a hash over the zone with the line ends unified) stay
 *     with the plugins — three byte-stable contracts, each pinned by that plugin's tests, built on this split.
 *
 *  The markers are plain strings, matched exactly and case-sensitively (mailstone's `renderMessageBlock` neutralizes more broadly —
 *  any case, any spacing between the `%%` and the word — which is a superset and stays with it). Pure, no I/O; linear in the text
 *  (searches by `indexOf`, apart from two fixed trim patterns; tested at 1 000 / 10 000 / 50 000 repetitions of markers, marker prefixes and percent signs). */

export interface ZoneMarkers { begin: string; end: string }

/** A BEGIN with no END after it. (An END with no BEGIN is not a break: see {@link splitZone}.) */
export type ZoneBroken = "begin-without-end";

export type ZoneSplit =
  /** No marker at all. `before` is the whole text. */
  | { kind: "none"; before: string }
  /** `block` is the inner text without one line break at each end. `strayEnds`: END markers in `after` (always 0 for `end: "last"`).
   *  `nestedBegins`: BEGIN markers inside the block — a BEGIN quoted in the text before the zone makes the first BEGIN the wrong
   *  one, and everything between it and the real zone is "block". Non-zero is a reason to refuse to write. */
  | { kind: "zone"; before: string; block: string; after: string; strayEnds: number; nestedBegins: number }
  /** A BEGIN that no END follows: appending a second zone would make the next sync read one zone from the orphan to the new END and
   *  replace whatever the user wrote in between. Do not write; tell the user. */
  | { kind: "broken"; reason: ZoneBroken };

export interface SplitZoneOptions {
  /** Which END closes the zone: the first one after the BEGIN (default) or the last one of the text. */
  end?: "first" | "last";
}

function checkMarkers(m: ZoneMarkers): void {
  if (m.begin === "" || m.end === "" || m.begin.includes(m.end) || m.end.includes(m.begin)) {
    throw new RangeError("zone markers must be two non-empty strings, neither inside the other");
  }
}

export function splitZone(body: string, markers: ZoneMarkers, opts: SplitZoneOptions = {}): ZoneSplit {
  checkMarkers(markers);
  const { begin, end } = markers;
  const b = body.indexOf(begin);
  // An END without any BEGIN is no zone and no break: a zone appended after it is read correctly on the next sync.
  if (b < 0) return { kind: "none", before: body };
  const from = b + begin.length;
  const j = opts.end === "last" ? body.lastIndexOf(end) : body.indexOf(end, from);
  if (j < from) return { kind: "broken", reason: "begin-without-end" };
  const raw = body.slice(from, j);
  // The line end the zone was written with is the one after the BEGIN: an LF zone gives back a lone `\r` at the end of the block.
  const inner = raw.replace(/^\r?\n/, "").replace(raw.startsWith("\n") ? /\n$/ : /\r?\n$/, "");
  let nestedBegins = 0;
  for (let k = raw.indexOf(begin); k >= 0; k = raw.indexOf(begin, k + begin.length)) nestedBegins++;
  const after = body.slice(j + end.length);
  let strayEnds = 0;
  for (let k = after.indexOf(end); k >= 0; k = after.indexOf(end, k + end.length)) strayEnds++;
  return { kind: "zone", before: body.slice(0, b), block: inner, after, strayEnds, nestedBegins };
}

/** The zone as it goes into the note. `eol` is the note's line end: the rest of a note is rewritten with its own, and a zone that
 *  mixed `\n` into a CRLF note would make every sync a change. The block arrives with LF (or CRLF) and is converted. */
export function wrapZone(block: string, markers: ZoneMarkers, eol: "\n" | "\r\n" = "\n"): string {
  checkMarkers(markers);
  const inner = eol === "\n" ? block : block.replace(/\r?\n/g, eol);
  return `${markers.begin}${eol}${inner}${eol}${markers.end}`;
}

/** Replaces both markers in text that is about to go INTO a zone (a mail body, an event description): such text cannot close the
 *  zone early. Exact matches only; the replacement must not be empty or hold a marker. Idempotent, and the result holds no marker
 *  (it repeats until none is left; a replacement that keeps rebuilding a marker with its neighbours is a `RangeError` after twice the text length in passes — never seen with random replacements, 570 000 cases). */
export function neutralizeMarkers(text: string, markers: ZoneMarkers, replacement = "(marker removed)"): string {
  checkMarkers(markers);
  if (replacement === "" || replacement.includes(markers.begin) || replacement.includes(markers.end)) {
    throw new RangeError("the replacement must be non-empty and must not contain a marker");
  }
  let out = text;
  // One pass is enough for any replacement that cannot join with its neighbours into a marker; the cap is for one that can.
  const cap = text.length * 2 + 64;
  for (let pass = 0; out.includes(markers.begin) || out.includes(markers.end); pass++) {
    if (pass >= cap) throw new RangeError("the replacement rebuilds a marker with its neighbours");
    out = out.split(markers.begin).join(replacement).split(markers.end).join(replacement);
  }
  return out;
}
