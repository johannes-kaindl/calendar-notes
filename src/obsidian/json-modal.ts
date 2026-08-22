import { ButtonComponent, Modal, TextAreaComponent, type App } from "obsidian";
import { t } from "../i18n/strings";

/** Kleines Textarea-Modal fuer Profil-JSON — dient sowohl dem Bearbeiten eines bestehenden
 *  Profils (vorbelegt) als auch dem Import (leer). Validierung/Parsing bleibt beim Aufrufer
 *  (dieses Modal reicht nur den rohen Text durch), damit es unabhaengig von `validateProfile`
 *  bleibt und keine core-Importe braucht. */
export class JsonModal extends Modal {
  private value: string;

  constructor(
    app: App,
    initial: string,
    private readonly onSave: (raw: string) => void,
  ) {
    super(app);
    this.value = initial;
  }

  onOpen(): void {
    this.titleEl.setText(t("settings.profiles.jsonTitle"));
    const textarea = new TextAreaComponent(this.contentEl);
    textarea.setValue(this.value).onChange((v) => {
      this.value = v;
    });
    textarea.inputEl.rows = 16;
    textarea.inputEl.addClass("calendar-notes-json-textarea");
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("settings.profiles.cancel")).onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("settings.profiles.save"))
      .setCta()
      .onClick(() => {
        this.onSave(this.value);
        this.close();
      });
  }
}
