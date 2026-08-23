import { ButtonComponent, Modal, type App } from "obsidian";
import type { NotePlan } from "../core/mirror/plan";
import type { CollectionRunResult, RunResult } from "../core/sync/types";
import { t } from "../i18n/strings";

export interface PerCollectionSummary {
  id: string;
  counts: CollectionRunResult["counts"];
  error?: string;
  skippedReason?: string;
}

export interface PlanSummary {
  path: string;
  detail?: string;
}

export interface RunSummary {
  perCollection: PerCollectionSummary[];
  byOp: Record<NotePlan["op"], PlanSummary[]>;
  total: number;
}

/** set/unset-Keys + „Body" bei update, der Löschmodus bei delete — sonst keine Details
 *  (create/archive/skip zaehlen im Modal nur, s. summarizeRun-Aufrufer). */
function detailOf(p: NotePlan): string | undefined {
  if (p.op === "update") {
    const bits: string[] = [];
    if (Object.keys(p.set).length > 0) bits.push(`set: ${Object.keys(p.set).join(", ")}`);
    if (p.unset.length > 0) bits.push(`unset: ${p.unset.join(", ")}`);
    if (p.body !== undefined) bits.push("Body");
    return bits.length > 0 ? bits.join("; ") : undefined;
  }
  if (p.op === "delete") return p.mode;
  return undefined;
}

/** Pure Gruppierung eines Sync-Laufs für die Vorschau — kein Obsidian-/DOM-Zugriff. */
export function summarizeRun(r: RunResult): RunSummary {
  const perCollection: PerCollectionSummary[] = r.collections.map((c) => ({
    id: c.collectionId,
    counts: c.counts,
    ...(c.error !== undefined ? { error: c.error } : {}),
    ...(c.skippedReason !== undefined ? { skippedReason: c.skippedReason } : {}),
  }));

  const byOp: Record<NotePlan["op"], PlanSummary[]> = { create: [], update: [], skip: [], archive: [], delete: [] };
  let total = 0;
  for (const c of r.collections) {
    for (const p of c.plans) {
      total++;
      const detail = detailOf(p);
      byOp[p.op].push({ path: p.path, ...(detail !== undefined ? { detail } : {}) });
    }
  }
  return { perCollection, byOp, total };
}

const OPS: NotePlan["op"][] = ["create", "update", "archive", "delete", "skip"];

/** Vorschau eines Trockenlaufs: Gesamtzahl, Zähler/Fehler je Sammlung, Zahlen je Operation,
 *  Hand-Edit-Hinweis. „Jetzt ausführen" ruft `onExecute` und schließt; „Schließen" schließt nur. */
export class PreviewModal extends Modal {
  constructor(
    app: App,
    private readonly result: RunResult,
    private readonly onExecute: () => void,
    /** Anzeigename je Sammlung — ohne Resolver erscheint die interne ID (col-…), und die sagt
     *  dem Nutzer nichts (gemessen 2026-08-23 an preview.png). */
    private readonly nameOf: (collectionId: string) => string = (id) => id,
  ) {
    super(app);
  }

  onOpen(): void {
    const summary = summarizeRun(this.result);
    this.titleEl.setText(t("preview.heading", summary.total));

    for (const c of summary.perCollection) {
      const label = this.nameOf(c.id);
      const line = c.error !== undefined
        ? t("preview.perCollection.error", label, c.error)
        : c.skippedReason !== undefined
          ? t("preview.perCollection.skipped", label, c.skippedReason)
          : t("preview.perCollection.counts", label, c.counts.created, c.counts.updated, c.counts.archived, c.counts.deleted, c.counts.skipped, c.counts.errors);
      this.contentEl.createEl("p", { text: line });
    }

    for (const op of OPS) {
      const list = summary.byOp[op];
      if (list.length === 0) continue;
      this.contentEl.createEl("p", { text: t(`preview.byOp.${op}`, list.length) });
    }

    const handEdited = this.result.collections.reduce((n, c) => n + c.handEdited.length, 0);
    if (handEdited > 0) this.contentEl.createEl("p", { text: t("preview.handEdited", handEdited) });

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("preview.close")).onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("preview.execute"))
      .setCta()
      .onClick(() => {
        this.onExecute();
        this.close();
      });
  }
}
