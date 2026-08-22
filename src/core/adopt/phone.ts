// Durchwahlen/Extensions mit erkennbarem Marker ("x42", "ext. 42", "Durchwahl 42") werden vor der
// Normalisierung abgetrennt. Ein bloßes Suffix wie "-42" OHNE Marker wird bewusst NICHT erkannt —
// von einer regulären Nummern-Fortsetzung ist das nicht zu unterscheiden — und fließt fail-safe
// einfach mit in die Ziffernfolge ein: keine Erkennung ist besser als eine falsch abgetrennte
// Basisnummer, die dann einen falschen Match ergäbe.
const EXTENSION_RE = /\s*(x|ext\.?|durchwahl)\s*\d+$/i;

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
