// Deklarative Settings — `minAppVersion` ist bereits 1.13.0 (manifest.json), deshalb OHNE
// den zweigleisigen Fallback-Walker (REGISTRY „Zweigleisige deklarative Settings — eine-
// Wahrheit-Walker" rät ausdrücklich zum Abbau, sobald der 1.13-Floor trägt; der Store-Scanner
// markiert ein zusätzliches `display()` bei vorhandenem `getSettingDefinitions()` sogar als
// Warnung — `obsidianmd/settings-tab/no-deprecated-display`). Bedingte Zeilen werden
// WEGGELASSEN, nicht per `visible` versteckt. `settingBodyHost` bleibt im Einsatz — nicht für
// den Fallback-Renderpfad, sondern als Hatch-Baustein für die Mehrfeld-Zeilen (Konto, Sammlung).
import {
  Notice,
  PluginSettingTab,
  Setting,
  SecretComponent,
  type App,
  type Plugin,
  type SettingDefinitionGroup,
  type SettingDefinitionItem,
  type SettingDefinitionList,
  type SettingGroupItem,
} from "obsidian";
import type { DiscoveryResult } from "../core/dav/discovery";
import { defaultEventProfile, validateProfile, type MappingProfile } from "../core/mirror/profile";
import { newId, type Account, type CollectionConfig, type PluginSettings } from "../core/settings";
import type { RunInfo } from "../core/state/collection-state";
import { t } from "../i18n/strings";
import { FolderSuggest } from "../vendor/kit-obsidian/folder-suggest";
import { settingBodyHost } from "../vendor/kit-obsidian/settings_walker";
import { JsonModal } from "./json-modal";
import type { SecretStore } from "./secrets";

/** Was der Tab vom Plugin braucht — als Interface, damit Tests eine Attrappe geben können. */
export interface SettingsHost {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  secrets: SecretStore;
  /** Baut einen Transport mit dem hinterlegten Passwort, ruft core discover(). */
  discover(account: Account): Promise<DiscoveryResult>;
  syncNow(collectionId?: string): void;
  preview(): void;
  status(collectionId: string): { lastRun?: RunInfo; running: boolean };
  rand(): number;
}

const COLLECTION_KEY = /^collections\.([^.]+)\.(enabled|profileId)$/;

export class CalendarNotesSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly host: SettingsHost,
  ) {
    super(app, plugin);
  }

  // ── Die eine Wahrheit ────────────────────────────────────────────────────
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [this.accountsGroup(), this.collectionsGroup(), this.profilesGroup(), this.syncGroup(), this.actionsGroup()];
  }

  // ── Konten ───────────────────────────────────────────────────────────────
  private accountsGroup(): SettingDefinitionList {
    const accounts = this.host.settings.accounts;
    const items: SettingGroupItem[] = accounts.map((acc) => ({
      name: acc.name || acc.baseUrl,
      render: (setting: Setting) => this.renderAccountRow(setting, acc),
    }));
    return {
      type: "list",
      heading: t("settings.accounts.heading"),
      items,
      emptyState: t("settings.accounts.empty"),
      onDelete: (index) => this.deleteAccount(accounts[index]!.id),
      addItem: { name: t("settings.accounts.add"), action: () => this.addAccount() },
    };
  }

  private renderAccountRow(setting: Setting, account: Account): void {
    const host = settingBodyHost(setting);
    new Setting(host).setName(t("settings.accounts.name")).addText((c) => c.setValue(account.name).onChange((v) => this.updateAccount(account.id, { name: v })));
    new Setting(host).setName(t("settings.accounts.baseUrl")).addText((c) => c.setValue(account.baseUrl).onChange((v) => this.updateAccount(account.id, { baseUrl: v })));
    new Setting(host).setName(t("settings.accounts.username")).addText((c) => c.setValue(account.username).onChange((v) => this.updateAccount(account.id, { username: v })));

    const secretSetting = new Setting(host).setName(t("settings.accounts.password"));
    if (!this.host.secrets.has(account.secretId)) secretSetting.setDesc(t("settings.accounts.noSecret"));
    new SecretComponent(this.app, secretSetting.controlEl).setValue(account.secretId).onChange((v) => {
      try {
        this.host.secrets.set(account.secretId, v);
      } catch {
        new Notice(t("notice.secretFailed"));
      }
    });

    new Setting(host).addButton((b) => b.setButtonText(t("settings.accounts.testButton")).onClick(() => void this.testAccount(account)));
  }

  private updateAccount(id: string, patch: Partial<Account>): void {
    this.host.settings = { ...this.host.settings, accounts: this.host.settings.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
    void this.host.saveSettings();
  }

  private addAccount(): void {
    const id = newId("acc", () => this.host.rand());
    const account: Account = { id, name: t("settings.accounts.newAccountDefaultName"), baseUrl: "", username: "", secretId: `calendar-notes-${id}` };
    this.host.settings = { ...this.host.settings, accounts: [...this.host.settings.accounts, account] };
    void this.host.saveSettings();
    this.update();
  }

  private deleteAccount(id: string): void {
    const s = this.host.settings;
    const account = s.accounts.find((a) => a.id === id);
    this.host.settings = { ...s, accounts: s.accounts.filter((a) => a.id !== id), collections: s.collections.filter((c) => c.accountId !== id) };
    void this.host.saveSettings();
    // SecretStore/SecretStorage kennt keine echte "delete"-Operation (nur get/set/has) —
    // best-effort mit leerem Wert ueberschreiben, statt so zu tun, als waere entfernt worden.
    if (account) {
      try {
        this.host.secrets.set(account.secretId, "");
      } catch {
        /* best effort */
      }
    }
    this.update();
  }

  private async testAccount(account: Account): Promise<void> {
    try {
      const result = await this.host.discover(account);
      this.mergeDiscoveredCollections(account, result);
      new Notice(t("notice.discoverOk", result.collections.length, result.warnings.length));
    } catch (e) {
      new Notice(t("notice.discoverFailed", e instanceof Error ? e.message : String(e)));
    }
    this.update();
  }

  private mergeDiscoveredCollections(account: Account, result: DiscoveryResult): void {
    const s = this.host.settings;
    const existingByHref = new Map(s.collections.filter((c) => c.accountId === account.id).map((c) => [c.href, c]));
    const merged: CollectionConfig[] = [];
    for (const dc of result.collections) {
      const prev = existingByHref.get(dc.href);
      if (prev) {
        merged.push({ ...prev, displayName: dc.displayName, readOnly: dc.readOnly, ...(dc.ctag ? { ctag: dc.ctag } : {}), ...(dc.syncToken ? { syncToken: dc.syncToken } : {}) });
      } else {
        const profileId = dc.kind === "calendar" ? "default-event" : "default-contact";
        merged.push({ id: newId("col", () => this.host.rand()), accountId: account.id, href: dc.href, kind: dc.kind, displayName: dc.displayName, enabled: false, profileId, readOnly: dc.readOnly });
      }
    }
    const untouched = s.collections.filter((c) => c.accountId !== account.id);
    const accounts = s.accounts.map((a) =>
      a.id === account.id
        ? { ...a, principal: result.principal, ...(result.calendarHome ? { calendarHome: result.calendarHome } : {}), ...(result.addressbookHome ? { addressbookHome: result.addressbookHome } : {}) }
        : a,
    );
    this.host.settings = { ...s, accounts, collections: [...untouched, ...merged] };
    void this.host.saveSettings();
  }

  // ── Sammlungen ───────────────────────────────────────────────────────────
  // Eine Gruppe kann laut Obsidian-Typing (`SettingGroupItem` = `SettingDefinition |
  // SettingDefinitionPage`, KEINE verschachtelte `SettingDefinitionGroup`) keine Gruppe
  // enthalten — nur Seiten oder einfache Zeilen. Konto-Ebene wird deshalb als navigierbare
  // `page` gefuehrt; deren `items` sind wieder volle `SettingDefinitionItem[]` und duerfen
  // ihrerseits Gruppen (je Sammlung) enthalten.
  private collectionsGroup(): SettingDefinitionGroup {
    const s = this.host.settings;
    const items: SettingGroupItem[] = [];
    for (const account of s.accounts) {
      const cols = s.collections.filter((c) => c.accountId === account.id);
      if (cols.length === 0) continue;
      items.push({ type: "page", name: account.name, items: cols.map((c) => this.collectionGroup(c, s)) });
    }
    return { type: "group", heading: t("settings.collections.heading"), items };
  }

  private collectionGroup(c: CollectionConfig, s: PluginSettings): SettingDefinitionGroup {
    const wantedKind = c.kind === "calendar" ? "event" : "contact";
    const profileOptions: Record<string, string> = {};
    for (const p of s.profiles.filter((p) => p.kind === wantedKind)) profileOptions[p.id] = p.name;
    return {
      type: "group",
      heading: c.displayName,
      items: [
        { name: t("settings.collections.enabled"), control: { type: "toggle", key: `collections.${c.id}.enabled` } },
        { name: t("settings.collections.profile"), control: { type: "dropdown", key: `collections.${c.id}.profileId`, options: profileOptions } },
        { name: t("settings.collections.folder"), desc: t("settings.collections.folderDesc"), render: (setting: Setting) => this.renderFolderOverride(setting, c) },
        { name: t("settings.collections.syncButton"), desc: this.statusDesc(c), action: () => this.host.syncNow(c.id) },
      ],
    };
  }

  private renderFolderOverride(setting: Setting, c: CollectionConfig): void {
    setting.addText((tc) => {
      tc.setValue(c.folderOverride ?? "").onChange((v) => this.updateCollection(c.id, { folderOverride: v || undefined }));
      new FolderSuggest(this.app, tc.inputEl);
    });
  }

  private statusDesc(c: CollectionConfig): string {
    const st = this.host.status(c.id);
    if (st.running) return t("settings.collections.status.running");
    const run = st.lastRun;
    if (!run) return t("settings.collections.status.never");
    if (!run.ok || run.error) return t("settings.collections.status.error", run.error ?? "?");
    const n = run.counts;
    return t("settings.collections.status.ok", n.created, n.updated, n.archived, n.deleted, n.errors);
  }

  private updateCollection(id: string, patch: Partial<CollectionConfig>): void {
    this.host.settings = { ...this.host.settings, collections: this.host.settings.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
    void this.host.saveSettings();
  }

  // ── Profile ──────────────────────────────────────────────────────────────
  private profilesGroup(): SettingDefinitionList {
    const s = this.host.settings;
    const items: SettingGroupItem[] = s.profiles.map((p) => ({
      name: p.name,
      desc: p.kind === "contact" ? t("settings.profiles.kindContact") : t("settings.profiles.kindEvent"),
      render: (setting: Setting) => this.renderProfileRow(setting, p),
    }));
    return {
      type: "list",
      heading: t("settings.profiles.heading"),
      items,
      emptyState: t("settings.profiles.empty"),
      onDelete: (index) => this.deleteProfile(s.profiles[index]!.id),
      addItem: { name: t("settings.profiles.add"), action: () => this.addProfile() },
      extraButtons: [(btn) => btn.setIcon("clipboard-paste").setTooltip(t("settings.profiles.import")).onClick(() => this.openImportModal())],
    };
  }

  private renderProfileRow(setting: Setting, p: MappingProfile): void {
    setting.addButton((b) => b.setButtonText(t("settings.profiles.edit")).onClick(() => this.openEditModal(p)));
    setting.addButton((b) => b.setButtonText(t("settings.profiles.export")).onClick(() => void this.exportProfile(p)));
  }

  private openEditModal(p: MappingProfile): void {
    new JsonModal(this.app, JSON.stringify(p, null, 2), (raw) => this.saveProfileJson(p.id, raw)).open();
  }

  private openImportModal(): void {
    new JsonModal(this.app, "", (raw) => this.importProfileJson(raw)).open();
  }

  private saveProfileJson(originalId: string, raw: string): void {
    const parsed = this.parseJson(raw);
    if (parsed === undefined) return;
    const v = validateProfile(parsed);
    if (!v.ok) {
      new Notice(t("notice.profileInvalid", v.errors.join("; ")));
      return;
    }
    const profile: MappingProfile = { ...v.profile, id: originalId };
    this.host.settings = { ...this.host.settings, profiles: this.host.settings.profiles.map((x) => (x.id === originalId ? profile : x)) };
    void this.host.saveSettings();
    this.update();
  }

  private importProfileJson(raw: string): void {
    const parsed = this.parseJson(raw);
    if (parsed === undefined) return;
    const v = validateProfile(parsed);
    if (!v.ok) {
      new Notice(t("notice.profileInvalid", v.errors.join("; ")));
      return;
    }
    const s = this.host.settings;
    const idTaken = s.profiles.some((x) => x.id === v.profile.id);
    const profile = idTaken ? { ...v.profile, id: newId("profile", () => this.host.rand()) } : v.profile;
    this.host.settings = { ...s, profiles: [...s.profiles, profile] };
    void this.host.saveSettings();
    this.update();
  }

  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      new Notice(t("notice.jsonInvalid"));
      return undefined;
    }
  }

  private deleteProfile(id: string): void {
    const s = this.host.settings;
    if (s.collections.some((c) => c.profileId === id)) {
      new Notice(t("notice.profileInUse"));
      return;
    }
    this.host.settings = { ...s, profiles: s.profiles.filter((p) => p.id !== id) };
    void this.host.saveSettings();
    this.update();
  }

  private addProfile(): void {
    const base = defaultEventProfile();
    const profile: MappingProfile = { ...base, id: newId("profile", () => this.host.rand()), name: `${base.name} · ${t("settings.profiles.add")}` };
    this.host.settings = { ...this.host.settings, profiles: [...this.host.settings.profiles, profile] };
    void this.host.saveSettings();
    this.update();
  }

  private async exportProfile(p: MappingProfile): Promise<void> {
    const json = JSON.stringify(p, null, 2);
    // Property-Read VOR jedem Zugriff prüfen (REGISTRY „Text in die Zwischenablage schreiben"):
    // in non-secure Contexts wirft schon das Lesen von `navigator.clipboard` synchron.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      new Notice(t("notice.clipboardUnavailable"));
      return;
    }
    try {
      await clipboard.writeText(json);
      new Notice(t("notice.copied"));
    } catch (e) {
      new Notice(t("notice.copyFailed", e instanceof Error ? e.message : String(e)));
    }
  }

  // ── Synchronisation ──────────────────────────────────────────────────────
  private syncGroup(): SettingDefinitionGroup {
    const items: SettingGroupItem[] = [
      { name: t("settings.sync.intervalMinutes"), control: { type: "number", key: "sync.intervalMinutes", min: 0 } },
      { name: t("settings.sync.mobileIntervalMinutes"), control: { type: "number", key: "sync.mobileIntervalMinutes", min: 0 } },
      { name: t("settings.sync.pastDays"), control: { type: "number", key: "sync.pastDays", min: 0 } },
      { name: t("settings.sync.futureDays"), control: { type: "number", key: "sync.futureDays", min: 0 } },
      { name: t("settings.sync.startupDelaySeconds"), control: { type: "number", key: "sync.startupDelaySeconds", min: 0 } },
      {
        name: t("settings.sync.language"),
        control: { type: "dropdown", key: "language", options: { auto: t("settings.sync.languageAuto"), de: "Deutsch", en: "English" } },
      },
    ];
    return { type: "group", heading: t("settings.sync.heading"), items };
  }

  // ── Aktionen ─────────────────────────────────────────────────────────────
  private actionsGroup(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: t("settings.actions.heading"),
      items: [
        { name: t("settings.actions.syncAll"), action: () => this.host.syncNow() },
        { name: t("settings.actions.preview"), action: () => this.host.preview() },
      ],
    };
  }

  // ── Kontroll-Werte für den nativen 1.13-Renderer ────────────────────────
  getControlValue(key: string): unknown {
    if (key === "language") return this.host.settings.language;
    if (key.startsWith("sync.")) return (this.host.settings.sync as unknown as Record<string, unknown>)[key.slice("sync.".length)];
    const m = COLLECTION_KEY.exec(key);
    if (m) {
      const [, id, field] = m as unknown as [string, string, "enabled" | "profileId"];
      const c = this.host.settings.collections.find((x) => x.id === id);
      return c ? c[field] : undefined;
    }
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "language") {
      this.host.settings = { ...this.host.settings, language: value as PluginSettings["language"] };
    } else if (key.startsWith("sync.")) {
      const field = key.slice("sync.".length);
      this.host.settings = { ...this.host.settings, sync: { ...this.host.settings.sync, [field]: value } };
    } else {
      const m = COLLECTION_KEY.exec(key);
      if (!m) return;
      const [, id, field] = m as unknown as [string, string, "enabled" | "profileId"];
      this.host.settings = { ...this.host.settings, collections: this.host.settings.collections.map((c) => (c.id === id ? { ...c, [field]: value } : c)) };
    }
    // Kein this.refresh() hier: keine Zeile wird abhängig von sync/language/collections-Feldern
    // ein-/ausgeblendet — der 1.13-Renderer kommittiert den geänderten Regler selbst. Ein Full-Rebuild
    // würde zudem jede Render-Hatch (u. a. SecretComponent je Konto-Zeile) unnötig neu ausführen.
    await this.host.saveSettings();
  }
}
