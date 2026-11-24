// vendored from code-kit@0.87.0, src/ts/pure/fold-case.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** A name or key as a case-insensitive, composition-insensitive file system compares it: NFC, then lower, upper, lower.
 *
 *  The leading lower matters for exactly one character. `s.toUpperCase().toLowerCase()` alone leaves the capital sharp s
 *  (U+1E9E) as `ß`, while `ß`, `ss` and `SS` all end as `ss`; with the extra step all four are one key. Measured 2026-10-30
 *  over all 1,112,064 code points (after NFKC, as `folder-scope` reads names): U+1E9E is the only one where the two differ,
 *  and the final-sigma cases (`ΟΔΟΣ`, `Οδοσ`, `AΣ`) come out the same.
 *
 *  Not Unicode case folding and not locale-aware (the dotted capital I stays two code points). It is the key to compare
 *  names with, not a string to show a person. Origin: `filesystemName` in `folder-scope` stood alone with the gap; docs-mirror
 *  wrote the corrected line again as `foldKey` (Gegenleser 2026-10-30). Pure, no import, no I/O, linear in the input. */
export function foldCase(s: string): string {
  return s.normalize("NFC").toLowerCase().toUpperCase().toLowerCase();
}
