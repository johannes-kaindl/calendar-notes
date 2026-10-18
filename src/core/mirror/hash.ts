import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";
import { valueEquals, type FmValue, type ValueEqualsOptions } from "../../vendor/kit/frontmatter";
import type { FmVal } from "./profile";

export function managedHash(set: Record<string, FmVal>, unset: string[], block: string | null): string {
  const sortedSet: Record<string, FmVal> = {};
  for (const k of Object.keys(set).sort()) {
    const v = set[k];
    if (v !== undefined) sortedSet[k] = v;
  }
  return sha256HexUtf8(JSON.stringify({ set: sortedSet, unset: [...unset].sort(), block }));
}

/** Der Wert als `FmValue` des Kits (Text, Zahl, Textliste); `null` fuer „nicht gesetzt“. Das Kit kennt weder Wahrheitswerte noch
 *  Objekte: ein Boolean gleicht dem Text seiner Schreibweise (`true` = `"true"`, so liest Obsidian ihn zurueck), ein Objekt dem
 *  JSON, ein Listenelement ausser Text/Zahl/Boolean ebenso. */
function toFmValue(v: unknown): FmValue | null {
  if (v === undefined || v === null) return null;
  const text = (x: unknown): string => (typeof x === "string" || typeof x === "number" || typeof x === "boolean" ? String(x) : JSON.stringify(x));
  if (Array.isArray(v)) return v.map(text);
  if (typeof v === "string" || typeof v === "number") return v;
  return text(v);
}

/** Gleichheit zweier Frontmatter-Werte fuer den Spiegel. Duenne Huelle um `valueEquals` des Kits (Skalare ueber `String(v)`, Listen
 *  Element fuer Element); sie ergaenzt, was das Kit nicht kennt: `null`/`undefined` (beide „nicht gesetzt“, gleich), Boolean und
 *  Objekte (s. `toFmValue`). **Unterschied zum Kit, mit Grund:** Eine Liste und ein Skalar sind hier NIE gleich, das Kit setzt
 *  `"a"` und `["a"]` gleich. Der Spiegel schreibt `categories` als Liste; stuende dort ein Skalar, soll der Sync ihn zur Liste
 *  machen statt ihn als „schon gleich“ zu uebergehen. `linkAware` setzt einen Wikilink und seinen Klartext gleich. */
export function fmEquals(a: unknown, b: unknown, opts?: ValueEqualsOptions): boolean {
  const x = toFmValue(a), y = toFmValue(b);
  if (x === null || y === null) return x === y;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  return valueEquals(x, y, opts);
}
