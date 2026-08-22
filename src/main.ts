import { FuzzySuggestModal, Notice, Plugin, Platform, getLanguage, type App } from "obsidian";
import { discover, type DiscoveryResult } from "./core/dav/discovery";
import { withBasicAuth } from "./core/dav/transport";
import { normalizeSettings, sourceOf, type Account, type CollectionConfig, type PluginSettings } from "./core/settings";
import type { RunInfo } from "./core/state/collection-state";
import { SyncService } from "./core/sync/service";
import type { CollectionRunResult, SyncDeps } from "./core/sync/types";
import { initI18n, t } from "./i18n/strings";
import { buildSyncDeps } from "./obsidian/plugin-host";
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
  ) {
    super(app);
    this.setPlaceholder(t("cmd.syncCollection.placeholder"));
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

function toRunInfo(finishedAt: string, r: CollectionRunResult): RunInfo {
  return { at: finishedAt, ok: r.ok, ...(r.error !== undefined ? { error: r.error } : {}), counts: r.counts };
}

export default class CalendarNotesPlugin extends Plugin {
  settings: PluginSettings = normalizeSettings(null);
  secrets!: SecretStore;
  service!: SyncService;
  private deps!: SyncDeps;
  private settingTab!: CalendarNotesSettingTab;
  private intervalHandle: number | undefined;
  private armedMinutes: number | undefined;
  private readonly lastRunCache = new Map<string, RunInfo>();

  async onload(): Promise<void> {
    await this.loadSettings();
    initI18n(this.settings.language === "auto" ? getLanguage() : this.settings.language);

    this.secrets = obsidianSecretStore(this.app);
    this.deps = buildSyncDeps(this.app, this.manifest.dir ?? "", {
      settings: () => this.settings,
      saveSettings: async (s) => {
        this.settings = s;
        await this.saveSettings();
      },
    });
    this.service = new SyncService(this.deps);
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
    return discover(transport, account.baseUrl);
  }

  // ── Kommandos ────────────────────────────────────────────────────────────
  private registerCommands(): void {
    this.addCommand({ id: "sync-all", name: t("cmd.syncAll"), callback: () => this.fireAndForget(this.runAll(), "Sync") });
    this.addCommand({ id: "sync-preview", name: t("cmd.syncPreview"), callback: () => this.fireAndForget(this.previewSync(), "Vorschau") });
    this.addCommand({ id: "sync-collection", name: t("cmd.syncCollection"), callback: () => this.openCollectionSuggester() });
  }

  private async runAll(): Promise<void> {
    const result = await this.service.runAll();
    this.recordRun(result.finishedAt, result.collections);
  }

  private async previewSync(): Promise<void> {
    const result = await this.service.runAll({ dryRun: true });
    new PreviewModal(this.app, result, () => this.fireAndForget(this.runAll(), "Sync")).open();
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
