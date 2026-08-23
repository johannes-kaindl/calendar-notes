import { ButtonComponent, FuzzySuggestModal, Modal, Notice, Setting, type App } from "obsidian";
import { parseEvents, primaryEvent } from "../core/ical/event";
import type { FieldSchema, ObjectSchema } from "../core/commands/schema";
import { validateInput } from "../core/commands/schema";
import type { CommandContext, CommandDescriptor } from "../core/commands/types";
import { parseContact } from "../core/vcard/contact";
import { fieldLabel } from "./field-labels";
import { t } from "../i18n/strings";

/**
 * Vorbelegung eines Kommando-Formulars aus dem aktuellen Objektstand (`ctx.raw`) — nur fuer
 * Felder, die im Schema vorkommen UND deren Server-Datenmodell direkt einen passenden Wert
 * hat (Titel, Ort, Zeiten, Name, …). Felder wie „index"/„value"/„email" (Hinzufuegen/Entfernen
 * einzelner Eintraege) bleiben bewusst leer — es gibt keinen sinnvollen Ausgangswert dafuer.
 * Pure — kein Obsidian-Zugriff, damit sie ohne Modal getestet werden kann.
 */
export function initialValuesFor(descriptor: CommandDescriptor, ctx: CommandContext): Record<string, unknown> {
  const props = descriptor.schema.properties;
  const out: Record<string, unknown> = {};
  if (!("href" in ctx.target) || ctx.raw === undefined) return out;

  if (ctx.profile.kind === "event") {
    const ev = primaryEvent(parseEvents(ctx.raw));
    if (!ev) return out;
    if ("title" in props) out["title"] = ev.summary;
    if ("location" in props) out["location"] = ev.location ?? "";
    if ("url" in props) out["url"] = ev.url ?? "";
    if ("description" in props) out["description"] = ev.description ?? "";
    if ("start" in props) out["start"] = ev.start;
    if ("end" in props) out["end"] = ev.end ?? "";
    if ("allDay" in props) out["allDay"] = ev.allDay;
    if ("tzid" in props) out["tzid"] = ev.tzid ?? "";
  } else {
    const c = parseContact(ctx.raw);
    if ("fn" in props) out["fn"] = c.fn;
    if ("given" in props) out["given"] = c.n?.given ?? "";
    if ("family" in props) out["family"] = c.n?.family ?? "";
    if ("org" in props) out["org"] = (c.org ?? []).join("\n");
    if ("title" in props) out["title"] = c.title ?? "";
    if ("note" in props) out["note"] = c.note ?? "";
    if ("bday" in props) out["bday"] = c.bday ?? "";
  }
  return out;
}

/** `String(unknown)` faellt bei Objekten auf `[object Object]` zurueck (eslint
 *  `no-base-to-string`) — hier reichen die drei Formular-Wertarten (Text/Zahl/Toggle liefern
 *  String/String/boolean), alles andere wird als leerer String behandelt statt geraten. */
function scalarToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Roh-Formularwerte (aus den Setting-Komponenten — Strings fuer Text/TextArea/Dropdown,
 * `boolean` fuer Toggle) auf die vom Schema erwarteten Typen bringen: Zahl parsen, Array aus
 * Zeilen einer TextArea bilden, leere OPTIONALE Felder weglassen (sonst wuerde z. B. ein
 * leeres, nicht ausgefuelltes `end` als ungueltiges Datum durchfallen). Pure — Verdrahtung mit
 * `validateInput` passiert im Modal.
 */
export function parseFormValues(schema: ObjectSchema, raw: Record<string, unknown>): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    const v = raw[key];
    if (v === undefined) continue;
    if (field.type === "boolean") {
      out[key] = Boolean(v);
      continue;
    }
    if (field.type === "number") {
      const s = scalarToString(v).trim();
      if (s === "" && !required.has(key)) continue;
      out[key] = Number(s);
      continue;
    }
    if (field.type === "array") {
      const s = typeof v === "string" ? v : "";
      const items = s.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);
      if (items.length === 0 && !required.has(key)) continue;
      out[key] = items;
      continue;
    }
    const s = scalarToString(v);
    if (s === "" && !required.has(key)) continue;
    out[key] = s;
  }
  return out;
}

interface ContactCandidate {
  email: string;
  display: string;
}

/** Best-effort Kontakt-Liste fuer den E-Mail-Suggester: alle Notizen mit einem Frontmatter-Feld
 *  „email" (Standard-Feldname des Standardprofils). Bewusst schlicht — ein vollstaendiger
 *  Profil-genauer Index existiert schon in `plugin-host.ts::buildAttendeeIndex` fuer die
 *  RUECK-Richtung (E-Mail → Notiz); hier geht es um die HIN-Richtung (Notiz durchsuchen). */
function contactCandidates(app: App): ContactCandidate[] {
  const out: ContactCandidate[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    const raw: unknown = fm?.["email"];
    if (typeof raw === "string" && raw !== "") out.push({ email: raw, display: file.basename });
  }
  return out;
}

class ContactSuggestModal extends FuzzySuggestModal<ContactCandidate> {
  constructor(app: App, private readonly candidates: ContactCandidate[], private readonly onChoose: (c: ContactCandidate) => void) {
    super(app);
    this.setPlaceholder(t("form.chooseContact.placeholder"));
  }
  getItems(): ContactCandidate[] {
    return this.candidates;
  }
  getItemText(c: ContactCandidate): string {
    return `${c.display} <${c.email}>`;
  }
  onChooseItem(c: ContactCandidate): void {
    this.onChoose(c);
  }
}

/**
 * Baut aus `descriptor.schema` ein Formular auf (eine `Setting`-Zeile je Feld) und ruft
 * `onSubmit` erst nach erfolgreicher `validateInput`-Pruefung mit dem validierten Objekt auf.
 * Formular-Layout: string→Text (multiline→TextArea, date-time/date→Text mit Platzhalter,
 * email→Text + „Kontakt waehlen"-Knopf), number→Text, boolean→Toggle, enum→Dropdown,
 * array<string>→TextArea (eine Zeile je Eintrag).
 */
export class SchemaFormModal extends Modal {
  private readonly values: Record<string, unknown>;
  private errorsEl!: HTMLDivElement;

  constructor(
    app: App,
    private readonly descriptor: CommandDescriptor,
    private readonly ctx: CommandContext,
    private readonly onSubmit: (input: Record<string, unknown>) => void,
  ) {
    super(app);
    this.values = initialValuesFor(descriptor, ctx);
  }

  onOpen(): void {
    this.titleEl.setText(this.descriptor.title);
    if (this.descriptor.description) this.contentEl.createEl("p", { text: this.descriptor.description, cls: "setting-item-description" });

    for (const [key, field] of Object.entries(this.descriptor.schema.properties)) {
      this.renderField(key, field);
    }

    this.errorsEl = this.contentEl.createDiv({ cls: "calendar-notes-form-errors" });

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("form.cancel")).onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("form.submit"))
      .setCta()
      .onClick(() => this.submit());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderField(key: string, field: FieldSchema): void {
    const setting = new Setting(this.contentEl).setName(fieldLabel(key));
    if (field.description) setting.setDesc(field.description);
    const initial = this.values[key];

    if (field.type === "boolean") {
      setting.addToggle((c) => {
        c.setValue(Boolean(initial ?? false));
        this.values[key] = c.getValue();
        c.onChange((v) => {
          this.values[key] = v;
        });
      });
      return;
    }

    if (field.type === "array") {
      setting.addTextArea((c) => {
        c.setValue(typeof initial === "string" ? initial : "");
        this.values[key] = c.getValue();
        c.inputEl.rows = 4;
        c.onChange((v) => {
          this.values[key] = v;
        });
      });
      return;
    }

    if (field.type === "number") {
      setting.addText((c) => {
        c.setValue(initial !== undefined ? scalarToString(initial) : "");
        this.values[key] = c.getValue();
        c.onChange((v) => {
          this.values[key] = v;
        });
      });
      return;
    }

    // string
    if (field.enum) {
      setting.addDropdown((c) => {
        for (const opt of field.enum ?? []) c.addOption(opt, opt);
        const start = typeof initial === "string" ? initial : (field.enum?.[0] ?? "");
        c.setValue(start);
        this.values[key] = c.getValue();
        c.onChange((v) => {
          this.values[key] = v;
        });
      });
      return;
    }

    if (field.format === "multiline") {
      setting.addTextArea((c) => {
        c.setValue(typeof initial === "string" ? initial : "");
        this.values[key] = c.getValue();
        c.inputEl.rows = 6;
        c.onChange((v) => {
          this.values[key] = v;
        });
      });
      return;
    }

    let textComponent: { setValue(v: string): unknown } | undefined;
    setting.addText((c) => {
      c.setValue(typeof initial === "string" ? initial : "");
      this.values[key] = c.getValue();
      if (field.format === "date-time") c.setPlaceholder(t("form.placeholder.dateTime"));
      else if (field.format === "date") c.setPlaceholder(t("form.placeholder.date"));
      c.onChange((v) => {
        this.values[key] = v;
      });
      textComponent = c;
    });

    if (field.format === "email") {
      setting.addButton((b) =>
        b.setButtonText(t("form.chooseContact")).onClick(() => {
          new ContactSuggestModal(this.app, contactCandidates(this.app), (chosen) => {
            this.values[key] = chosen.email;
            textComponent?.setValue(chosen.email);
          }).open();
        }),
      );
    }
  }

  private renderErrors(errors: string[]): void {
    this.errorsEl.empty();
    for (const e of errors) this.errorsEl.createEl("p", { text: e });
  }

  private submit(): void {
    const parsed = parseFormValues(this.descriptor.schema, this.values);
    const result = validateInput(this.descriptor.schema, parsed);
    if (!result.ok) {
      this.renderErrors(result.errors);
      new Notice(t("notice.formInvalid"));
      return;
    }
    this.onSubmit(result.value);
    this.close();
  }
}
