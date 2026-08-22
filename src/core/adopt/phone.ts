/**
 * Normalisiert eine Telefonnummer auf ein vergleichbares `+<Ländercode><Ziffern>`-Format,
 * damit z. B. "+49 171 1234567" und "0171/1234567" beim Adoptions-Matching als gleich erkannt
 * werden. `null`, wenn nach dem Entfernen von Trennzeichen weniger als 6 Ziffern übrig bleiben
 * (zu kurz, um eine belastbare Übereinstimmung zu sein).
 */
export function normalizePhone(raw: string, defaultCountry = "49"): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 6) return null;
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+${defaultCountry}${digits.slice(1)}`;
  return `+${digits}`;
}
