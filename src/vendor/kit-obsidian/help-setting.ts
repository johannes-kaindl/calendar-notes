// vendored from obsidian-kit@0.43.0, src/obsidian/help-setting.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { Setting } from "obsidian";
import type { SettingDefinitionRender } from "obsidian";

/** UI-STANDARD §8 „Hilfe-Zeile (Settings)": erste Setting-Zeile des Tabs, „Open documentation"
 *  auf den Doku-Index und ein `bug`-Knopf auf die GitHub-Issues. Native `Setting`, kein CSS,
 *  keine Überschrift. Texte kommen vom Plugin (Kit bleibt i18n-frei); die EN/DE-Fassungen
 *  unten sind Vorgaben zum Durchreichen. */
export interface HelpSettingTexts {
  name: string;
  desc: string;
  /** Beschriftung des Text-Knopfs. */
  openDocs: string;
  /** Tooltip des Icon-Knopfs — dort der einzige zugängliche Name. */
  reportIssue: string;
}

export interface HelpSettingOptions {
  docsUrl: string;
  issuesUrl: string;
  texts: HelpSettingTexts;
  /** Testbarkeit; Default `window.open(url, "_blank", "noopener,noreferrer")`. */
  open?: (url: string) => void;
}

export const HELP_SETTING_TEXTS_EN: HelpSettingTexts = {
  name: "Help",
  desc: "Getting started, how-tos and troubleshooting",
  openDocs: "Open documentation",
  reportIssue: "Report an issue",
};

export const HELP_SETTING_TEXTS_DE: HelpSettingTexts = {
  name: "Hilfe",
  desc: "Erste Schritte, Anleitungen und Fehlersuche",
  openDocs: "Dokumentation öffnen",
  reportIssue: "Problem melden",
};

/** Doku-Index und Issues eines Plugins auf GitHub. Muster von `docs_index.url` in
 *  `_docs/readme/readme-spec.json` (`…/blob/main/docs/README.md`, `{repo}` = Repo-Name). */
export function githubHelpUrls(repo: string, owner = "johannes-kaindl"): { docsUrl: string; issuesUrl: string } {
  const base = `https://github.com/${owner}/${repo}`;
  return { docsUrl: `${base}/blob/main/docs/README.md`, issuesUrl: `${base}/issues` };
}

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function applyHelpButtons(setting: Setting, opts: HelpSettingOptions): Setting {
  const open = opts.open ?? openExternal;
  return setting
    .addButton((btn) => btn.setButtonText(opts.texts.openDocs).onClick(() => { open(opts.docsUrl); }))
    .addExtraButton((btn) =>
      btn.setIcon("bug").setTooltip(opts.texts.reportIssue).onClick(() => { open(opts.issuesUrl); }),
    );
}

/** Für Tabs mit `display()`: die Zeile als erste Setting des Tabs. Tabs mit
 *  `getSettingDefinitions()` (ab Obsidian 1.13 ruft der Host `display()` nie auf) nehmen
 *  stattdessen `helpSettingDefinition` als erstes Element. */
export function buildHelpSetting(containerEl: HTMLElement, opts: HelpSettingOptions): Setting {
  return applyHelpButtons(new Setting(containerEl).setName(opts.texts.name).setDesc(opts.texts.desc), opts);
}

/** Dieselbe Zeile als deklarative Definition (Render-Hatch, `SettingDefinitionRender`): trägt im
 *  nativen 1.13-Host wie im Fallback `renderSettingDefinitions`. Name und Beschreibung setzt der
 *  Hatch selbst noch einmal — idempotent, denn ob der Host sie vor `render` setzt, ist ungemessen. */
export function helpSettingDefinition(opts: HelpSettingOptions): SettingDefinitionRender {
  return {
    name: opts.texts.name,
    desc: opts.texts.desc,
    render: (setting) => {
      applyHelpButtons(setting.setName(opts.texts.name).setDesc(opts.texts.desc), opts);
    },
  };
}
