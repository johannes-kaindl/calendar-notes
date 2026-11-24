// vendored from code-kit@0.87.0, src/ts/pure/phone.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: lifted from calendar-notes `src/core/adopt/phone.ts` (calendar-notes@4d899d7, the commit that added the extension marker), moved, not rewritten
// (Welle 36, kp2b, order 8 of the pseudonymizer design, spec sections 7.2 and 8.4). The comments below are the original ones, in German. calendar-notes keeps
// its own copy until its next release of its own; then it takes this file.
//
// THE ONE DEVIATION from the original (measured, see `tests/phone.test.ts`): `EXTENSION_RE` began with `\s*`. The expression is tried at every position, so a
// run of white space (a pasted field full of blanks) was scanned to its end from each of its positions, quadratic: 50 000 blanks took 100 s on a loaded
// machine, the growth quotient was 32 where linear is 5. The leading `\s*` only took blanks IN FRONT of the marker into the match, and the `.trim()` that
// follows removes exactly those (the match ends at the end of the string), so the result is the same for every input; the test pins that against the
// original expression over every string up to 6 characters of a nine-character alphabet.
// Durchwahlen/Extensions mit erkennbarem Marker ("x42", "ext. 42", "Durchwahl 42") werden vor der
// Normalisierung abgetrennt. Ein bloßes Suffix wie "-42" OHNE Marker wird bewusst NICHT erkannt —
// von einer regulären Nummern-Fortsetzung ist das nicht zu unterscheiden — und fließt fail-safe
// einfach mit in die Ziffernfolge ein: keine Erkennung ist besser als eine falsch abgetrennte
// Basisnummer, die dann einen falschen Match ergäbe.
const EXTENSION_RE = /(x|ext\.?|durchwahl)\s*\d+$/i;

/**
 * Normalisiert eine Telefonnummer auf ein vergleichbares `+<Ländercode><Ziffern>`-Format,
 * damit z. B. "+49 171 1234567" und "0171/1234567" beim Adoptions-Matching als gleich erkannt
 * werden. `null`, wenn nach dem Entfernen von Trennzeichen weniger als 6 Ziffern übrig bleiben
 * (zu kurz, um eine belastbare Übereinstimmung zu sein).
 */
export function normalizePhone(raw: string, defaultCountry = "49"): string | null {
  const trimmed = raw.replace(EXTENSION_RE, "").trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+${defaultCountry}${digits.slice(1)}`;
  return `+${digits}`;
}
