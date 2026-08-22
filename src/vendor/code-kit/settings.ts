// vendored from code-kit@0.1.0, src/ts/pure/settings.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Shallow-Merge gespeicherter Plugin-Settings über Defaults — das gemeinsame
 *  `Object.assign({}, DEFAULTS, await loadData())`-Muster der Plugins, plus Referenz-Schutz:
 *  Default-*Werte* werden eine Ebene tief geklont (Arrays slice(), Plain-Objects Spread),
 *  damit das Ergebnis nie Array-/Objekt-Referenzen mit dem Defaults-Objekt teilt
 *  (sonst mutiert ein `settings.list.push(...)` die Defaults). `raw` wird nicht geklont —
 *  es kommt frisch aus `JSON.parse` (loadData). Unbekannte raw-Felder bleiben erhalten
 *  (Forward-Compat; vault-crews' `lastRuns` hängt daran). null/non-object raw → Default-Kopie. */
export function mergeSettings<T extends object>(defaults: T, raw: unknown): T {
  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    base[key] = Array.isArray(value)
      ? value.slice()
      : value !== null && typeof value === "object"
        ? { ...value }
        : value;
  }
  if (raw !== null && typeof raw === "object") Object.assign(base, raw);
  return base as T;
}
