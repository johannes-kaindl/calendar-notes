import { Notice, type App } from "obsidian";
import { withBasicAuth } from "../core/dav/transport";
import type { Transport } from "../core/dav/types";
import type { NoteLookup } from "../core/mirror/apply";
import type { AttendeeResolver } from "../core/mirror/fields";
import { fmKeyFor, type MappingProfile } from "../core/mirror/profile";
import { effectiveProfile, sourceOf, type Account, type PluginSettings } from "../core/settings";
import type { Notifier, SyncDeps } from "../core/sync/types";
import { t } from "../i18n/strings";
import { obsidianSecretStore } from "./secrets";
import { adapterStateStore } from "./state-store";
import { obsidianTransport } from "./transport";
import { vaultPlanExecutor, VaultNoteLookup } from "./vault-notes";

/** `Notice` als `Notifier`: `warn` bekommt keinen eigenen Obsidian-Kanal, zeigt sich also
 *  ebenfalls als Notice (mit "Warnung:"-Präfix, damit sie sich von `info` unterscheidet). */
function noticeNotifier(): Notifier {
  return {
    info(msg: string): void {
      new Notice(msg);
    },
    warn(msg: string): void {
      new Notice(`⚠ ${msg}`);
    },
    handEdited(count: number): void {
      new Notice(t("notice.handEdited", count));
    },
  };
}

/** Baut den E-Mail→Notiz-Index ueber ALLE Sammlungen, deren effektives Profil `kind: "contact"`
 *  ist: Frontmatter-Feld = `fmKeyFor(profile, "email")`, Wert (kleingeschrieben) → Pfad + Anzeige
 *  (Dateiname ohne Extension). Wird lazy je Lauf gebaut (`resolveAttendee` in `SyncDeps` ist
 *  selbst eine Funktion, die den Resolver erst bei Bedarf liefert). */
function buildAttendeeIndex(app: App, settings: PluginSettings): AttendeeResolver | undefined {
  const contactProfiles = new Map<string, MappingProfile>();
  for (const c of settings.collections) {
    const p = settings.profiles.find((p) => p.id === c.profileId);
    if (p && p.kind === "contact") contactProfiles.set(p.id, c.folderOverride ? { ...p, folder: c.folderOverride } : p);
  }
  if (contactProfiles.size === 0) return undefined;

  const byEmail = new Map<string, { path: string; display: string }>();
  for (const profile of contactProfiles.values()) {
    const emailKey = fmKeyFor(profile, "email");
    if (!emailKey) continue;
    for (const file of app.vault.getMarkdownFiles()) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      const raw: unknown = fm?.[emailKey];
      const email = typeof raw === "string" ? raw : undefined;
      if (!email) continue;
      byEmail.set(email.toLowerCase(), { path: file.path, display: file.basename });
    }
  }
  if (byEmail.size === 0) return undefined;
  return (email: string) => byEmail.get(email.toLowerCase());
}

/** Sammelt die bereits bekannten Notiz-Pfade einer Sammlung aus ihrem gespeicherten Zustand —
 *  fuer `VaultNoteLookup.prime()`, damit auch handbearbeitete Notizen ohne (mehr) passendes
 *  Frontmatter geladen werden, statt beim Abgleich stillschweigend als fehlend zu gelten. */
async function statePathsFor(app: App, source: string, pluginDir: string): Promise<string[]> {
  const stateStore = adapterStateStore(app.vault.adapter, pluginDir);
  const state = await stateStore.load(source);
  const paths: string[] = [];
  for (const obj of Object.values(state.objects)) {
    for (const note of Object.values(obj.notes)) paths.push(note.path);
  }
  return paths;
}

/** Baut die konkreten `SyncDeps` fuer den `SyncService` aus `App` + Plugin-Zustand.
 *  `settings`/`saveSettings` sind Closures ueber den Plugin-Host, damit der Service immer
 *  den aktuellen Stand sieht (kein veraltetes Capture beim Konstruktor-Aufruf). */
export function buildSyncDeps(app: App, pluginDir: string, host: { settings(): PluginSettings; saveSettings(s: PluginSettings): Promise<void> }): SyncDeps {
  const secrets = obsidianSecretStore(app);
  const stateStore = adapterStateStore(app.vault.adapter, pluginDir);
  const executor = vaultPlanExecutor(app);
  const notify = noticeNotifier();

  return {
    settings: () => host.settings(),
    saveSettings: (s) => host.saveSettings(s),
    secrets,
    stateStore,
    transportFor(account: Account, password: string): Transport {
      const base = obsidianTransport({ timeoutMs: host.settings().sync.requestTimeoutMs });
      return withBasicAuth(base, account.username, password);
    },
    async lookupFor(profile): Promise<NoteLookup> {
      const lookup = new VaultNoteLookup(app, profile);
      const settings = host.settings();
      // Sammlungen, deren EFFEKTIVES Profil (inkl. Ordner-Override) genau dieses `profile` ist —
      // der SyncService uebergibt hier `effectiveProfile(settings, col)`, s. core/sync/service.ts.
      const cols = settings.collections.filter((c) => {
        const ep = effectiveProfile(settings, c);
        return ep?.id === profile.id && ep.folder === profile.folder;
      });
      const pathLists = await Promise.all(cols.map((c) => statePathsFor(app, sourceOf(c), pluginDir)));
      await lookup.prime(pathLists.flat());
      return lookup;
    },
    executor,
    notify,
    now: () => new Date(),
    resolveAttendee: () => buildAttendeeIndex(app, host.settings()),
  };
}
