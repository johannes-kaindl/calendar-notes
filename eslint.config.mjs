// Kanonischer Kern — Quelle: obsidian-plugins/tools/release-template/eslint.config.mjs.
// NIE von Hand editieren: tools/template_drift_check.py prueft Byte-Gleichheit gegen das
// Template; Aenderungen passieren IM Template und rollen per Vendoring in alle Repos.
//
// Das ist der lokale Spiegel des Community-Store-Scanners — dieselbe Regelquelle
// (eslint-plugin-obsidianmd), damit `npm run lint` == Store-Scan gilt. Repo-eigene
// Abweichungen (parserOptions aufs richtige tsconfig, begruendete file-scoped
// Overrides) gehoeren AUSSCHLIESSLICH nach ./eslint.overrides.mjs. Inline-
// `eslint-disable` blockt scripts/check-no-inline-disables.mjs im lint-Script.
import obsidianmd from "eslint-plugin-obsidianmd";
import overrides from "./eslint.overrides.mjs";

export default [
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "coverage/**",
      "tests/**",
      "docs/**",
      "scripts/**",
      ".remember/**",
      "*.config.mjs",
      "*.config.ts",
      "*.config.js",
    ],
  },
  ...obsidianmd.configs.recommended,
  ...overrides,
];
