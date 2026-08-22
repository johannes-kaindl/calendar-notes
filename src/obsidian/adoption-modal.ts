import { ButtonComponent, DropdownComponent, Modal, type App } from "obsidian";
import type { AdoptDecision } from "../core/adopt/plan";
import type { AdoptionSuggestion, CandidateNote, MatchConfidence, ServerItem } from "../core/adopt/match";
import type { ContactData } from "../core/vcard/contact";
import type { EventData } from "../core/ical/event";
import type { MappingProfile } from "../core/mirror/profile";
import { t } from "../i18n/strings";

export type AdoptAction = AdoptDecision["action"];

/** Vorbelegte Aktion je Konfidenz: sure/likely verknuepfen von selbst, weak bleibt bewusst
 *  aus (der Mensch muss ihn aktiv bestaetigen, statt eine unsichere Zuordnung stillschweigend
 *  zu uebernehmen). Pure — vom Modal separiert, damit sie ohne DOM getestet werden kann. */
export function defaultAction(confidence: MatchConfidence): AdoptAction {
  return confidence === "weak" ? "skip" : "link";
}

/** Fuehrt Vorschlaege + je Zeile gewaehlte Aktion zu `AdoptDecision[]` zusammen. Fehlt ein
 *  Eintrag in `chosen` (kuerzer als `suggestions`), greift `defaultAction`. Pure — fuer
 *  Tests ohne Modal/DOM. */
export function collectDecisions(suggestions: AdoptionSuggestion[], chosen: AdoptAction[]): AdoptDecision[] {
  return suggestions.map((suggestion, i) => ({ suggestion, action: chosen[i] ?? defaultAction(suggestion.confidence) }));
}

export interface AdoptionModalInput {
  suggestions: AdoptionSuggestion[];
  unmatchedItems: ServerItem[];
  unmatchedNotes: CandidateNote[];
  profile: MappingProfile;
}

function itemLabel(item: ServerItem): string {
  return item.kind === "contact" ? (item.data as ContactData).fn : (item.data as EventData).summary;
}

/** Zeigt Adoptions-Vorschlaege (Server-Eintrag ↔ bestehende Notiz) als Tabelle mit einer
 *  Aktion je Zeile (verknuepfen/uebergehen/neu anlegen) und bestaetigt sie gesammelt.
 *  `onConfirm` fuehrt die eigentliche Verknuepfung aus (main.ts) — dieses Modal sammelt nur
 *  die Entscheidungen und schliesst sich danach selbst. */
export class AdoptionModal extends Modal {
  private readonly chosen: AdoptAction[];
  private readonly dropdowns: DropdownComponent[] = [];

  constructor(
    app: App,
    private readonly input: AdoptionModalInput,
    private readonly onConfirm: (decisions: AdoptDecision[]) => Promise<void>,
  ) {
    super(app);
    this.chosen = input.suggestions.map((s) => defaultAction(s.confidence));
  }

  onOpen(): void {
    const { suggestions, unmatchedItems, unmatchedNotes } = this.input;
    this.titleEl.setText(t("adopt.heading"));
    this.contentEl.createEl("p", { text: t("adopt.summary", suggestions.length, unmatchedItems.length, unmatchedNotes.length) });

    if (suggestions.length > 0) {
      const table = this.contentEl.createEl("table", { cls: "calendar-notes-adopt-table" });
      const headRow = table.createEl("thead").createEl("tr");
      for (const h of [t("adopt.col.note"), t("adopt.col.item"), t("adopt.col.reason"), t("adopt.col.action")]) {
        headRow.createEl("th", { text: h });
      }
      const tbody = table.createEl("tbody");
      suggestions.forEach((s, i) => {
        const row = tbody.createEl("tr");
        row.createEl("td", { text: s.note.basename });
        row.createEl("td", { text: itemLabel(s.item) });
        row.createEl("td", { text: `${s.reason} (${s.confidence}, ${s.detail})` });
        const dd = new DropdownComponent(row.createEl("td"));
        dd.addOptions({ link: t("adopt.action.link"), skip: t("adopt.action.skip"), create: t("adopt.action.create") });
        dd.setValue(this.chosen[i] ?? "skip");
        dd.onChange((v) => {
          this.chosen[i] = v as AdoptAction;
        });
        this.dropdowns.push(dd);
      });
    }

    if (unmatchedItems.length > 0) this.contentEl.createEl("p", { text: t("adopt.unmatchedItems", unmatchedItems.length) });
    if (unmatchedNotes.length > 0) this.contentEl.createEl("p", { text: t("adopt.unmatchedNotes", unmatchedNotes.length) });

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("adopt.selectSure")).onClick(() => {
      suggestions.forEach((s, i) => {
        if (s.confidence !== "sure") return;
        this.chosen[i] = "link";
        this.dropdowns[i]?.setValue("link");
      });
    });
    new ButtonComponent(btns).setButtonText(t("adopt.cancel")).onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("adopt.confirm"))
      .setCta()
      .onClick(() => {
        void this.onConfirm(collectDecisions(suggestions, this.chosen)).then(() => this.close());
      });
  }
}
