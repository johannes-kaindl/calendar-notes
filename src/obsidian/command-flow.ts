import { FuzzySuggestModal, Notice, TFile, type App } from "obsidian";
import { commandsFor, findCommand } from "../core/commands/registry";
import { targetFromFrontmatter } from "../core/commands/target";
import type { CommandContext, CommandDescriptor, CommandPlan, CommandTarget } from "../core/commands/types";
import { planPushHandEdits } from "../core/commands/push-hand-edits";
import { planUndoLast } from "../core/commands/undo";
import { resolveHref } from "../core/dav/url";
import { effectiveProfile, sourceOf, type Account, type CollectionConfig } from "../core/settings";
import type { ObjectState } from "../core/state/collection-state";
import { executeCommandPlan, resyncObject, type ExecuteResult } from "../core/sync/execute";
import type { SyncDeps } from "../core/sync/types";
import { t } from "../i18n/strings";
import { SchemaFormModal } from "./command-modal";
import type { InviteRoute, InviteRouter, MailTransport } from "./invite";
import { PlanPreviewModal } from "./plan-preview-modal";
import { buildAttendeeIndex } from "./plugin-host";

/** Waehlt eine AKTIVIERTE Sammlung EINER Art (Kalender/Adressbuch) fuer „neuer Termin/Kontakt". */
class KindCollectionSuggestModal extends FuzzySuggestModal<CollectionConfig> {
  constructor(app: App, private readonly collections: CollectionConfig[], private readonly onChoose: (c: CollectionConfig) => void, placeholder: string) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): CollectionConfig[] {
    return this.collections;
  }
  getItemText(c: CollectionConfig): string {
    return c.displayName;
  }
  onChooseItem(c: CollectionConfig): void {
    this.onChoose(c);
  }
}

/** Waehlt eines der auf das aktuelle Ziel anwendbaren Kommandos. */
class CommandSuggestModal extends FuzzySuggestModal<CommandDescriptor> {
  constructor(app: App, private readonly descriptors: CommandDescriptor[], private readonly onChoose: (d: CommandDescriptor) => void) {
    super(app);
    this.setPlaceholder(t("cmd.run.placeholder"));
  }
  getItems(): CommandDescriptor[] {
    return this.descriptors;
  }
  getItemText(d: CommandDescriptor): string {
    return `${d.title} — ${d.description}`;
  }
  onChooseItem(d: CommandDescriptor): void {
    this.onChoose(d);
  }
}

interface ResolvedTarget {
  ctx: CommandContext;
  file: TFile;
  account: Account;
  collection: CollectionConfig;
  obj: ObjectState;
  rid: string;
}

/**
 * Orchestriert die Kommando-Kommandos (`command-run`, `command-new-event`,
 * `command-new-contact`, `command-undo`, `command-push-hand-edits`) — main.ts registriert nur
 * noch `addCommand`, die eigentliche Kette (Ziel erkennen → Formular → Vorschau → ausfuehren
 * → Einladung ausliefern) lebt hier, damit main.ts nicht weiter waechst.
 */
export class CommandFlow {
  constructor(
    private readonly app: App,
    private readonly deps: SyncDeps,
    private readonly inviteRouter: InviteRouter,
    private readonly mailTransports: () => MailTransport[],
  ) {}

  private fireAndForget(p: Promise<unknown>, what: string): void {
    p.catch((e: unknown) => new Notice(t("notice.unexpected", what, e instanceof Error ? e.message : String(e))));
  }

  // ── command-run ──────────────────────────────────────────────────────────
  runOnActiveNote(): void {
    this.fireAndForget(this.startRun(), t("op.command"));
  }

  private async startRun(): Promise<void> {
    const file = this.activeFileOrNotice();
    if (!file) return;
    const resolved = await this.resolveTarget(file);
    if (!resolved) return;
    const applicable = commandsFor(resolved.ctx);
    if (applicable.length === 0) {
      new Notice(t("notice.noApplicableCommands"));
      return;
    }
    new CommandSuggestModal(this.app, applicable, (descriptor) => this.openForm(descriptor, resolved)).open();
  }

  // ── command-new-event / command-new-contact ─────────────────────────────
  newEvent(): void {
    this.chooseCollectionForCreate("calendar", "event", t("cmd.newEvent.placeholder"));
  }

  newContact(): void {
    this.chooseCollectionForCreate("addressbook", "contact", t("cmd.newContact.placeholder"));
  }

  private chooseCollectionForCreate(kind: "calendar" | "addressbook", commandKind: "event" | "contact", placeholder: string): void {
    const settings = this.deps.settings();
    const enabled = settings.collections.filter((c) => c.enabled && c.kind === kind);
    if (enabled.length === 0) {
      new Notice(t("notice.noEnabledCollections"));
      return;
    }
    new KindCollectionSuggestModal(this.app, enabled, (col) => this.fireAndForget(this.startCreate(col, commandKind), t("op.command")), placeholder).open();
  }

  private async startCreate(collection: CollectionConfig, kind: "event" | "contact"): Promise<void> {
    const settings = this.deps.settings();
    const profile = effectiveProfile(settings, collection);
    const account = settings.accounts.find((a) => a.id === collection.accountId);
    if (!profile || !account) {
      new Notice(t("notice.notCommandTarget"));
      return;
    }
    const target: CommandTarget = { kind, source: sourceOf(collection), new: true };
    const ctx: CommandContext = {
      now: this.deps.now(), rand: Math.random, profile, collection, account, target,
      ...(account.scheduling ? { scheduling: account.scheduling } : {}),
      resolveContact: buildAttendeeIndex(this.app, settings),
    };
    const descriptor = findCommand(kind === "event" ? "event.create" : "contact.create");
    if (!descriptor) {
      new Notice(t("notice.notCommandTarget"));
      return;
    }
    new SchemaFormModal(this.app, descriptor, ctx, (input) => this.applyPlan(descriptor, input, ctx, undefined)).open();
  }

  // ── command-undo ─────────────────────────────────────────────────────────
  undoLast(): void {
    this.fireAndForget(this.runUndo(false), t("op.undo"));
  }

  private async runUndo(fresh: boolean): Promise<void> {
    const file = this.activeFileOrNotice();
    if (!file) return;
    const resolved = fresh ? await this.resolveTargetFresh(file) : await this.resolveTarget(file);
    if (!resolved) return;
    const plan = planUndoLast(resolved.ctx, resolved.obj.history);
    if (!plan) {
      new Notice(t("notice.noHistory"));
      return;
    }
    this.openPreview(plan, resolved, () => this.fireAndForget(this.runUndo(true), t("op.undo")));
  }

  // ── command-push-hand-edits ──────────────────────────────────────────────
  pushHandEdits(): void {
    this.fireAndForget(this.runPushHandEdits(false), t("op.pushHandEdits"));
  }

  private async runPushHandEdits(fresh: boolean): Promise<void> {
    const file = this.activeFileOrNotice();
    if (!file) return;
    const resolved = fresh ? await this.resolveTargetFresh(file) : await this.resolveTarget(file);
    if (!resolved) return;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const prevWritten = resolved.obj.notes[resolved.rid]?.written ?? {};
    const { plan, skipped } = planPushHandEdits(resolved.ctx, frontmatter, prevWritten);
    if (!plan) {
      new Notice(skipped.length > 0 ? t("notice.handEditsSkipped", skipped.map((s) => s.key).join(", ")) : t("notice.handEditsNone"));
      return;
    }
    this.openPreview(plan, resolved, () => this.fireAndForget(this.runPushHandEdits(true), t("op.pushHandEdits")));
  }

  // ── gemeinsame Bausteine ─────────────────────────────────────────────────
  private activeFileOrNotice(): TFile | undefined {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("notice.noActiveFile"));
      return undefined;
    }
    return file;
  }

  /** Loest die aktive Notiz zu ihrem vollen Kommando-Kontext auf: Frontmatter → Ziel-Erkennung
   *  (`targetFromFrontmatter`) → Sammlung/Profil/Konto → passendes `ObjectState` im
   *  Collection-State (per `uid` + `notes[rid].path` als Gegenprobe) → `href` per
   *  `resolveHref(collection.href, hp)` rekonstruiert (der State kennt nur den URL-Pfad).
   *  Meldet passende Notices und liefert `undefined`, wenn irgendein Schritt scheitert. */
  private async resolveTarget(file: TFile): Promise<ResolvedTarget | undefined> {
    const settings = this.deps.settings();
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const ft = targetFromFrontmatter(settings, frontmatter);
    if (!ft) {
      new Notice(t("notice.notCommandTarget"));
      return undefined;
    }
    const collection = settings.collections.find((c) => c.id === ft.collectionId);
    const profile = collection ? effectiveProfile(settings, collection) : undefined;
    const account = collection ? settings.accounts.find((a) => a.id === collection.accountId) : undefined;
    if (!collection || !profile || !account) {
      new Notice(t("notice.notCommandTarget"));
      return undefined;
    }
    const state = await this.deps.stateStore.load(ft.source);
    const rid = ft.recurrenceId ?? "";
    const entry = Object.entries(state.objects).find(([, o]) => o.uid === ft.uid && o.notes[rid]?.path === file.path);
    if (!entry) {
      new Notice(t("notice.stateObjectMissing"));
      return undefined;
    }
    const [hp, obj] = entry;
    const href = resolveHref(collection.href, hp);
    const target: CommandTarget = { kind: profile.kind, source: ft.source, href, uid: obj.uid };
    const ctx: CommandContext = {
      now: this.deps.now(), rand: Math.random, profile, collection, account, target,
      raw: obj.raw, etag: obj.etag,
      ...(account.scheduling ? { scheduling: account.scheduling } : {}),
      resolveContact: buildAttendeeIndex(this.app, settings),
    };
    return { ctx, file, account, collection, obj, rid };
  }

  /** Wie `resolveTarget`, zieht aber VORHER einmal gezielt den Server-Stand des Objekts nach
   *  (`resyncObject`) — genutzt fuer den „Mit frischem Stand erneut"-Pfad nach einem
   *  If-Match-Konflikt, damit der zweite Versuch nicht mit demselben veralteten Etag
   *  scheitert. Ein normaler Aufruf (`fresh: false` in `runUndo`/`runPushHandEdits`) spart
   *  sich diesen Request. */
  private async resolveTargetFresh(file: TFile): Promise<ResolvedTarget | undefined> {
    const first = await this.resolveTarget(file);
    if (!first) return undefined;
    const href = "href" in first.ctx.target ? first.ctx.target.href : undefined;
    if (!href) return first; // sollte durch resolveTarget() ausgeschlossen sein (baut immer ein href-Target)
    try {
      await resyncObject(this.deps, this.deps.settings(), first.collection.id, href);
    } catch (e) {
      new Notice(t("notice.unexpected", t("op.command"), e instanceof Error ? e.message : String(e)));
      return undefined;
    }
    return this.resolveTarget(file);
  }

  private openForm(descriptor: CommandDescriptor, resolved: ResolvedTarget): void {
    new SchemaFormModal(this.app, descriptor, resolved.ctx, (input) => this.applyPlan(descriptor, input, resolved.ctx, resolved.file)).open();
  }

  private applyPlan(descriptor: CommandDescriptor, input: Record<string, unknown>, ctx: CommandContext, file: TFile | undefined): void {
    let plan: CommandPlan;
    try {
      plan = descriptor.plan(input, ctx);
    } catch (e) {
      new Notice(t("notice.unexpected", descriptor.title, e instanceof Error ? e.message : String(e)));
      return;
    }
    const onRetry = file ? () => this.fireAndForget(this.retryForm(descriptor, file), t("op.command")) : undefined;
    this.openPreview(plan, { ctx, file, account: ctx.account }, onRetry);
  }

  private async retryForm(descriptor: CommandDescriptor, file: TFile): Promise<void> {
    const resolved = await this.resolveTargetFresh(file);
    if (!resolved) return;
    this.openForm(descriptor, resolved);
  }

  private routeHintFor(account: Account, plan: CommandPlan): string {
    const route: InviteRoute = this.inviteRouter.route(account, plan);
    if (route === "server") return t("plan.invite.server");
    if (route === "transport") {
      const transport = this.mailTransports()[0];
      return t("plan.invite.transport", transport?.label ?? "");
    }
    return t("plan.invite.ics");
  }

  private openPreview(plan: CommandPlan, resolved: { ctx: CommandContext; file?: TFile; account: Account }, onRetry?: () => void): void {
    const hint = plan.invite ? this.routeHintFor(resolved.account, plan) : undefined;
    const onExecute = async (): Promise<ExecuteResult> => {
      const settings = this.deps.settings();
      const result = await executeCommandPlan(this.deps, settings, plan);
      if (result.ok) {
        new Notice(t("notice.commandDone", plan.summary));
        if (plan.invite) {
          this.fireAndForget(
            this.inviteRouter.deliver(resolved.account, plan, { now: this.deps.now(), ...(resolved.file ? { notePath: resolved.file.path } : {}) }),
            t("op.invite"),
          );
        }
      }
      return result;
    };
    new PlanPreviewModal(this.app, plan, hint, onExecute, onRetry).open();
  }
}
