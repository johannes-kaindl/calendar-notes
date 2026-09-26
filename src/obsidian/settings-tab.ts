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
  type ExtraButtonComponent,
  type Plugin,
  type SettingDefinitionGroup,
  type SettingDefinitionItem,
  type SettingDefinitionList,
  type SettingGroupItem,
} from "obsidian";
import type { DiscoveryResult } from "../core/dav/discovery";
import { defaultEventProfile, defaultTodoProfile, validateProfile, type MappingProfile } from "../core/mirror/profile";
import { collectionSupports, effectiveProfile, newId, secretIdFor, sourceOf, type Account, type CollectionConfig, type PluginSettings } from "../core/settings";
import type { RunInfo } from "../core/state/collection-state";
import { t } from "../i18n/strings";
import { FolderSuggest } from "../vendor/kit-obsidian/folder-suggest";
import { githubHelpUrls, helpSettingDefinition } from "../vendor/kit-obsidian/help-setting";
import { settingBodyHost } from "../vendor/kit-obsidian/settings_walker";
import { JsonModal } from "./json-modal";
import { profileFromTaskNotes, readTaskNotes } from "./tasknotes";
import type { SecretStore } from "../vendor/kit/secrets";

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
  /** Entfernt den gespeicherten Sync-Zustand einer Sammlung (`state/<source>.json`) —
   *  gebraucht beim Konto-Löschen, damit ein spaeter neu angelegtes Konto mit gleicher
   *  Sammlung nicht auf verwaisten Snapshot/Verlauf trifft. */
  removeState(source: string): void;
  /** Startet den Adoptions-Fluss (Server-Eintraege ↔ bestehende Notizen) fuer eine Sammlung. */
  adopt(collectionId: string): void;
  /** Leitet aus der aktiven Notiz ein neues Zuordnungsprofil ab (Kind-Wahl passiert im Host). */
  profileFromActiveNote(): void;
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
    return [
      // UI-STANDARD §8 help row: always the first element, before the intro and every group.
      helpSettingDefinition({
        ...githubHelpUrls("calendar-notes"),
        texts: {
          name: t("settings.help.name"),
          desc: t("settings.help.desc"),
          openDocs: t("settings.help.openDocs"),
          reportIssue: t("settings.help.reportIssue"),
        },
      }),
      { name: t("settings.accounts.intro"), desc: t("settings.accounts.introDesc") },
      this.accountsGroup(),
      this.collectionsGroup(),
      this.profilesIntroGroup(),
      this.profilesGroup(),
      this.syncGroup(),
      this.displayGroup(),
      this.actionsGroup(),
    ];
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
    new Setting(host).setName(t("settings.accounts.name")).setDesc(t("settings.accounts.nameDesc")).addText((c) => c.setValue(account.name).onChange((v) => this.updateAccount(account.id, { name: v })));
    new Setting(host).setName(t("settings.accounts.baseUrl")).setDesc(t("settings.accounts.baseUrlDesc")).addText((c) => c.setValue(account.baseUrl).onChange((v) => this.updateAccount(account.id, { baseUrl: v })));
    new Setting(host).setName(t("settings.accounts.username")).setDesc(t("settings.accounts.usernameDesc")).addText((c) => c.setValue(account.username).onChange((v) => this.updateAccount(account.id, { username: v })));

    // `SecretComponent` ist ein VERWEIS auf einen Schluesselbund-Eintrag, kein Passwortfeld:
    // `setValue` nimmt die Secret-ID, und der Rueckruf liefert die ID des im Dialog gewaehlten
    // bzw. neu angelegten Eintrags — nie dessen Wert; das X loest die Verknuepfung und ruft
    // mit `null` zurueck. Obsidian schreibt den Wert selbst in den Schluesselbund; das Plugin
    // merkt sich nur, WELCHER Eintrag zu diesem Konto gehoert. (Bis 0.1.4 wurde die
    // zurueckgegebene ID als Passwort-Wert gespeichert — das Konto meldete sich dann mit dem
    // Namen des Eintrags an und bekam von jedem Server 401.)
    const secretSetting = new Setting(host).setName(t("settings.accounts.password"));
    secretSetting.setDesc(this.host.secrets.has(account.secretId) ? t("settings.accounts.passwordDesc") : `${t("settings.accounts.noSecret")} ${t("settings.accounts.passwordDesc")}`);
    new SecretComponent(this.app, secretSetting.controlEl)
      .setValue(account.secretId)
      .onChange((secretId: string | null) => this.updateAccount(account.id, { secretId: secretId ?? "" }));

    new Setting(host)
      .setName(t("settings.accounts.testButton"))
      .setDesc(t("settings.accounts.testButtonDesc"))
      .addButton((b) => b.setButtonText(t("settings.accounts.testButton")).onClick(() => void this.testAccount(account)));

    this.renderCollectionPicker(host, account);
  }

  /** Die Auswahl „was soll gespiegelt werden?" — direkt unter dem Discovery-Button.
   *
   *  Sie stand bis 0.1.9 ausschliesslich unter „Kalender & Adressbuecher", dort aber eine
   *  Ebene tief hinter einer Seite, die den KONTOnamen traegt (eine Obsidian-Gruppe darf keine
   *  Gruppe enthalten, nur Seiten — s. Kommentar an `collectionsGroup`). Beim Erstkontakt
   *  2026-08-29 las sich das als „ich habe nur eine Sammlung", und die Anschlussfrage war, ob
   *  der zweite Menuepunkt ueberhaupt noetig sei. Entschieden am 2026-08-30: die AUSWAHL kommt
   *  hierher, die Feineinstellung (Profil, Ordner, Abgleichen, Verknuepfen) bleibt dort — ein
   *  Einrichtungsweg, aber ohne fuenf Zeilen je Sammlung in einer aufklappbaren Zeile zu stapeln.
   *
   *  Der Haken ist derselbe Wert wie auf der Sammlungs-Seite (`enabled`), kein zweiter Zustand. */
  private renderCollectionPicker(host: HTMLElement, account: Account): void {
    new Setting(host).setName(t("settings.accounts.collectionsHeading")).setHeading();
    const cols = this.host.settings.collections.filter((c) => c.accountId === account.id);
    if (cols.length === 0) {
      new Setting(host).setDesc(t("settings.accounts.collectionsEmpty"));
      return;
    }
    for (const c of cols) {
      new Setting(host)
        .setName(c.displayName)
        .setDesc(this.enabledDesc(c))
        .addToggle((tg) => tg.setValue(c.enabled).onChange((v) => this.updateCollection(c.id, { enabled: v })));
    }
  }

  /** Erklaerung am „spiegeln"-Schalter — EINE Quelle fuer beide Orte, an denen er steht.
   *  Zwei Texte fuer denselben Schalter waeren zwei Wahrheiten; die Warnung „diese Sammlung
   *  fuehrt keine Termine" ist genau die, die man an der Auswahl braucht, nicht erst danach. */
  private enabledDesc(c: CollectionConfig): string {
    const profile = effectiveProfile(this.host.settings, c);
    if (!profile || collectionSupports(c, profile.kind)) return t("settings.collections.enabledDesc");
    return t("settings.collections.enabledMismatch", (c.components ?? []).join(", "));
  }

  private updateAccount(id: string, patch: Partial<Account>): void {
    this.host.settings = { ...this.host.settings, accounts: this.host.settings.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
    void this.host.saveSettings();
  }

  private addAccount(): void {
    const id = newId("acc", () => this.host.rand());
    const account: Account = { id, name: t("settings.accounts.newAccountDefaultName"), baseUrl: "", username: "", secretId: secretIdFor(id) };
    this.host.settings = { ...this.host.settings, accounts: [...this.host.settings.accounts, account] };
    void this.host.saveSettings();
    this.update();
  }

  private deleteAccount(id: string): void {
    const s = this.host.settings;
    const removedCollections = s.collections.filter((c) => c.accountId === id);
    this.host.settings = { ...s, accounts: s.accounts.filter((a) => a.id !== id), collections: s.collections.filter((c) => c.accountId !== id) };
    void this.host.saveSettings();
    for (const c of removedCollections) this.host.removeState(sourceOf(c));
    // Der Schluesselbund-Eintrag bleibt stehen: im Verweis-Modell gehoert er dem Nutzer (er hat
    // ihn benannt, ein zweites Konto darf denselben nutzen), nicht diesem Konto. Entfernt wird
    // er in Obsidians eigener Schluesselbund-Verwaltung.
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
    const seenHrefs = new Set<string>();
    for (const dc of result.collections) {
      seenHrefs.add(dc.href);
      const prev = existingByHref.get(dc.href);
      if (prev) {
        // `components` wird bewusst GESETZT ODER GELOESCHT (nicht wie ctag/syncToken nur bei
        // Vorhandensein uebernommen): zieht der Server seine Angabe zurueck, bliebe eine
        // Sammlung sonst dauerhaft gesperrt, weil der alte Wert als Wahrheit stehenbleibt.
        const { components: _drop, ...rest } = prev;
        merged.push({ ...rest, displayName: dc.displayName, readOnly: dc.readOnly, ...(dc.components?.length ? { components: dc.components } : {}), ...(dc.ctag ? { ctag: dc.ctag } : {}), ...(dc.syncToken ? { syncToken: dc.syncToken } : {}) });
      } else {
        const isTodoOnly = dc.kind === "calendar" && dc.components?.length
          ? dc.components.some((x) => x.toUpperCase() === "VTODO") && !dc.components.some((x) => x.toUpperCase() === "VEVENT")
          : false;
        const profileId = dc.kind !== "calendar" ? "default-contact" : isTodoOnly ? "default-todo" : "default-event";
        merged.push({ id: newId("col", () => this.host.rand()), accountId: account.id, href: dc.href, kind: dc.kind, displayName: dc.displayName, enabled: false, profileId, readOnly: dc.readOnly, ...(dc.components?.length ? { components: dc.components } : {}) });
      }
    }
    // Sammlungen dieses Kontos, die die Discovery diesmal NICHT zurueckgab (Server-seitig
    // temporaer weg, Timeout, Filter) bleiben unveraendert bestehen — sonst verliert eine
    // aktivierte Sammlung stillschweigend ihre Konfiguration (enabled/profileId/folderOverride).
    const keptExisting = s.collections.filter((c) => c.accountId === account.id && !seenHrefs.has(c.href));
    const untouched = s.collections.filter((c) => c.accountId !== account.id);
    const accounts = s.accounts.map((a) =>
      a.id === account.id
        ? { ...a, principal: result.principal, ...(result.calendarHome ? { calendarHome: result.calendarHome } : {}), ...(result.addressbookHome ? { addressbookHome: result.addressbookHome } : {}) }
        : a,
    );
    this.host.settings = { ...s, accounts, collections: [...untouched, ...merged, ...keptExisting] };
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
    const items: SettingGroupItem[] = [{ name: t("settings.collections.intro"), desc: t("settings.collections.introDesc") }];
    for (const account of s.accounts) {
      const cols = s.collections.filter((c) => c.accountId === account.id);
      if (cols.length === 0) continue;
      // Die Seite traegt den KONTOnamen, weil eine Obsidian-Gruppe keine Gruppe enthalten darf
      // (nur Seiten). Ohne Zusatz liest sich der Kontoname wie der Name einer Sammlung — genau
      // dieser Eindruck entstand beim Erstkontakt 2026-08-29 ("sieht aus, als haette ich nur eine").
      items.push({ type: "page", name: t("settings.collections.accountPage", account.name, String(cols.length)), items: cols.map((c) => this.collectionGroup(c, s)) });
    }
    if (items.length === 1) items.push({ name: t("settings.collections.empty") });
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
        // Eine Sammlung, die keine Termine fuehrt, wird vom Sync uebersprungen — das muss an
        // der Zeile stehen, sonst schaltet der Nutzer sie ein und wartet wortlos auf nichts.
        {
          name: t("settings.collections.enabled"),
          desc: this.enabledDesc(c),
          control: { type: "toggle", key: `collections.${c.id}.enabled` },
        },
        { name: t("settings.collections.profile"), desc: t("settings.collections.profileDesc"), control: { type: "dropdown", key: `collections.${c.id}.profileId`, options: profileOptions } },
        { name: t("settings.collections.folder"), desc: t("settings.collections.folderDesc"), render: (setting: Setting) => this.renderFolderOverride(setting, c) },
        { name: t("settings.collections.syncButton"), desc: this.statusDesc(c), action: () => this.host.syncNow(c.id) },
        { name: t("settings.collections.adoptButton"), desc: t("settings.collections.adoptButtonDesc"), action: () => this.host.adopt(c.id) },
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
    return t("settings.collections.status.ok", n.created, n.updated, n.archived, n.deleted, n.skipped, n.errors);
  }

  private updateCollection(id: string, patch: Partial<CollectionConfig>): void {
    this.host.settings = { ...this.host.settings, collections: this.host.settings.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
    void this.host.saveSettings();
  }

  // ── Profile ──────────────────────────────────────────────────────────────
  /** Erklaerung + der Weg zum ersten Profil. Bewusst NICHT in `profilesGroup()`: dort wuerde
   *  jede Fremdzeile die `onDelete`-Indizes der Liste verschieben. */
  private profilesIntroGroup(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: t("settings.profiles.heading"),
      items: [
        { name: t("settings.profiles.intro"), desc: t("settings.profiles.introDesc") },
        { name: t("settings.profiles.fromNote"), desc: t("settings.profiles.fromNoteDesc"), action: () => this.host.profileFromActiveNote() },
      ],
    };
  }

  private profilesGroup(): SettingDefinitionList {
    const s = this.host.settings;
    const items: SettingGroupItem[] = s.profiles.map((p) => ({
      name: p.name,
      desc: p.kind === "contact" ? t("settings.profiles.kindContact") : t("settings.profiles.kindEvent"),
      render: (setting: Setting) => this.renderProfileRow(setting, p),
    }));
    // Der Knopf wird nur gerendert, wenn readTaskNotes(...) tatsaechlich etwas liefert — ein
    // toter Knopf, der beim Druecken nur eine Fehlermeldung zeigt, ist schlechter als keiner.
    const tasknotesAvailable = readTaskNotes(this.app) !== undefined;
    return {
      type: "list",
      items,
      emptyState: t("settings.profiles.empty"),
      onDelete: (index) => this.deleteProfile(s.profiles[index]!.id),
      addItem: { name: t("settings.profiles.add"), action: () => this.addProfile() },
      extraButtons: [
        (btn) => btn.setIcon("clipboard-paste").setTooltip(t("settings.profiles.import")).onClick(() => this.openImportModal()),
        (btn) => btn.setIcon("wand").setTooltip(t("settings.profiles.fromNoteButton")).onClick(() => this.host.profileFromActiveNote()),
        ...(tasknotesAvailable
          ? [(btn: ExtraButtonComponent) => btn.setIcon("list-checks").setTooltip(t("settings.profiles.fromTaskNotes")).onClick(() => this.addProfileFromTaskNotes())]
          : []),
      ],
    };
  }

  private addProfileFromTaskNotes(): void {
    const reading = readTaskNotes(this.app);
    if (!reading) {
      new Notice(t("notice.tasknotesUnavailable"));
      return;
    }
    const frueher = this.host.settings.profiles.find((x) => x.kind === "todo" && x.taskNotesSpec !== undefined);
    if (frueher?.taskNotesSpec !== undefined && frueher.taskNotesSpec !== reading.specVersion) {
      // Die API ist ein Release Candidate. Der Bruch faellt genau HIER auf — im Sync nie, weil
      // das Profil eingefroren laeuft (Spec § 5). Deshalb sagen, statt still zu ueberschreiben.
      new Notice(t("notice.tasknotesSpecChanged", frueher.taskNotesSpec, reading.specVersion), 10000);
    }
    const id = newId("profile", () => this.host.rand());
    const { profile, warnings } = profileFromTaskNotes(reading, defaultTodoProfile(), t("settings.profiles.fromTaskNotes.name"), id);
    this.host.settings = { ...this.host.settings, profiles: [...this.host.settings.profiles, profile] };
    void this.host.saveSettings();
    this.update();
    if (warnings.includes("cancelled-collides-with-completed")) new Notice(t("notice.tasknotesCancelledCollides"), 10000);
    else new Notice(t("notice.tasknotesProfileCreated", profile.name));
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
      { name: t("settings.sync.intervalMinutes"), desc: t("settings.sync.intervalMinutesDesc"), control: { type: "number", key: "sync.intervalMinutes", min: 0 } },
      { name: t("settings.sync.mobileIntervalMinutes"), desc: t("settings.sync.mobileIntervalMinutesDesc"), control: { type: "number", key: "sync.mobileIntervalMinutes", min: 0 } },
      { name: t("settings.sync.pastDays"), desc: t("settings.sync.pastDaysDesc"), control: { type: "number", key: "sync.pastDays", min: 0 } },
      { name: t("settings.sync.futureDays"), desc: t("settings.sync.futureDaysDesc"), control: { type: "number", key: "sync.futureDays", min: 0 } },
      { name: t("settings.sync.startupDelaySeconds"), desc: t("settings.sync.startupDelaySecondsDesc"), control: { type: "number", key: "sync.startupDelaySeconds", min: 0 } },
    ];
    return { type: "group", heading: t("settings.sync.heading"), items };
  }

  // ── Darstellung ──────────────────────────────────────────────────────────
  // Die Sprachwahl stand bis 2026-08-29 unter "Synchronisation" — dort sucht sie niemand,
  // und sie hat mit dem Abgleich nichts zu tun (Erstkontakt-Befund B5).
  private displayGroup(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: t("settings.display.heading"),
      items: [
        {
          name: t("settings.sync.language"),
          desc: t("settings.sync.languageDesc"),
          control: { type: "dropdown", key: "language", options: { auto: t("settings.sync.languageAuto"), de: "Deutsch", en: "English" } },
        },
      ],
    };
  }

  // ── Aktionen ─────────────────────────────────────────────────────────────
  private actionsGroup(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: t("settings.actions.heading"),
      items: [
        { name: t("settings.actions.preview"), desc: t("settings.actions.previewDesc"), action: () => this.host.preview() },
        { name: t("settings.actions.syncAll"), desc: t("settings.actions.syncAllDesc"), action: () => this.host.syncNow() },
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
