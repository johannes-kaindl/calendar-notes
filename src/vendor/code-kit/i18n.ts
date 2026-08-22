// vendored from code-kit@0.1.0, src/ts/pure/i18n.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// i18n-Engine (EN/DE) — pure (kein obsidian-/DOM-Import, PROF-OBS-03/04).
// Implementiert PROF-OBS-07 (_docs/docs/obsidian-i18n.md). Die Strings sind plugin-eigen
// und werden via defineStrings() injiziert; die Sprach-Detektion lebt in der obsidian-Schicht
// und ruft setLang() einmalig beim onload (vor addCommand/addRibbonIcon/addSettingTab).
export type Lang = "en" | "de";
type Dict = Record<string, string>;

let currentLang: Lang = "en";
let strings: Record<Lang, Dict> = { en: {}, de: {} };

/** Wählt die Sprache aus einem rohen Locale-String (z.B. von obsidian.getLanguage()). */
export function pickLang(raw?: string | null): Lang {
  return raw && raw.toLowerCase().startsWith("de") ? "de" : "en";
}

export function setLang(lang: Lang): void { currentLang = lang; }
export function getLang(): Lang { return currentLang; }

/** Registriert die Plugin-eigenen UI-Strings. Einmalig vor dem ersten t() (typisch im onload).
 *  EN ist kanonisch und universeller Fallback. */
export function defineStrings(dicts: Record<Lang, Dict>): void { strings = dicts; }

/** Übersetzt key in der aktuellen Sprache; Fallback currentLang → en → key. {0},{1}… aus args.
 *  @example t("view.cardHead", 3, 7, "foo") // "Image 3/7 · foo" (bei passendem Dict) */
export function t(key: string, ...args: (string | number)[]): string {
  const raw = strings[currentLang][key] ?? strings.en[key] ?? key;
  return raw.replace(/\{(\d+)\}/g, (_m, i) => {
    const v = args[Number(i)];
    return v === undefined ? `{${i}}` : String(v);
  });
}
