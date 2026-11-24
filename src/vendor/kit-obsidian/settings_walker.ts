// vendored from obsidian-kit@0.106.0, src/obsidian/settings_walker.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// obsidian-kit/src/obsidian/settings_walker.ts
//
// Der gemeinsame Fallback-Walker fuer zweigleisige deklarative Settings-Tabs
// (Obsidian >=1.13 fragt getSettingDefinitions() selbst ab; darunter ruft der
// Host display(), das DIESELBE Struktur mit der klassischen Setting-API
// nachzeichnet). Gehoben aus 9 unabhaengigen Kopien, REGISTRY „Zweigleisige
// deklarative Settings — eine-Wahrheit-Walker".
//
// ## Zahlenfeld (`control.type === "number"`): nativ und Fallback gemessen (Welle 36, k9c; Obsidian 1.15.1, `pilot/settings-zahl.ts`, echte Eingabe)
//
// Das Kit baut den **nativen** Weg nicht: ab 1.13 liest Obsidian die Deklaration der Konsumenten (`getSettingDefinitions`) selbst und zeichnet `SettingNumberControl`; `renderSettingDefinitions` ist nur der Fallback darunter.
// Das Kit kann am nativen Weg also nichts formen, nur den Fallback an ihn angleichen. Deklaration `{ min: 1, max: 10, defaultValue: 5 }`, gespeicherter Wert vorher 5; jede Zeile eine Eingabe im Feld, dann Blur:
//
// | Eingabe | nativ speichert | Fallback bis 0.95.0 | Fallback jetzt |
// |---|---|---|---|
// | 0, −3 (unter min) | nichts, Feld behält die Eingabe | 1 (geklemmt) | nichts |
// | 11, 12 (über max) | nichts, Feld behält die Eingabe | 10 (geklemmt) | nichts |
// | 1, 10 (die Grenzen), 2.5 | der Wert | der Wert | der Wert |
// | leer, „abc“ (das Feld bleibt leer) | `defaultValue` (5), das Feld zeigt 5 | nichts | `defaultValue` (5), das Feld zeigt 5 |
// | Feld ohne Schrittweite | `step="any"` | kein `step` | `step="any"` |
//
// **Was der Fallback nicht angleicht, mit Grund:** ohne `defaultValue` in der Deklaration speichert nativ ein leeres Feld `0` (Typdoku: „falls back to `defaultValue` (or `0`)“); der Fallback speichert dann nichts,
// denn eine stille 0 ist der Fehler, den vault-crews meldete (Zeitlimit 0 bricht jeden Lauf ab). **Folgerung für Konsumenten:** jedes Zahlenfeld, dessen 0 kein gültiger Wert ist, deklariert `defaultValue`; nur dann ist das
// Ergebnis auf beiden Wegen gleich. Gemessen ist der native Weg nur für Eingaben im Feld; ob er beim Tippen jeder Ziffer oder erst beim Übernehmen schreibt, ist nicht unterschieden (ein `change` je Eingabe, die Schreibaufrufe
// stehen je Eingabe in der Tabelle des Piloten).
import { Setting, type App, type PluginSettingTab, type SettingControl, type SettingDefinitionGroup, type SettingDefinitionItem } from "obsidian";
import { FolderSuggest } from "./folder-suggest";

export interface SettingControlHost {
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): void | Promise<void>;
}

type RenderHatch = (setting: Setting) => void | (() => void);

/** Der Wert eines Zahlenfelds für `save`, wie ihn Obsidians nativer `SettingNumberControl` (gemessen an 1.15.1, `pilot/settings-zahl.ts`) behandelt: eine Zahl innerhalb von `[min, max]` (die Grenzen selbst und Dezimalzahlen
 *  gelten, eine fehlende Grenze entfällt) ist der Wert; **außerhalb der Grenzen ist es kein Wert** (`undefined`, es wird nichts gespeichert, das Feld behält die Eingabe: 0, −3, 11 und 12 bei `min: 1, max: 10`
 *  speicherten nativ nichts; bis Welle 36 klemmte der Fallback hier auf die Grenze). Ein leeres Feld, nur Leerraum, `NaN` und eine unendliche Zahl sind ebenfalls kein Wert. Die Schrittweite `step` ist ein
 *  Eingabehinweis des Feldes, hier wird nicht auf sie gerundet. */
function parseNumberInput(raw: string, min?: number, max?: number): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (min !== undefined && n < min) return undefined;
  if (max !== undefined && n > max) return undefined;
  return n;
}

// `settingBodyHost` liegt seit 0.89.0 in setting-body-host.ts (Welle 34, Paket 6); der Re-Export haelt bestehende Importe und Vendorings dicht.
export { settingBodyHost } from "./setting-body-host";

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
 *  ein Tab, der den Hook nicht installiert, verhaelt sich wie zuvor.
 *
 *  **Vertrag (gemessen an Obsidian 1.14.5, Pilot `tab-refresh`, 2026-10-25, Task „installTabRefreshOnOpen hängt sich nicht ein“):**
 *  `renderTab` ist beim Bau des Tabs und nach `addSettingTab` eine Funktion; der Hook ersetzt sie, in beiden Einbaustellen (Konstruktor und
 *  nach `addSettingTab`), und jedes Öffnen baut neu auf (zwei Aufbauten beim ersten Öffnen, einer je weiteres). Die Vermutung „`renderTab`
 *  existiert beim `new PluginSettingTab()` noch nicht“ trifft nicht zu. **Der Hook trägt nur, solange er installiert bleibt:** das Öffnen ruft
 *  `renderTab()`, nicht `display()`. Wer den zurückgegebenen Abbau in `hide()` ruft (slide-deck, settings-assistant, json-editor, lingotuner,
 *  image-to-markdown, gemessen als Variante E), baut beim ersten Öffnen auf und danach nie wieder; ein Blick auf `tab.renderTab` am offenen Tab
 *  zeigt dann die native Funktion. **Der Abbau gehört in `onunload` des Plugins, nicht in `hide()`** (ghostline lässt ihn in `hide()` weg und
 *  installiert bei Bedarf neu, Final-Review M3). Ein bloßes `update()` in `hide()` (Variante C) und das Leeren des Containers in `hide()`
 *  (Variante D) bauen beim Öffnen nicht auf. **Ungemessen:** ob die native `renderTab` in 1.14.5 bei gleicher `settingItems.length` immer neu
 *  zeichnet (in der Messung tat sie es an einer Render-Definition ohne Hook; die 1.14.2-Messung oben sah es nicht) und ob das für Definitionen
 *  mit `control` gilt. */
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
      case "number": {
        const c = control as { placeholder?: string; min?: number; max?: number; step?: number | "any"; defaultValue?: number };
        setting.addText((t) => {
          t.setPlaceholder(c.placeholder ?? "")
            .setValue(String(current))
            .onChange((v) => {
              const n = parseNumberInput(v, c.min, c.max);
              if (n !== undefined) save(n);
            });
          // Dieselben Grenzen wie der native Weg (1.13: `SettingNumberControl` bekommt `min`/`max`/`step` aus derselben Deklaration): das Feld ist ein Zahlenfeld mit den gesetzten Attributen.
          t.inputEl.type = "number";
          if (c.min !== undefined) t.inputEl.setAttribute("min", String(c.min));
          if (c.max !== undefined) t.inputEl.setAttribute("max", String(c.max));
          t.inputEl.setAttribute("step", String(c.step ?? "any"));   // ohne Deklaration trägt auch das native Feld step="any" (gemessen 1.15.1): Dezimalzahlen gelten, das Feld markiert 2.5 nicht als ungültig
          // Beim Übernehmen (`change`, also Blur oder Enter) verhält sich der native Weg bei leerem oder unlesbarem Feld so: er speichert `defaultValue` und zeigt es an (gemessen 1.15.1: leer und „abc“ → 5 bei `defaultValue: 5`).
          // Der Fallback tut dasselbe, wenn die Deklaration einen `defaultValue` nennt; ohne ihn speichert er nichts (nativ wäre es `0`, und eine stille 0 ist der Fehler, den vault-crews meldete: Zeitlimit 0 bricht jeden Lauf ab).
          // Außerhalb der Grenzen speichern beide nichts und lassen die Eingabe stehen.
          t.inputEl.addEventListener("change", () => {
            const raw = String(t.inputEl.value ?? "");
            if (raw.trim() !== "" && Number.isFinite(Number(raw))) return;   // eine Zahl (auch außerhalb der Grenzen): wie nativ nichts weiter
            if (typeof c.defaultValue !== "number" || !Number.isFinite(c.defaultValue)) return;
            save(c.defaultValue);
            t.inputEl.value = String(c.defaultValue);
          });
        });
        break;
      }
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
