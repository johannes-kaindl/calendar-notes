import { ButtonComponent, FuzzySuggestModal, Modal, Notice, TextAreaComponent, type App } from "obsidian";
import { buildImip, type ImipLabels } from "../core/commands/imip";
import type { MailTransport } from "../core/api/types";
import type { CommandPlan } from "../core/commands/types";
import type { Account } from "../core/settings";
import { t } from "../i18n/strings";
import { joinVaultPath, vaultDirname } from "../vendor/kit/vault-path";

/** Fix-Runde 1, Punkt 4: EINE Deklaration statt zweier — vorher trug `invite.ts` eine
 *  eigenstaendige Kopie neben `src/core/api/types.ts` (dort aus `check:pure`-Gruenden noetig,
 *  hier war sie es nicht: `src/obsidian/**` darf Obsidian UND core importieren, nur core darf
 *  nicht obsidian importieren). Re-Export, damit bestehende `from "./invite"`-Importe
 *  (`command-flow.ts`, `plugin-host.ts`, Tests) unveraendert bleiben. */
export type { MailTransport };

export type InviteRoute = "server" | "transport" | "ics";

/** Uebersetzte Labels fuer `buildImip` (core bleibt i18n-frei, s. `imip.ts`). Exportiert,
 *  weil `src/obsidian/api.ts` (Task 7) denselben iMIP-Bau fuer den `ics`-Rueckgabe-Fall
 *  braucht, ohne das `.ics`-Modal zu oeffnen. */
export function imipLabels(): ImipLabels {
  return {
    invitation: t("invite.label.invitation"),
    cancellation: t("invite.label.cancellation"),
    title: t("invite.label.title"),
    time: t("invite.label.time"),
    location: t("invite.label.location"),
    description: t("invite.label.description"),
  };
}

interface SenderIdentity {
  id: string;
  address: string;
  label: string;
}

class SenderSuggestModal extends FuzzySuggestModal<SenderIdentity> {
  constructor(app: App, private readonly identities: SenderIdentity[], private readonly onChoose: (a: SenderIdentity) => void) {
    super(app);
  }
  getItems(): SenderIdentity[] {
    return this.identities;
  }
  getItemText(a: SenderIdentity): string {
    return `${a.label} <${a.address}>`;
  }
  onChooseItem(a: SenderIdentity): void {
    this.onChoose(a);
  }
}

/** Letzter Weg, wenn weder der Server (RFC 6638 schedule-outbox) noch ein registrierter
 *  Mail-Transport verfuegbar ist: die fertige iMIP-`.ics` zum manuellen Verschicken. */
class IcsModal extends Modal {
  constructor(app: App, private readonly ics: string, private readonly uid: string, private readonly notePath: string | undefined) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("invite.icsTitle"));
    const textarea = new TextAreaComponent(this.contentEl);
    textarea.setValue(this.ics);
    textarea.inputEl.readOnly = true;
    textarea.inputEl.rows = 16;
    textarea.inputEl.addClass("calendar-notes-json-textarea");

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("invite.copy")).onClick(() => void this.copy());
    new ButtonComponent(btns)
      .setButtonText(t("invite.saveToVault"))
      .setCta()
      .onClick(() => void this.saveToVault());
  }

  private async copy(): Promise<void> {
    // Property-Read VOR jedem Zugriff pruefen (REGISTRY „Text in die Zwischenablage schreiben"):
    // in non-secure Contexts wirft schon das Lesen von `navigator.clipboard` synchron.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      new Notice(t("notice.clipboardUnavailable"));
      return;
    }
    try {
      await clipboard.writeText(this.ics);
      new Notice(t("notice.copied"));
    } catch (e) {
      new Notice(t("notice.copyFailed", e instanceof Error ? e.message : String(e)));
    }
  }

  private async saveToVault(): Promise<void> {
    const folder = this.notePath ? vaultDirname(this.notePath) : "";
    let path = joinVaultPath(folder, `einladung-${this.uid}.ics`);
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      n += 1;
      path = joinVaultPath(folder, `einladung-${this.uid}-${n}.ics`);
    }
    try {
      await this.app.vault.create(path, this.ics);
      new Notice(t("invite.saved", path));
      this.close();
    } catch (e) {
      new Notice(t("notice.unexpected", "Einladung speichern", e instanceof Error ? e.message : String(e)));
    }
  }
}

export interface DeliverOpts {
  now: Date;
  /** Pfad der Zielnotiz — bestimmt den Ordner der `.ics`-Datei im `ics`-Fallback (sonst Vault-Root). */
  notePath?: string;
}

/**
 * Waehlt den Einladungs-Weg (RFC 6638-Server → registrierter Mail-Transport → manuelle
 * `.ics`) und fuehrt ihn aus. `transports` ist eine Closure statt einer festen Liste, damit
 * immer der aktuelle Registrierungsstand gesehen wird (mailstone kann sich jederzeit
 * an-/abmelden, s. `plugin-host.ts`).
 */
export class InviteRouter {
  constructor(private readonly transports: () => MailTransport[], private readonly app: App) {}

  /** Async (Fix-Runde 1, Punkt 2): "transport" gilt nur, wenn IRGENDEIN registrierter
   *  Transport mindestens eine Absender-Identitaet hat (`accounts()`) — vorher genuegte
   *  ein Transport OHNE eine einzige Identitaet, `deliver()` fiel dann live auf
   *  `noSenderAccounts` zurueck, obwohl `plan.inviteRoute` schon "transport" versprochen
   *  hatte. Ein werfender `accounts()`-Aufruf blockiert die Routen-Wahl nicht — naechster
   *  Transport bzw. Fallback `ics`. */
  async route(account: Account, _plan: CommandPlan): Promise<InviteRoute> {
    if (account.scheduling?.outbox) return "server";
    for (const transport of this.transports()) {
      try {
        const identities = await transport.accounts();
        if (identities.length > 0) return "transport";
      } catch {
        // ein kaputter Transport darf die Routen-Wahl nicht abbrechen
      }
    }
    return "ics";
  }

  async deliver(account: Account, plan: CommandPlan, opts: DeliverOpts): Promise<void> {
    if (!plan.invite) return;
    const routeKind = await this.route(account, plan);

    if (routeKind === "server") return; // Server verschickt selbst — nichts zu tun.

    if (routeKind === "transport") {
      const transport = this.transports()[0];
      if (!transport) return; // sollte durch route() ausgeschlossen sein
      const identities = await transport.accounts();
      const send = async (sender: SenderIdentity): Promise<void> => {
        const msg = buildImip(plan, plan.invite!.method, sender.id, { now: opts.now, labels: imipLabels() });
        const res = await transport.send(msg);
        if (res.ok) new Notice(t("invite.sent", transport.label));
        else new Notice(t("invite.sendFailed", res.error));
      };
      const only = identities[0];
      if (identities.length <= 1) {
        if (only) await send(only);
        else new Notice(t("invite.noSenderAccounts", transport.label));
        return;
      }
      new SenderSuggestModal(this.app, identities, (a) => void send(a)).open();
      return;
    }

    const uid = "uid" in plan.target ? plan.target.uid : plan.commandId;
    const msg = buildImip(plan, plan.invite.method, account.id, { now: opts.now, labels: imipLabels() });
    new IcsModal(this.app, msg.ics, uid, opts.notePath).open();
  }
}
