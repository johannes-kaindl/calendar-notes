import { ButtonComponent, DropdownComponent, Modal, type App } from "obsidian";
import type { ClassifiedTodo, TodoGroup } from "../core/sync/todo-collect";
import { t } from "../i18n/strings";

export type Entscheidung = "vault" | "server" | "skip";
export interface TodoSyncAuswahl {
  note: ClassifiedTodo;
  entscheidung: Entscheidung;
}

/**
 * Angehakt ist, was der Nutzer erkennbar gewollt hat: wer abhakt oder anlegt, hat gehandelt,
 * und der Upload ist die Fortsetzung dieser Handlung. Ein Konflikt dagegen ist kein Wunsch,
 * sondern eine Lage — dort entscheidet die Vorbelegung nichts, schon gar nicht "server",
 * das Nutzerarbeit verwirft.
 */
export function vorbelegung(c: ClassifiedTodo): Entscheidung {
  return c.group === "conflict" ? "skip" : "vault";
}

/**
 * Auswahl-Karte → Sendeliste. Pur und exportiert, weil der Senden-Knopf seine Zahl nach JEDER
 * Aenderung neu ziehen muss: eine einmal beim Aufbau gesetzte Beschriftung zeigt sonst dauerhaft
 * den Stand der Vorbelegung, waehrend die Dropdowns laengst etwas anderes sagen.
 *
 * Fehlt ein Eintrag in der Karte, gilt "ueberspringen" — was nicht bekannt ist, wird nicht
 * gesendet.
 */
export function gewaehlte(eintraege: ClassifiedTodo[], auswahl: Map<string, Entscheidung>): TodoSyncAuswahl[] {
  return eintraege
    .map((note) => ({ note, entscheidung: auswahl.get(note.note.path) ?? "skip" }))
    .filter((a) => a.entscheidung !== "skip");
}

const GRUPPEN: { key: TodoGroup; label: string }[] = [
  { key: "vault-only", label: "todoSync.group.vaultOnly" },
  { key: "new", label: "todoSync.group.new" },
  { key: "conflict", label: "todoSync.group.conflict" },
];

/**
 * Zeigt alle Aufgaben-Unterschiede gruppiert und laesst je Zeile entscheiden, welche Seite
 * gewinnt. Kreuzung aus `AdoptionModal` (Liste, Sammelknoepfe, gesammeltes Bestaetigen) und
 * `PlanPreviewModal` (Diff-Darstellung) — beide Muster kommen aus diesem Ordner.
 *
 * `nichtUebertragbar` liefert je Zeile die geaenderten Felder, fuer die es kein Server-Feld
 * gibt (Spec §4). Als Parameter statt als Eigenwissen, weil dafuer das Mapping-Profil noetig
 * ist und das Modal keine Einstellungen kennt.
 */
export class TodoSyncModal extends Modal {
  private readonly auswahl = new Map<string, Entscheidung>();
  private readonly dropdowns = new Map<string, DropdownComponent>();
  private sendenKnopf?: ButtonComponent;

  constructor(
    app: App,
    private readonly eintraege: ClassifiedTodo[],
    private readonly onSend: (a: TodoSyncAuswahl[]) => void,
    private readonly nichtUebertragbar: (c: ClassifiedTodo) => string[] = () => [],
  ) {
    super(app);
    for (const e of eintraege) this.auswahl.set(e.note.path, vorbelegung(e));
  }

  onOpen(): void {
    this.titleEl.setText(t("todoSync.title"));
    if (this.eintraege.length === 0) {
      this.contentEl.createEl("p", { text: t("todoSync.empty"), cls: "calendar-notes-invite-hint" });
      new ButtonComponent(this.contentEl.createDiv({ cls: "modal-button-container" }))
        .setButtonText(t("todoSync.cancel"))
        .onClick(() => this.close());
      return;
    }
    for (const g of GRUPPEN) this.gruppe(g);
    this.knopfleiste();
  }

  private gruppe(g: { key: TodoGroup; label: string }): void {
    const dieser = this.eintraege.filter((e) => e.group === g.key);
    if (dieser.length === 0) return;
    this.contentEl.createEl("h3", { text: t(g.label, dieser.length) });
    if (g.key === "conflict") {
      this.contentEl.createEl("p", { text: t("todoSync.conflict.hint"), cls: "calendar-notes-invite-hint" });
    }
    const tbody = this.contentEl.createEl("table", { cls: "calendar-notes-diff-table" }).createEl("tbody");
    for (const e of dieser) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: e.note.path });
      const felder = row.createEl("td");
      felder.createSpan({ text: e.changedKeys.join(", ") });
      // Was nicht mitgeht, wird VOR dem Senden genannt statt hinterher verschwiegen (Spec §4).
      const uebrig = this.nichtUebertragbar(e);
      if (uebrig.length > 0) {
        felder.createDiv({ text: t("todoSync.skippedFields", uebrig.join(", ")), cls: "calendar-notes-skipped-hint" });
      }
      const dd = new DropdownComponent(row.createEl("td"));
      dd.addOption("vault", t("todoSync.choice.vault"));
      if (g.key === "conflict") dd.addOption("server", t("todoSync.choice.server"));
      dd.addOption("skip", t("todoSync.choice.skip"));
      dd.setValue(this.auswahl.get(e.note.path) ?? "skip");
      dd.onChange((v) => {
        this.auswahl.set(e.note.path, v as Entscheidung);
        this.aktualisiereSendenKnopf();
      });
      this.dropdowns.set(e.note.path, dd);
    }
  }

  private knopfleiste(): void {
    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    // Sammelknoepfe setzen Karte UND sichtbares Dropdown — kein Neuaufbau des Modals noetig
    // (dasselbe Vorgehen wie `AdoptionModal.selectSure`).
    new ButtonComponent(btns)
      .setButtonText(t("todoSync.selectAll"))
      .onClick(() => this.setzeAlle((e) => (e.group === "conflict" ? undefined : "vault")));
    new ButtonComponent(btns).setButtonText(t("todoSync.selectNone")).onClick(() => this.setzeAlle(() => "skip"));
    new ButtonComponent(btns).setButtonText(t("todoSync.cancel")).onClick(() => this.close());
    this.sendenKnopf = new ButtonComponent(btns).setCta().onClick(() => {
      const a = gewaehlte(this.eintraege, this.auswahl);
      this.close();
      this.onSend(a);
    });
    this.aktualisiereSendenKnopf();
  }

  /** `undefined` heisst "diese Zeile nicht anfassen" — so laesst "Alle auswaehlen" die
   *  Konflikte in Ruhe, statt sie stillschweigend mitzuentscheiden. */
  private setzeAlle(wahl: (e: ClassifiedTodo) => Entscheidung | undefined): void {
    for (const e of this.eintraege) {
      const w = wahl(e);
      if (!w) continue;
      this.auswahl.set(e.note.path, w);
      this.dropdowns.get(e.note.path)?.setValue(w);
    }
    this.aktualisiereSendenKnopf();
  }

  private aktualisiereSendenKnopf(): void {
    this.sendenKnopf?.setButtonText(t("todoSync.send", gewaehlte(this.eintraege, this.auswahl).length));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
