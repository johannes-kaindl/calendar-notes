import { ButtonComponent, Modal, Notice, type App } from "obsidian";
import type { CommandPlan } from "../core/commands/types";
import type { ExecuteResult } from "../core/sync/execute";
import { t } from "../i18n/strings";
import { trPlan } from "./command-i18n";
import { describeExecuteError } from "./execute-i18n";
import { fieldLabel } from "./field-labels";

/** Diff-Zeilen fuers Anzeigen — Feldname uebersetzt (dieselbe `fieldLabel()` wie im
 *  Formular, s. `command-modal.ts`, damit `allDay` z. B. auch hier „Ganztägig"/„All day"
 *  zeigt statt des rohen Schema-Schluessels), `—` statt `undefined` fuer fehlende
 *  Vorher/Nachher-Werte. Pure, damit sie ohne Modal/DOM getestet werden kann. */
export function diffRows(plan: CommandPlan): { field: string; before: string; after: string }[] {
  return plan.diff.map((d) => ({ field: fieldLabel(d.field), before: d.before ?? "—", after: d.after ?? "—" }));
}

/**
 * Zeigt einen `CommandPlan` vor dem Ausfuehren: Zusammenfassung, Diff-Tabelle, optionaler
 * Einladungs-Hinweis (schon fertig formatiert vom Aufrufer uebergeben — der kennt die
 * Transport-Route). „Ausführen" ruft `onExecute`; bei Konflikt zeigt sich ein Hinweis + optional
 * „Mit frischem Stand erneut" (`onRetry`, schliesst dieses Modal und laesst den Aufrufer die
 * Kette mit frischem Zustand neu aufziehen — z. B. das Formular erneut oeffnen).
 */
export class PlanPreviewModal extends Modal {
  constructor(
    app: App,
    private readonly plan: CommandPlan,
    private readonly routeHint: string | undefined,
    private readonly onExecute: () => Promise<ExecuteResult>,
    private readonly onRetry?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.titleEl.setText(t("plan.heading"));
    this.contentEl.createEl("p", { text: trPlan(this.plan) });
    if (this.routeHint) this.contentEl.createEl("p", { text: this.routeHint, cls: "calendar-notes-invite-hint" });

    const rows = diffRows(this.plan);
    if (rows.length > 0) {
      const table = this.contentEl.createEl("table", { cls: "calendar-notes-diff-table" });
      const head = table.createEl("thead").createEl("tr");
      for (const h of [t("plan.col.field"), t("plan.col.before"), t("plan.col.after")]) head.createEl("th", { text: h });
      const body = table.createEl("tbody");
      for (const row of rows) {
        const tr = body.createEl("tr");
        tr.createEl("td", { text: row.field });
        tr.createEl("td", { text: row.before });
        tr.createEl("td", { text: row.after });
      }
    }

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("plan.cancel")).onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("plan.execute"))
      .setCta()
      .onClick(() => void this.execute());
  }

  private async execute(): Promise<void> {
    let result: ExecuteResult;
    try {
      result = await this.onExecute();
    } catch (e) {
      new Notice(t("notice.unexpected", t("op.command"), e instanceof Error ? e.message : String(e)));
      return;
    }
    if (result.ok) {
      this.close();
      return;
    }
    if (result.conflict) {
      this.contentEl.createEl("p", { text: t("plan.conflict"), cls: "calendar-notes-form-errors" });
      if (this.onRetry) {
        const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(btns)
          .setButtonText(t("plan.retry"))
          .setCta()
          .onClick(() => {
            this.close();
            this.onRetry?.();
          });
      }
      return;
    }
    new Notice(t("notice.unexpected", t("op.command"), describeExecuteError(result.error)));
    this.close();
  }
}
