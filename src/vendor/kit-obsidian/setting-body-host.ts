// vendored from obsidian-kit@0.106.0, src/obsidian/setting-body-host.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// obsidian-kit/src/obsidian/setting-body-host.ts
//
// Herausgelöst aus settings_walker.ts (Welle 34, Paket 6): wer nur eine Setting-Zeile zum leeren Block-Container
// machen will, vendort dieses Modul statt des Walkers samt FolderSuggest. Verhalten unverändert; settings_walker.ts
// re-exportiert die Funktion, damit bestehende Vendorings und Importe weiter tragen.
import type { Setting } from "obsidian";

/** Macht eine Setting-Zeile zum leeren Block-Container fuer Hatches mit
 *  Zusatz-DOM (Endpoint-Listen, Status-Anzeigen). Leert settingEl und entfernt
 *  die Zwei-Spalten-Klasse -- Name/Desc muss die Hatch selbst neu setzen. */
export function settingBodyHost(setting: Setting): HTMLElement {
  setting.settingEl.empty();
  setting.settingEl.removeClass("setting-item");
  return setting.settingEl;
}
