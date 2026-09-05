import { FuzzySuggestModal, Notice, TFile, type App } from "obsidian";
import { commandsFor, findCommand } from "../core/commands/registry";
import { targetFromFrontmatter } from "../core/commands/target";
import type { CommandContext, CommandDescriptor, CommandPlan, CommandTarget } from "../core/commands/types";
import { planPushHandEdits } from "../core/commands/push-hand-edits";
import { hrefPath, resolveHref } from "../core/dav/url";
import { listEtags } from "../core/dav/sync";
import { effectiveProfile, sourceOf, type Account, type CollectionConfig, type PluginSettings } from "../core/settings";
import type { ObjectState } from "../core/state/collection-state";
import { executeCommandPlan, executeCommandPlans, resyncObject, type ExecuteResult } from "../core/sync/execute";
import { baseCollectionOf } from "../core/sync/service";
import { classifyTodos, type ClassifiedTodo, type TodoNoteState } from "../core/sync/todo-collect";
import { nichtUebertragbareKeys, planTodoCreate } from "../core/commands/todo-commands";
import type { SyncDeps } from "../core/sync/types";
import { describeExecuteError } from "./execute-i18n";
import { t } from "../i18n/strings";
import { buildCommandContext } from "./command-context";
import { tr, trPlan, trTitle } from "./command-i18n";
import { SchemaFormModal } from "./command-modal";
import type { InviteRouter } from "./invite";
import { PlanPreviewModal } from "./plan-preview-modal";
import { TodoSyncModal, type TodoSyncAuswahl } from "./todo-sync-modal";

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
    const { title, description } = tr(d);
    return `${title} — ${description}`;
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
/**
 * Auswahl → Arbeitsliste. Bewusst pur und exportiert, damit die Zuordnung ohne DOM testbar
 * ist: sie traegt die Regel, dass "Server gewinnt" KEIN DAV-Schreibvorgang ist, sondern ein
 * `resyncObject` — der einzige Weg, auf dem dieses Kommando Vault-Inhalt ueberschreibt.
 *
 * Beide Bauer duerfen `null` liefern (keine Rohdaten, kein Kontext, oder schlicht nichts zu
 * aendern, weil die bewahrende Rueckabbildung keinen Wechsel sieht). Das ist kein Fehler und
 * faellt hier still weg.
 */
export function planlisteAus(
  auswahl: TodoSyncAuswahl[],
  bauHandEdit: (a: TodoSyncAuswahl) => CommandPlan | null,
  bauCreate: (a: TodoSyncAuswahl) => CommandPlan | null,
): { plaene: CommandPlan[]; resync: { collectionId: string; href: string }[] } {
  const plaene: CommandPlan[] = [];
  const resync: { collectionId: string; href: string }[] = [];
  for (const a of auswahl) {
    if (a.entscheidung === "server") {
      const { collectionId, href } = a.note.note;
      // Ohne beides gibt es nichts nachzuholen — eine nie gespiegelte Notiz hat keinen
      // Serverstand, den der Server gewinnen koennte.
      if (collectionId && href) resync.push({ collectionId, href });
      continue;
    }
    const plan = a.note.group === "new" ? bauCreate(a) : bauHandEdit(a);
    if (plan) plaene.push(plan);
  }
  return { plaene, resync };
}

export class CommandFlow {
  constructor(
    private readonly app: App,
    private readonly deps: SyncDeps,
    private readonly inviteRouter: InviteRouter,
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
    const ctx: CommandContext = buildCommandContext({ app: this.app, settings, now: this.deps.now(), profile, collection, account, target });
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

  /** Laeuft seit Fix-Runde 1 ueber die reguläre Registry statt direkt `planUndoLast()`
   *  aufzurufen — `undo.last` (`core/commands/undo.ts`) ist damit auf demselben Pfad wie
   *  jedes andere Kommando erreichbar (`findCommand`/`appliesTo`/`plan`), inklusive der
   *  Plugin-API (`api.plan("undo.last", …)`), s. GUI-Smoke P12. */
  private async runUndo(fresh: boolean): Promise<void> {
    const file = this.activeFileOrNotice();
    if (!file) return;
    const resolved = fresh ? await this.resolveTargetFresh(file) : await this.resolveTarget(file);
    if (!resolved) return;
    const descriptor = findCommand("undo.last");
    if (!descriptor || !descriptor.appliesTo(resolved.ctx)) {
      new Notice(t("notice.noHistory"));
      return;
    }
    let plan: CommandPlan;
    try {
      plan = descriptor.plan({}, resolved.ctx);
    } catch (e) {
      new Notice(t("notice.unexpected", t("op.undo"), e instanceof Error ? e.message : String(e)));
      return;
    }
    await this.openPreview(plan, resolved, () => this.fireAndForget(this.runUndo(true), t("op.undo")));
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
    await this.openPreview(plan, resolved, () => this.fireAndForget(this.runPushHandEdits(true), t("op.pushHandEdits")));
  }

  // ── command-todo-sync ────────────────────────────────────────────────────
  runTodoSync(): void {
    this.fireAndForget(this.startTodoSync(), t("op.command"));
  }

  /**
   * Der Einstiegspunkt des Sammel-Kommandos. Die Reihenfolge zaehlt: erst der Serverstand
   * (ein Request je SAMMLUNG, nicht je Notiz), dann klassifizieren, dann fragen, dann
   * schreiben — letzteres unter EINEM Busy-Guard (`executeCommandPlans`).
   */
  private async startTodoSync(): Promise<void> {
    const settings = this.deps.settings();
    const notes = await this.sammleTodoNotizen(settings);
    const klassifiziert = classifyTodos(notes, await this.holeServerEtags(settings, notes));
    if (klassifiziert.length === 0) {
      new Notice(t("todoSync.empty"));
      return;
    }
    new TodoSyncModal(
      this.app,
      klassifiziert,
      (auswahl) => this.fireAndForget(this.sendeAuswahl(auswahl), t("op.command")),
      (c) => this.nichtUebertragbarFuer(c, settings),
    ).open();
  }

  /** Welche geaenderten Felder dieser Zeile gehen NICHT mit (Spec §4)? Braucht das Profil,
   *  deshalb hier und nicht im Modal. */
  private nichtUebertragbarFuer(c: ClassifiedTodo, settings: PluginSettings): string[] {
    const col = settings.collections.find((x) => x.id === c.note.collectionId);
    const profile = col ? effectiveProfile(settings, col) : undefined;
    return profile ? nichtUebertragbareKeys(profile, c.changedKeys) : [];
  }

  private async sendeAuswahl(auswahl: TodoSyncAuswahl[]): Promise<void> {
    const settings = this.deps.settings();
    // Die Plaene werden VORHER gebaut, weil `bauTodoHandEdit` Rohdaten nachlaedt und damit
    // asynchron ist — `planlisteAus` bleibt bewusst synchron und pur, sonst waere die
    // Zuordnungsregel (insbesondere "Server gewinnt" → kein Plan) nicht ohne DOM testbar.
    const vorbereitet = new Map<string, CommandPlan | null>();
    for (const a of auswahl) {
      if (a.entscheidung !== "vault") continue;
      const plan = a.note.group === "new" ? this.bauTodoCreate(a, settings) : await this.bauTodoHandEdit(a, settings);
      vorbereitet.set(a.note.note.path, plan);
    }
    const nachschlagen = (a: TodoSyncAuswahl): CommandPlan | null => vorbereitet.get(a.note.note.path) ?? null;
    const { plaene, resync } = planlisteAus(auswahl, nachschlagen, nachschlagen);

    const ergebnisse = await executeCommandPlans(this.deps, settings, plaene);
    const nachgezogen = await this.holeServerstand(settings, resync);
    const ok = ergebnisse.filter((e) => e.result.ok).length;
    const konflikte = ergebnisse.filter((e) => !e.result.ok && e.result.conflict).length;
    if (ergebnisse.length > 0) new Notice(t("todoSync.result", ok, ergebnisse.length - ok));
    if (konflikte > 0) new Notice(t("todoSync.resultConflict", konflikte));
    if (nachgezogen > 0) new Notice(t("todoSync.resultResync", nachgezogen));
  }

  /**
   * "Server gewinnt" ausfuehren: den Serverstand in die Notiz holen.
   *
   * Unter dem Busy-Guard, weil `resyncObject` gegen den Collection-State SCHREIBT — dieselbe
   * Luecke, die M4/Review-Runde 3 in `resolveTargetFresh` geschlossen hat. Ohne ihn liefe das
   * hier parallel zu einem `SyncService.runAll()` gegen denselben State.
   */
  private async holeServerstand(settings: PluginSettings, resync: { collectionId: string; href: string }[]): Promise<number> {
    if (resync.length === 0) return 0;
    if (!this.deps.busy.tryAcquire()) {
      new Notice(describeExecuteError("busy"));
      return 0;
    }
    let ok = 0;
    try {
      for (const r of resync) {
        const res = await resyncObject(this.deps, settings, r.collectionId, r.href);
        if (!res.error) ok += 1;
      }
    } finally {
      this.deps.busy.release();
    }
    return ok;
  }

  /**
   * Alle Aufgaben-Notizen mit ihrem zuletzt geschriebenen Stand.
   *
   * Zwei Quellen, und beide werden gebraucht: der Collection-State kennt die **gespiegelten**
   * Aufgaben (uid/href/etag/written), der Profilordner zusaetzlich die **neuen**, die es dort
   * noch nicht gibt. Ohne die zweite Quelle fehlte die Gruppe „neu" komplett.
   *
   * Die beiden Schleifen laufen NACHEINANDER ueber alle Sammlungen, nicht ineinander: sonst
   * haelt die Ordner-Schleife eine gespiegelte Notiz fuer neu, weil ihre Sammlung erst spaeter
   * an der Reihe ist — und legt sie bei zwei Aufgaben-Sammlungen zweimal an.
   */
  private async sammleTodoNotizen(settings: PluginSettings): Promise<TodoNoteState[]> {
    const out: TodoNoteState[] = [];
    const gesehen = new Set<string>();
    const cols = settings.collections.filter((c) => c.enabled && effectiveProfile(settings, c)?.kind === "todo");

    for (const col of cols) {
      const state = await this.deps.stateStore.load(sourceOf(col));
      // Der State-Schluessel IST der href-Pfad — genau der Vertrag, auf den `classifyTodos`
      // seine ETag-Karte stuetzt. Deshalb `entries`, nicht `values`.
      for (const [hp, obj] of Object.entries(state.objects)) {
        for (const note of Object.values(obj.notes)) {
          if (!(this.app.vault.getAbstractFileByPath(note.path) instanceof TFile)) continue;
          gesehen.add(note.path);
          out.push({
            path: note.path,
            frontmatter: this.frontmatterVon(note.path),
            prevWritten: note.written ?? {},
            uid: obj.uid,
            href: hrefPath(resolveHref(col.href, hp)),
            etag: obj.etag,
            collectionId: col.id,
          });
        }
      }
    }

    for (const col of cols) {
      const profile = effectiveProfile(settings, col);
      if (!profile) continue;
      const praefix = `${profile.folder}/`;
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(praefix) || gesehen.has(file.path)) continue;
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        if (frontmatter[profile.uidField]) continue; // traegt eine dav_uid → gehoert dem State
        gesehen.add(file.path); // zwei Sammlungen duerfen sich denselben Ordner teilen
        out.push({ path: file.path, frontmatter, prevWritten: {}, collectionId: col.id });
      }
    }
    return out;
  }

  private frontmatterVon(path: string): Record<string, unknown> {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) : {};
  }

  /**
   * Der Serverstand als ETag-Karte — **ein** Request je Sammlung, nicht einer je Notiz.
   *
   * Das ist der Grund, warum die vollstaendige Konfliktanzeige bezahlbar ist (Spec §3): bei
   * zwanzig geaenderten Aufgaben in einer Sammlung kostet sie einen Request, nicht zwanzig.
   */
  private async holeServerEtags(settings: PluginSettings, notes: TodoNoteState[]): Promise<Map<string, string>> {
    const karte = new Map<string, string>();
    const ids = new Set(notes.map((n) => n.collectionId).filter((x): x is string => !!x));
    for (const id of ids) {
      const col = settings.collections.find((c) => c.id === id);
      const account = col ? settings.accounts.find((a) => a.id === col.accountId) : undefined;
      if (!col || !account) continue;
      const secret = this.deps.secrets.get(account.secretId);
      if (secret === null || secret === "") continue;
      try {
        const etags = await listEtags(this.deps.transportFor(account, secret), baseCollectionOf(col), {});
        for (const [href, etag] of Object.entries(etags)) karte.set(href, etag);
      } catch {
        // Eine unerreichbare Sammlung darf den ganzen Lauf nicht toeten: ihre Notizen landen
        // dann in "conflict" (kein ETag gefunden) und werden dem Nutzer vorgelegt, statt
        // stillschweigend ueberschrieben zu werden.
      }
    }
    return karte;
  }

  /** Der Kommando-Kontext einer Auswahlzeile — wie `resolveTarget`, nur ohne die aktive
   *  Datei, weil der Sammellauf ueber viele Notizen geht. */
  private ctxFuer(a: TodoSyncAuswahl, settings: PluginSettings, raw?: string, etag?: string): CommandContext | undefined {
    const n = a.note.note;
    const col = settings.collections.find((c) => c.id === n.collectionId);
    const account = col ? settings.accounts.find((x) => x.id === col.accountId) : undefined;
    const profile = col ? effectiveProfile(settings, col) : undefined;
    if (!col || !account || !profile) return undefined;
    const source = sourceOf(col);
    // `n.href` ist ein href-PFAD (Schluessel-Vertrag aus Task 4); der PUT braucht die volle URL.
    const target: CommandTarget =
      n.href && n.uid
        ? { kind: "todo", source, href: resolveHref(col.href, n.href), uid: n.uid }
        : { kind: "todo", source, new: true };
    return buildCommandContext({
      app: this.app, settings, now: this.deps.now(), profile, collection: col, account, target,
      ...(raw !== undefined ? { raw } : {}),
      ...(etag !== undefined ? { etag } : {}),
    });
  }

  private async bauTodoHandEdit(a: TodoSyncAuswahl, settings: PluginSettings): Promise<CommandPlan | null> {
    const n = a.note.note;
    if (!n.collectionId || !n.href) return null;
    const col = settings.collections.find((c) => c.id === n.collectionId);
    if (!col) return null;
    const obj = (await this.deps.stateStore.load(sourceOf(col))).objects[n.href];
    if (!obj) return null;
    const ctx = this.ctxFuer(a, settings, obj.raw, obj.etag);
    if (!ctx) return null;
    return planPushHandEdits(ctx, n.frontmatter, n.prevWritten).plan;
  }

  private bauTodoCreate(a: TodoSyncAuswahl, settings: PluginSettings): CommandPlan | null {
    const ctx = this.ctxFuer(a, settings);
    return ctx ? planTodoCreate(ctx, a.note.note.frontmatter) : null;
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
    // Laufzeit unerreichbar (targetFromFrontmatter sortiert Todo-Profile aus), aber der Compiler
    // verlangt die Entscheidung. Kein Wurf: hier ist "kein Kommando-Ziel" die richtige,
    // bereits vorhandene Antwort an den Nutzer.
    if (profile.kind === "todo") {
      new Notice(t("notice.notCommandTarget"));
      return undefined;
    }
    const target: CommandTarget = { kind: profile.kind, source: ft.source, href, uid: obj.uid };
    const ctx: CommandContext = buildCommandContext({
      app: this.app, settings, now: this.deps.now(), profile, collection, account, target,
      raw: obj.raw, etag: obj.etag, history: obj.history,
    });
    return { ctx, file, account, collection, obj, rid };
  }

  /** Wie `resolveTarget`, zieht aber VORHER einmal gezielt den Server-Stand des Objekts nach
   *  (`resyncObject`) — genutzt fuer den „Mit frischem Stand erneut"-Pfad nach einem
   *  If-Match-Konflikt, damit der zweite Versuch nicht mit demselben veralteten Etag
   *  scheitert. Ein normaler Aufruf (`fresh: false` in `runUndo`/`runPushHandEdits`) spart
   *  sich diesen Request. */
  /** M4 (Review-Runde 3): laeuft jetzt unter `deps.busy` — vorher konnte ein `resyncObject()`
   *  hier PARALLEL zu einem laufenden `SyncService.runAll()` GEGEN denselben Collection-State
   *  schreiben (der Busy-Guard ist bidirektional zwischen SyncService/`executeCommandPlan`
   *  geteilt, s. `core/sync/busy.ts` — dieser Aufruf hier war die eine Luecke). Busy → Notice
   *  statt eines racenden Resyncs. */
  private async resolveTargetFresh(file: TFile): Promise<ResolvedTarget | undefined> {
    const first = await this.resolveTarget(file);
    if (!first) return undefined;
    const href = "href" in first.ctx.target ? first.ctx.target.href : undefined;
    if (!href) return first; // sollte durch resolveTarget() ausgeschlossen sein (baut immer ein href-Target)
    if (!this.deps.busy.tryAcquire()) {
      new Notice(describeExecuteError("busy"));
      return undefined;
    }
    try {
      await resyncObject(this.deps, this.deps.settings(), first.collection.id, href);
    } catch (e) {
      new Notice(t("notice.unexpected", t("op.command"), e instanceof Error ? e.message : String(e)));
      return undefined;
    } finally {
      this.deps.busy.release();
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
      new Notice(t("notice.unexpected", trTitle(descriptor), e instanceof Error ? e.message : String(e)));
      return;
    }
    const onRetry = file ? () => this.fireAndForget(this.retryForm(descriptor, file), t("op.command")) : undefined;
    this.fireAndForget(this.openPreview(plan, { ctx, file, account: ctx.account }, onRetry), t("op.command"));
  }

  private async retryForm(descriptor: CommandDescriptor, file: TFile): Promise<void> {
    const resolved = await this.resolveTargetFresh(file);
    if (!resolved) return;
    this.openForm(descriptor, resolved);
  }

  private async routeHintFor(account: Account, plan: CommandPlan): Promise<string> {
    const { route, transport } = await this.inviteRouter.route(account, plan);
    if (route === "server") return t("plan.invite.server");
    // M3 (Review-Runde 3): den TATSAECHLICH von route() gewaehlten Transport anzeigen, nicht
    // pauschal transports()[0] — bei mehreren registrierten Transporten kann das ein anderer
    // sein (der erste ohne Identitaeten waere gar nicht waehlbar gewesen).
    if (route === "transport") return t("plan.invite.transport", transport?.label ?? "");
    return t("plan.invite.ics");
  }

  private async openPreview(plan: CommandPlan, resolved: { ctx: CommandContext; file?: TFile; account: Account }, onRetry?: () => void): Promise<void> {
    const hint = plan.invite ? await this.routeHintFor(resolved.account, plan) : undefined;
    const onExecute = async (): Promise<ExecuteResult> => {
      const settings = this.deps.settings();
      const result = await executeCommandPlan(this.deps, settings, plan);
      if (result.ok) {
        // I1a (Review-Runde 3): ein erfolgreicher Server-Schreibvorgang OHNE erfolgreichen
        // Resync (`resynced: false`) ist KEIN reiner Erfolg — die lokale Notiz spiegelt den
        // neuen Server-Stand (noch) nicht. Eine stille "Erledigt"-Notice waere irrefuehrend.
        if (!result.resynced) new Notice(t("notice.commandDoneNoResync", result.resyncError ?? ""));
        else new Notice(t("notice.commandDone", trPlan(plan)));
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
