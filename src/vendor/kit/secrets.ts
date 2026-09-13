// vendored from obsidian-kit@0.35.0, src/pure/secrets.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Schlüsselbund-Vertrag, obsidian-frei. Herkunft: calendar-notes/src/obsidian/secrets.ts
 *  (2026-08, danach byte-nah in anysource-sideloader, mailstone, yijing-oracle — n=4, damit
 *  Kit-reif). Zusatz gegenüber der Vorlage: `delete`, weil ein gelöschter Endpunkt sein
 *  Token mitnehmen muss. */
export interface SecretStore {
  get(id: string): string | null;
  set(id: string, value: string): void;
  has(id: string): boolean;
  delete(id: string): void;
}

/** Entfernt führende/abschließende CR/LF — der typische Clipboard-Rest, wenn ein Passwort
 *  per `pbcopy < datei` aus einer Datei mit Zeilenumbruch kopiert wurde. Absichtlich kein
 *  voller `trim()`: ein Leerzeichen im Passwort bleibt gültig, nur Zeilenumbrüche sind nie
 *  Teil eines Geheimnisses. */
export function stripCrLf(value: string): string {
  return value.replace(/^[\r\n]+/, "").replace(/[\r\n]+$/, "");
}

/** Deterministische Secret-ID aus Plugin-Präfix und Eintrags-ID. Obsidians `setSecret` nimmt
 *  nur „lowercase alphanumeric with optional dashes" und wirft sonst — deshalb wird hier
 *  normalisiert statt nur verkettet: Großbuchstaben klein, alles andere zu `-`, Ketten
 *  kollabiert, Ränder geschnitten. Zwei verschiedene Eingaben können dadurch auf dieselbe ID
 *  fallen (`a/b` und `a-b`); der Aufrufer wählt seine IDs so, dass das nicht vorkommt
 *  (UUIDs und Kleinbuchstaben-Slugs sind sicher). */
export function secretIdFor(prefix: string, id: string): string {
  const out = `${prefix}-${id}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!out) throw new Error("secretIdFor: Ergebnis ist leer");
  return out;
}

/** In-Memory-Fallback für Tests und für eine Obsidian-Version ohne `secretStorage`. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  get(id: string): string | null {
    return this.values.get(id) ?? null;
  }

  set(id: string, value: string): void {
    this.values.set(id, stripCrLf(value));
  }

  has(id: string): boolean {
    return (this.values.get(id) ?? "") !== "";
  }

  delete(id: string): void {
    this.values.delete(id);
  }

  get size(): number {
    return this.values.size;
  }
}
