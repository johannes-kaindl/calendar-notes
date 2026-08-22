// vendored from obsidian-kit@0.28.0, src/obsidian/folder-suggest.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { AbstractInputSuggest, type App, type TFolder } from "obsidian";

/** Ordner-Autocomplete für ein Settings-Textfeld (REGISTRY „Ordner-Autocomplete
 *  im Settings-Textfeld", n=4: vault-rag → lig → kuro → apple-health).
 *  Zwei load-bearing Details, die beim Neubau typischerweise fehlen:
 *  (1) `dispatchEvent(new Event("input"))` in `selectSuggestion` — ohne das feuert
 *      Obsidians Setting-onChange nach einer Klick-Auswahl NICHT, der gewählte
 *      Ordner würde also nie gespeichert.
 *  (2) `slice(0, 20)` — deckelt die Vorschlagsliste in großen Vaults. */
export class FolderSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private textInputEl: HTMLInputElement,
  ) {
    super(app, textInputEl);
  }

  getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getAllFolders()
      .map((f: TFolder) => f.path)
      .filter((p: string) => p.toLowerCase().includes(q))
      .slice(0, 20);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(path);
    this.textInputEl.dispatchEvent(new Event("input"));
    this.close();
  }
}
