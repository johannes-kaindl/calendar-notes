// vendored from obsidian-kit@0.28.0, src/obsidian/confirm.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { App, ButtonComponent, Modal } from "obsidian";

export interface ConfirmOptions {
  /** Gesetzt → Modal-Titelzeile; weggelassen → titelloser Dialog. */
  title?: string;
  /** Ein Absatz oder mehrere <p>-Zeilen. */
  message: string | string[];
  /** Default "Confirm" — i18n-Plugins reichen t(...) durch (Kit bleibt i18n-frei). */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Default true → destruktiver Button (s. applyDestructive); false → setCta(). */
  warning?: boolean;
}

/** Markiert einen Button destruktiv — versionsunabhängig.
 *
 *  `setDestructive()` gibt es erst ab Obsidian **1.13**; der Vorgänger `setWarning()` ist
 *  ab 1.13 deprecated und wird im Community-Store-Review angemahnt. Ein harter Aufruf ist
 *  also in beide Richtungen falsch: `setWarning()` erzeugt einen Review-Befund, ein direktes
 *  `setDestructive()` wirft bei jedem Konsumenten mit `minAppVersion < 1.13` zur Laufzeit.
 *  Deshalb Laufzeit-Check statt Compile-Time-Annahme, mit der nativen CSS-Klasse als
 *  Fallback — sie ist genau das, was `setWarning()` intern setzt. */
export function applyDestructive(b: ButtonComponent): ButtonComponent {
  const bx = b as unknown as { setDestructive?: () => void };
  if (typeof bx.setDestructive === "function") bx.setDestructive();
  else b.buttonEl.addClass("mod-warning");
  return b;
}

/** Bestätigungs-Modal hinter einer Promise-Fassade (REGISTRY „Bestätigungs-Modal", n=5).
 *  Zwei load-bearing Details: finish() nullt den Callback VOR dem Auflösen (Button-Klick +
 *  nachlaufendes onClose lösen sonst doppelt auf bzw. rekursieren über close()), und
 *  onClose() → finish(false) (sonst hängt das Promise bei Esc/Klick-daneben). */
class ConfirmModal extends Modal {
  private done: ((confirmed: boolean) => void) | null;

  constructor(
    app: App,
    private readonly opts: ConfirmOptions,
    done: (confirmed: boolean) => void,
  ) {
    super(app);
    this.done = done;
  }

  onOpen(): void {
    if (this.opts.title !== undefined) this.titleEl.setText(this.opts.title);
    const lines = Array.isArray(this.opts.message) ? this.opts.message : [this.opts.message];
    for (const line of lines) this.contentEl.createEl("p", { text: line });
    const warning = this.opts.warning ?? true;
    // Button-Reihenfolge und -Container folgen UI-STANDARD §2 (verbindlich): Cancel links, Bestätigen
    // rechts, beide im nativen modal-button-container statt in einer Setting-Zeile.
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(this.opts.cancelLabel ?? "Cancel").onClick(() => { this.finish(false); });
    const confirmBtn = new ButtonComponent(btns)
      .setButtonText(this.opts.confirmLabel ?? "Confirm")
      .onClick(() => { this.finish(true); });
    if (warning) applyDestructive(confirmBtn);
    else confirmBtn.setCta();
  }

  onClose(): void {
    this.finish(false);
    this.contentEl.empty();
  }

  private finish(confirmed: boolean): void {
    if (!this.done) return;
    const cb = this.done;
    this.done = null;
    cb(confirmed);
    this.close();
  }
}

/** Öffnet den Dialog; resolved true nur bei explizitem Bestätigen.
 *  @example if (await confirmAction(app, { message: "Alles löschen?" })) { … } */
export function confirmAction(app: App, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, opts, resolve).open();
  });
}
