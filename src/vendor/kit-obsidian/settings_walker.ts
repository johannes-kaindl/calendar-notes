// vendored from obsidian-kit@0.60.1, src/obsidian/settings_walker.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// obsidian-kit/src/obsidian/settings_walker.ts
//
// Der gemeinsame Fallback-Walker fuer zweigleisige deklarative Settings-Tabs
// (Obsidian >=1.13 fragt getSettingDefinitions() selbst ab; darunter ruft der
// Host display(), das DIESELBE Struktur mit der klassischen Setting-API
// nachzeichnet). Gehoben aus 9 unabhaengigen Kopien, REGISTRY „Zweigleisige
// deklarative Settings — eine-Wahrheit-Walker".
import { Setting, type App, type PluginSettingTab, type SettingControl, type SettingDefinitionGroup, type SettingDefinitionItem } from "obsidian";
import { FolderSuggest } from "./folder-suggest";

export interface SettingControlHost {
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): void | Promise<void>;
}

type RenderHatch = (setting: Setting) => void | (() => void);

/** Macht eine Setting-Zeile zum leeren Block-Container fuer Hatches mit
 *  Zusatz-DOM (Endpoint-Listen, Status-Anzeigen). Leert settingEl und entfernt
 *  die Zwei-Spalten-Klasse -- Name/Desc muss die Hatch selbst neu setzen. */
export function settingBodyHost(setting: Setting): HTMLElement {
  setting.settingEl.empty();
  setting.settingEl.removeClass("setting-item");
  return setting.settingEl;
}

/** Erkennt die native 1.13-update()-API (partielles Re-Render der deklarativen
 *  Registrierung); faellt sonst auf den uebergebenen vollen Rebuild zurueck. */
export function refreshSettingsTab(
  tab: PluginSettingTab & { update?: () => void },
  fullRebuild: () => void,
): void {
  const self = tab as unknown as { update?: () => void };
  if (typeof self.update === "function") self.update();
  else fullRebuild();
}

/** Haengt einen Refresh-Hook in `renderTab()`, der bei jedem Sichtbarwerden des Tabs neu
 *  zeichnet -- ohne die Rekursion, die ein naiver Override ausloest, UND ohne sich auf
 *  Obsidians native `update()`/`renderTab()`-Kombination zu verlassen, die dafuer
 *  (gemessen) nicht ausreicht.
 *
 *  Gemessen an Obsidian 1.14.2 (`app.setting`, yijing-w6 + yijing-w7, per CDP, echter
 *  Renderer): `openTab()` ruft `hide()` nur auf dem verlassenen Tab; der neu aktive Tab
 *  bekommt `renderTab()`. Dessen native Implementierung ist ein Cache-Kurzschluss nach
 *  Laenge -- bei UNVERAENDERTER `settingItems.length` zeichnet sie ueberhaupt nicht neu,
 *  auch wenn `settingItems` zuvor per `update()` durch ein frisches Array (neue Closures,
 *  z.B. ein neu installierter LLM Endpoint Manager) ersetzt wurde: `tab.update()` +
 *  `tab.renderTab()` liessen den zuvor gerenderten DOM-Baum unveraendert (Rekursionstest
 *  bestaetigte gleichzeitig: dieser Pfad wirft KEINEN `RangeError` mehr, weil unser
 *  Override den urspruenglichen Rekursionsausloeser -- ein bedingungsloser `update()`-Ruf
 *  in `renderTab()` -- gar nicht mehr benutzt). Einzig ein manueller `containerEl.empty()`
 *  + Neuzeichnen ueber den klassischen Setting-API-Walker (`renderSettingDefinitions`,
 *  also der Fallback-Pfad des Consumers) zeigte den frischen Inhalt zuverlaessig.
 *
 *  Der Hook ersetzt `renderTab()` deshalb vollstaendig durch `fullRebuild` -- ruft NIE
 *  die native Implementierung. Reentrancy-Guard bleibt trotzdem noetig: `fullRebuild`
 *  ruft ueblicherweise selbst `update()` (haelt `settingItems`/die Einstellungs-Suche
 *  synchron), und `update()`s native Implementierung ruft intern wieder `renderTab()` des
 *  aktiven Tabs auf -- ohne Guard waere das erneut `fullRebuild()` in Rekursion. Additiv:
 *  ein Tab, der den Hook nicht installiert, verhaelt sich wie zuvor. */
export function installTabRefreshOnOpen(
  tab: PluginSettingTab & { renderTab?: () => void },
  fullRebuild: () => void,
): () => void {
  const self = tab as unknown as { renderTab?: () => void };
  const original = self.renderTab;
  if (typeof original !== "function") return () => {};

  let inProgress = false;
  self.renderTab = (): void => {
    if (inProgress) return;
    inProgress = true;
    try {
      fullRebuild();
    } finally {
      inProgress = false;
    }
  };

  return (): void => {
    self.renderTab = original;
  };
}

/** Rendert eine deklarative Setting-Definition mit der klassischen Setting-API
 *  (Fallback-Pfad fuer Obsidian < 1.13). Rekursiv fuer Gruppen. Sammelt
 *  optionale Hatch-Cleanups und gibt sie gebuendelt zurueck -- der Aufrufer
 *  muss sie vor jedem Rebuild selbst laufen lassen (siehe Consumer-Pattern in
 *  den Migrations-Tasks). */
export function renderSettingDefinitions(
  containerEl: HTMLElement,
  items: SettingDefinitionItem[],
  host: SettingControlHost,
  app: App,
): () => void {
  const cleanups: Array<() => void> = [];

  function renderControl(setting: Setting, name: string, control: SettingControl): void {
    const current = host.getControlValue(control.key);
    const save = (value: unknown): void => {
      void host.setControlValue(control.key, value);
    };

    switch (control.type) {
      case "toggle":
        setting.addToggle((t) => t.setValue(current as boolean).onChange(save));
        break;
      case "dropdown":
        setting.addDropdown((d) => {
          for (const [k, v] of Object.entries(control.options)) d.addOption(k, v);
          d.setValue(String(current)).onChange(save);
        });
        break;
      case "slider": {
        const fmt = control.displayFormat;
        const label = (v: number): void => {
          if (fmt) setting.setName(`${name}: ${fmt(v)}`);
        };
        label(current as number);
        setting.addSlider((s) =>
          s
            .setLimits(control.min, control.max, control.step)
            .setValue(current as number)
            .onChange((v: number) => {
              save(v);
              label(v);
            }),
        );
        break;
      }
      case "textarea":
        setting.addTextArea((t) => {
          t.setValue(current as string).onChange(save);
          if (control.rows) t.inputEl.rows = control.rows;
        });
        break;
      case "folder":
        setting.addText((t) => {
          t.setPlaceholder((control as { placeholder?: string }).placeholder ?? "")
            .setValue(current as string)
            .onChange(save);
          new FolderSuggest(app, t.inputEl);
        });
        break;
      case "number":
        setting.addText((t) =>
          t
            .setPlaceholder((control as { placeholder?: string }).placeholder ?? "")
            .setValue(String(current))
            .onChange((v) => save(Number(v))),
        );
        break;
      case "text":
      default:
        setting.addText((t) =>
          t
            .setPlaceholder((control as { placeholder?: string }).placeholder ?? "")
            .setValue(String(current))
            .onChange(save),
        );
        break;
    }
  }

  function renderItem(parentEl: HTMLElement, item: SettingDefinitionItem): void {
    const visible = (item as { visible?: boolean | (() => boolean) }).visible;
    if (visible === false || (typeof visible === "function" && !visible())) return;

    if ((item as SettingDefinitionGroup).type === "group" || (item as { type?: string }).type === "list") {
      const group = item as SettingDefinitionGroup;
      if (group.heading) new Setting(parentEl).setName(group.heading).setHeading();
      for (const sub of group.items ?? []) renderItem(parentEl, sub);
      return;
    }

    const def = item as {
      name?: string;
      desc?: string;
      control?: SettingControl;
      render?: RenderHatch;
      action?: (el: HTMLElement, index: number) => void;
    };
    const setting = new Setting(parentEl);
    if (def.name) setting.setName(def.name);
    if (typeof def.desc === "string") setting.setDesc(def.desc);

    if (typeof def.render === "function") {
      const cleanup = def.render(setting);
      if (typeof cleanup === "function") cleanups.push(cleanup);
      return;
    }
    if (typeof def.action === "function") {
      const action = def.action;
      setting.addButton((b) => b.setButtonText(def.name ?? "").onClick(() => action(setting.settingEl, 0)));
      return;
    }
    if (def.control) renderControl(setting, def.name ?? "", def.control);
  }

  for (const item of items) renderItem(containerEl, item);

  return (): void => {
    for (const c of cleanups) {
      try {
        c();
      } catch {
        /* Cleanup best-effort — ein Fehler darf den Rest nicht blockieren */
      }
    }
    cleanups.length = 0;
  };
}
