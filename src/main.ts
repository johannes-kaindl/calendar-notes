import { FuzzySuggestModal, Notice, Plugin, Platform, TFile, getLanguage, type App } from "obsidian";
import { candidateNotes, countTypeExcluded, matchItems, type CandidateNote, type ServerItem } from "./core/adopt/match";
import { planAdoption, stateAfterAdoption, type AdoptDecision, type LinkPlan } from "./core/adopt/plan";
import { loadServerItems } from "./core/adopt/service";
import { discover, type DiscoveryResult } from "./core/dav/discovery";
import { discoverScheduling } from "./core/dav/scheduling";
import { withBasicAuth } from "./core/dav/transport";
import type { MappingProfile, ProfileKind } from "./core/mirror/profile";
import { suggestProfileFromNote } from "./core/mirror/profile-from-note";
import { normalizeSettings, repairSecretLinks, sourceOf, type Account, type CollectionConfig, type PluginSettings } from "./core/settings";
import type { CalendarNotesApi } from "./core/api/types";
import { ensureDefaultCommands } from "./core/commands/registry";
import type { RunInfo } from "./core/state/collection-state";
import { createEmitter, type SyncEvents } from "./core/sync/events";
import { SyncService } from "./core/sync/service";
import type { CollectionRunResult, SyncDeps } from "./core/sync/types";
import { initI18n, t } from "./i18n/strings";
import { AdoptionModal, summarizeAdoption } from "./obsidian/adoption-modal";
import { createPluginApi } from "./obsidian/api";
import { CommandFlow } from "./obsidian/command-flow";
import { InviteRouter } from "./obsidian/invite";
import { buildSyncDeps, createMailTransportRegistry, type MailTransportRegistry } from "./obsidian/plugin-host";
import { PreviewModal } from "./obsidian/preview-modal";
import { obsidianSecretStore, type SecretStore } from "./obsidian/secrets";
import { CalendarNotesSettingTab, type SettingsHost } from "./obsidian/settings-tab";
import { obsidianTransport } from "./obsidian/transport";

/** Waehlt in der Kommandopalette eine der AKTIVIERTEN Sammlungen fuer einen Einzel-Sync. */
class CollectionSuggestModal extends FuzzySuggestModal<CollectionConfig> {
  constructor(
    app: App,
    private readonly collections: CollectionConfig[],
    private readonly onChoose: (c: CollectionConfig) => void,
    placeholder: string = t("cmd.syncCollection.placeholder"),
  ) {
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

/** Waehlt die Art einer Notiz (Kontakt/Termin) fuer `profile-from-note`. */
class ProfileKindSuggestModal extends FuzzySuggestModal<ProfileKind> {
  constructor(
    app: App,
    private readonly onChoose: (kind: ProfileKind) => void,
  ) {
    super(app);
    this.setPlaceholder(t("cmd.profileFromNote.placeholder"));
  }

  getItems(): ProfileKind[] {
    return ["contact", "event"];
  }

  getItemText(kind: ProfileKind): string {
    return kind === "contact" ? t("adopt.kind.contact") : t("adopt.kind.event");
  }

  onChooseItem(kind: ProfileKind): void {
    this.onChoose(kind);
  }
}

function toRunInfo(finishedAt: string, r: CollectionRunResult): RunInfo {
  return { at: finishedAt, ok: r.ok, ...(r.error !== undefined ? { error: r.error } : {}), counts: r.counts };
}

export default class CalendarNotesPlugin extends Plugin {
  settings: PluginSettings = normalizeSettings(null);
  secrets!: SecretStore;
  service!: SyncService;
  /** Fremd-Plugin-Mail-Transporte (mailstone-Vertrag) — Task 7 exportiert register/unregister
   *  ueber die Plugin-API, `inviteRouter` liest den aktuellen Stand per Closure. */
  mailTransports!: MailTransportRegistry;
  inviteRouter!: InviteRouter;
  /** Plugin-API v1 (Task 7, Spec §5b) — `app.plugins.plugins["calendar-notes"].api`.
   *  Oeffentliches Feld, absichtlich: das IST die Schnittstelle nach aussen. */
  api!: CalendarNotesApi;
  private commandFlow!: CommandFlow;
  private deps!: SyncDeps;
  private settingTab!: CalendarNotesSettingTab;
  private intervalHandle: number | undefined;
  private armedMinutes: number | undefined;
  private readonly lastRunCache = new Map<string, RunInfo>();

  async onload(): Promise<void> {
    await this.loadSettings();
    initI18n(this.settings.language === "auto" ? getLanguage() : this.settings.language);

    this.secrets = obsidianSecretStore(this.app);
    // Einmalige Reparatur des 0.1.4-Schadens (ID statt Passwort im Schluesselbund) — muss vor
    // dem ersten Sync laufen, sonst meldet sich das Konto weiter mit dem Namen seines Eintrags an.
    const repaired = repairSecretLinks(this.settings, this.secrets);
    if (repaired !== this.settings) {
      this.settings = repaired;
      await this.saveData(this.settings);
    }
    this.deps = buildSyncDeps(this.app, this.manifest.dir ?? "", {
      settings: () => this.settings,
      saveSettings: async (s) => {
        this.settings = s;
        await this.saveSettings();
      },
    });
    // `deps.busy` (core/sync/busy.ts) wird in `buildSyncDeps` erzeugt und ist bidirektional
    // mit `executeCommandPlan` geteilt — SyncService braucht dafuer keine gesonderte Wiring
    // mehr (anders als der fruehere optionale `isBusy?()`).
    // `events` (core/sync/events.ts) wird HIER erzeugt und dem bereits gebauten `deps`
    // nachtraeglich angehaengt (`SyncDeps.events` ist optional) — SyncService/executeCommandPlan
    // lesen denselben Emitter ueber `this.deps`, die Plugin-API abonniert ihn unten.
    this.deps.events = createEmitter<SyncEvents>();
    this.service = new SyncService(this.deps);
    this.mailTransports = createMailTransportRegistry();
    this.inviteRouter = new InviteRouter(() => this.mailTransports.list(), this.app);
    // Fix-Runde 1, Punkt 0: OHNE diesen Aufruf blieb `commandRegistry()` zur Laufzeit leer —
    // `EVENT_COMMANDS`/`CONTACT_COMMANDS` (+ `undo.last`) wurden nirgends registriert, nur
    // Tests befuellten die Registry manuell. Vor `CommandFlow`/`createPluginApi`, weil beide
    // sich auf eine befuellte Registry verlassen (`commandsFor`/`findCommand`). Idempotent —
    // ein Plugin-Reload im selben Prozess wirft nicht "Doppelte Kommando-ID".
    ensureDefaultCommands();
    this.commandFlow = new CommandFlow(this.app, this.deps, this.inviteRouter);
    this.api = createPluginApi({ app: this.app, deps: this.deps, inviteRouter: this.inviteRouter, mailTransports: this.mailTransports });
    await this.hydrateRunCache();

    this.settingTab = new CalendarNotesSettingTab(this.app, this, this.settingsHost());
    this.addSettingTab(this.settingTab);

    this.registerCommands();
    this.rearmInterval();
    this.scheduleStartupSync();
  }

  onunload(): void {
    if (this.intervalHandle !== undefined) window.clearInterval(this.intervalHandle);
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    this.settings = normalizeSettings(raw);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rearmInterval();
  }

  private async hydrateRunCache(): Promise<void> {
    for (const c of this.settings.collections) {
      const state = await this.deps.stateStore.load(sourceOf(c));
      if (state.lastRun) this.lastRunCache.set(c.id, state.lastRun);
    }
  }

  private recordRun(finishedAt: string, results: CollectionRunResult[]): void {
    for (const r of results) {
      // dryRun schreibt nichts; "busy" (Ueberlappung mit einem anderen Lauf) ist ebenfalls kein
      // echtes Ergebnis — beides wuerde sonst den zuletzt ECHTEN Status im Cache ueberschreiben.
      if (r.dryRun || r.skippedReason === "busy") continue;
      this.lastRunCache.set(r.collectionId, toRunInfo(finishedAt, r));
    }
    this.settingTab.update();
  }

  /** Fire-and-forget fuer Kommandos/Timer: eine Ablehnung (Wurf VOR dem Try/Catch je Sammlung
   *  im SyncService, oder in `recordRun`/`settingTab.update()` selbst) darf nicht stumm im
   *  Nirwana landen — der Nutzer soll wenigstens eine Notice sehen. */
  private fireAndForget(p: Promise<unknown>, what: string): void {
    p.catch((e: unknown) => new Notice(t("notice.unexpected", what, e instanceof Error ? e.message : String(e))));
  }

  private settingsHost(): SettingsHost {
    const host: SettingsHost = {
      settings: this.settings,
      saveSettings: () => this.saveSettings(),
      secrets: this.secrets,
      discover: (account) => this.discoverAccount(account),
      syncNow: (collectionId) => {
        if (collectionId) this.fireAndForget(this.service.runCollection(collectionId).then((r) => this.recordRun(new Date().toISOString(), [r])), "Sync");
        else this.fireAndForget(this.runAll(), "Sync");
      },
      preview: () => this.fireAndForget(this.previewSync(), "Vorschau"),
      status: (collectionId) => ({ lastRun: this.lastRunCache.get(collectionId), running: this.service.isRunning() }),
      rand: () => Math.random(),
      removeState: (source) => this.fireAndForget(this.deps.stateStore.remove(source), "State entfernen"),
      adopt: (collectionId) => this.fireAndForget(this.startAdoption(collectionId), "Adoption"),
      profileFromActiveNote: () => this.fireAndForget(this.startProfileFromNote(), "Profil aus Notiz"),
    };
    // `settings` lebt im Plugin (Kommandos/Sync-Deps lesen es dort); der Tab schreibt ueber den
    // Host — beide Sichten zeigen auf dasselbe Objekt, ohne this-Alias im Host.
    Object.defineProperty(host, "settings", {
      get: () => this.settings,
      set: (v: PluginSettings) => {
        this.settings = v;
      },
    });
    return host;
  }

  private async discoverAccount(account: Account): Promise<DiscoveryResult> {
    const password = this.secrets.get(account.secretId);
    if (password === null) throw new Error(t("notice.noSecret"));
    const transport = withBasicAuth(obsidianTransport({ timeoutMs: this.settings.sync.requestTimeoutMs }), account.username, password);
    const result = await discover(transport, account.baseUrl);
    // Scheduling-Discovery (RFC 6638) ist ein optionaler Zusatzschritt — scheitert sie (Server
    // ohne schedule-outbox/-inbox, Rechteproblem, Timeout), bleibt `scheduling` einfach
    // unveraendert statt die ganze Discovery scheitern zu lassen (settings-tab.ts wertet nur
    // `result` aus, `account.scheduling` wird HIER direkt in den Settings aktualisiert).
    try {
      const scheduling = await discoverScheduling(transport, result.principal);
      this.settings = { ...this.settings, accounts: this.settings.accounts.map((a) => (a.id === account.id ? { ...a, scheduling } : a)) };
      await this.saveSettings();
    } catch {
      /* optional — Server ohne Scheduling-Unterstuetzung ist kein Fehler */
    }
    return result;
  }

  // ── Kommandos ────────────────────────────────────────────────────────────
  private registerCommands(): void {
    this.addCommand({ id: "sync-all", name: t("cmd.syncAll"), callback: () => this.fireAndForget(this.runAll(), "Sync") });
    this.addCommand({ id: "sync-preview", name: t("cmd.syncPreview"), callback: () => this.fireAndForget(this.previewSync(), "Vorschau") });
    this.addCommand({ id: "sync-collection", name: t("cmd.syncCollection"), callback: () => this.openCollectionSuggester() });
    this.addCommand({ id: "adopt-collection", name: t("cmd.adoptCollection"), callback: () => this.openAdoptSuggester() });
    this.addCommand({ id: "profile-from-note", name: t("cmd.profileFromNote"), callback: () => this.fireAndForget(this.startProfileFromNote(), "Profil aus Notiz") });
    // IDs bewusst OHNE das Wort „command" (obsidianmd/commands/no-command-in-command-id, Teil
    // des Store-Scanners) — der Task-Auftrag nennt die Kommandos „command-run" etc., das ist
    // hier der GESPRAECHSNAME, nicht die addCommand-ID.
    this.addCommand({ id: "run-on-note", name: t("cmd.run"), callback: () => this.commandFlow.runOnActiveNote() });
    this.addCommand({ id: "new-event", name: t("cmd.newEvent"), callback: () => this.commandFlow.newEvent() });
    this.addCommand({ id: "new-contact", name: t("cmd.newContact"), callback: () => this.commandFlow.newContact() });
    this.addCommand({ id: "undo-last-change", name: t("cmd.undo"), callback: () => this.commandFlow.undoLast() });
    this.addCommand({ id: "push-hand-edits", name: t("cmd.pushHandEdits"), callback: () => this.commandFlow.pushHandEdits() });
  }

  private async runAll(): Promise<void> {
    const result = await this.service.runAll();
    this.recordRun(result.finishedAt, result.collections);
  }

  private async previewSync(): Promise<void> {
    const result = await this.service.runAll({ dryRun: true });
    new PreviewModal(
      this.app,
      result,
      () => this.fireAndForget(this.runAll(), "Sync"),
      (id) => this.settings.collections.find((c) => c.id === id)?.displayName ?? id,
    ).open();
  }

  private openCollectionSuggester(): void {
    const enabled = this.settings.collections.filter((c) => c.enabled);
    if (enabled.length === 0) {
      new Notice(t("notice.noEnabledCollections"));
      return;
    }
    new CollectionSuggestModal(this.app, enabled, (c) => {
      this.fireAndForget(this.service.runCollection(c.id).then((r) => this.recordRun(new Date().toISOString(), [r])), "Sync");
    }).open();
  }

  // ── Adoption ─────────────────────────────────────────────────────────────
  private openAdoptSuggester(): void {
    const enabled = this.settings.collections.filter((c) => c.enabled);
    if (enabled.length === 0) {
      new Notice(t("notice.noEnabledCollections"));
      return;
    }
    new CollectionSuggestModal(this.app, enabled, (c) => this.fireAndForget(this.startAdoption(c.id), "Adoption"), t("cmd.adoptCollection.placeholder")).open();
  }

  private async startAdoption(collectionId: string): Promise<void> {
    const { items, profile, source, skipped } = await loadServerItems(this.deps, this.settings, collectionId);
    const notes = await this.loadCandidateNotes(profile);
    const { suggestions, unmatchedItems, unmatchedNotes } = matchItems(items, notes, { profile });
    const typeExcludedCount = countTypeExcluded(notes, profile);
    new AdoptionModal(
      this.app,
      { suggestions, unmatchedItems, unmatchedNotes, profile, skipped, typeExcludedCount },
      (decisions) => this.confirmAdoption(decisions, profile, source, items),
    ).open();
  }

  /** Kandidaten-Notizen fuer die Adoption: per Frontmatter (aus dem `metadataCache`, ohne
   *  Datei-Zugriff) auf `candidateNotes()` vorfiltern. `CandidateNote.body` wird vom Matcher
   *  nicht ausgewertet — deshalb bleibt er leer, statt fuer jede Kandidatin extra `cachedRead`
   *  zu bezahlen. */
  private async loadCandidateNotes(profile: MappingProfile): Promise<CandidateNote[]> {
    const files = this.app.vault.getMarkdownFiles();
    const draft: CandidateNote[] = files.map((f) => ({
      path: f.path,
      basename: f.basename,
      frontmatter: this.app.metadataCache.getFileCache(f)?.frontmatter ?? {},
      body: "",
    }));
    return candidateNotes(draft, profile);
  }

  /** Verknuepft sequentiell (nicht parallel) — ein `processFrontMatter`-Fehlschlag bei
   *  Notiz N darf die uebrigen Notizen nicht verhindern, und `stateAfterAdoption` bekommt
   *  danach IMMER nur die tatsaechlich erfolgreichen Links, sonst behauptet der State-Eintrag
   *  eine Verknuepfung, die im Frontmatter gar nicht steht. */
  private async confirmAdoption(decisions: AdoptDecision[], profile: MappingProfile, source: string, items: ServerItem[]): Promise<void> {
    const { links, createUids, skippedUids } = planAdoption(decisions, profile, source);
    const succeeded: LinkPlan[] = [];
    const failed: { path: string; message: string }[] = [];
    for (const link of links) {
      try {
        const file = this.app.vault.getAbstractFileByPath(link.path);
        if (!(file instanceof TFile)) throw new Error(`Notiz nicht gefunden: ${link.path}`);
        await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          Object.assign(fm, link.set);
        });
        succeeded.push(link);
      } catch (e) {
        failed.push({ path: link.path, message: e instanceof Error ? e.message : String(e) });
      }
    }
    // load/save separat abgesichert: ein State-Store-Fehler (z. B. kaputtes JSON, Disk voll)
    // darf die bereits geschriebenen Frontmatter-Links nicht verschweigen — die Notice-Zeilen
    // unten laufen in jedem Fall, und das Promise resolved statt zu werfen (sonst verschluckt
    // `void ...then()` im Modal den Fehler wieder, s. adoption-modal.ts).
    try {
      const state = await this.deps.stateStore.load(source);
      const newState = stateAfterAdoption(state, succeeded, items, profile, this.deps.now());
      await this.deps.stateStore.save(newState);
    } catch (e) {
      new Notice(t("notice.unexpected", "Adoption", e instanceof Error ? e.message : String(e)));
    }
    const summary = summarizeAdoption(succeeded, failed);
    new Notice(t("notice.adoptDone", summary.linkedCount, skippedUids.length, createUids.length));
    if (summary.failedCount > 0) new Notice(t("notice.adoptFailed", summary.failedCount, summary.failedPaths.join(", ")));
  }

  // ── Profil aus Notiz ─────────────────────────────────────────────────────
  private async startProfileFromNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("notice.noActiveFile"));
      return;
    }
    new ProfileKindSuggestModal(this.app, (kind) => this.fireAndForget(this.createProfileFromNote(kind, file), "Profil aus Notiz")).open();
  }

  private async createProfileFromNote(kind: ProfileKind, file: TFile): Promise<void> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const folder = file.parent && file.parent.path !== "/" ? file.parent.path : "";
    const name = t("adopt.profileFromNote.name", file.basename);
    const { profile, mapped, unmapped } = suggestProfileFromNote(kind, frontmatter, { folder, name, rand: Math.random });
    this.settings = { ...this.settings, profiles: [...this.settings.profiles, profile] };
    await this.saveSettings();
    new Notice(t("notice.profileCreated", Object.keys(mapped).length, unmapped.length));
    this.settingTab.update();
  }

  // ── Auslöser ─────────────────────────────────────────────────────────────
  /** `registerInterval` traegt den Timer in Obsidians eigene Aufraeum-Liste ein (Cleanup bei
   *  onunload); ein `window.clearInterval` VORHER (beim Re-Arm nach Settings-Aenderung) ist
   *  unschaedlich doppelt, weil ein ungueltiges Handle keinen Effekt hat. */
  private rearmInterval(): void {
    const minutes = Platform.isMobile ? this.settings.sync.mobileIntervalMinutes : this.settings.sync.intervalMinutes;
    if (minutes === this.armedMinutes) return; // unveraendert — kein Grund, den laufenden Timer zu kappen
    if (this.intervalHandle !== undefined) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.armedMinutes = minutes;
    if (minutes <= 0) return;
    this.intervalHandle = this.registerInterval(
      window.setInterval(() => {
        if (this.service.isRunning()) return;
        this.fireAndForget(this.runAll(), "Sync");
      }, minutes * 60000),
    );
  }

  private scheduleStartupSync(): void {
    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.collections.some((c) => c.enabled)) return;
      const id = window.setTimeout(() => this.fireAndForget(this.runAll(), "Sync"), this.settings.sync.startupDelaySeconds * 1000);
      this.register(() => window.clearTimeout(id));
    });
  }
}
