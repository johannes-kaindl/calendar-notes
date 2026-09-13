import { mergeSettings } from "../vendor/code-kit/settings";
import { secretIdFor as kitSecretIdFor } from "../vendor/kit/secrets";
import { defaultContactProfile, defaultEventProfile, defaultTodoProfile, validateProfile, type MappingProfile, type ProfileKind } from "./mirror/profile";
import type { SchedulingInfo } from "./dav/scheduling";
import type { SecretStore } from "./sync/types";

export interface Account {
  id: string;
  name: string;
  baseUrl: string;
  username: string;
  secretId: string;
  principal?: string;
  calendarHome?: string;
  addressbookHome?: string;
  scheduling?: SchedulingInfo;
}

export interface CollectionConfig {
  id: string;
  accountId: string;
  href: string;
  kind: "calendar" | "addressbook";
  displayName: string;
  enabled: boolean;
  profileId: string;
  folderOverride?: string;
  readOnly: boolean;
  /** `supported-calendar-component-set` des Servers (z. B. `["VEVENT"]`, `["VTODO"]`).
   *  Fehlt, wenn der Server nichts sagt — dann wird nichts angenommen. */
  components?: string[];
  ctag?: string;
  syncToken?: string;
}

/**
 * Passt diese Sammlung zu einem Profil dieser Sorte? Nur `supported-calendar-component-set`
 * beantwortet das fuer Kalender — die Ressourcentyp-Angabe (`<c:calendar/>`) tut es NICHT:
 * mailbox.org fuehrt VEVENT und VTODO in getrennten Collections, die beide `calendar` sind
 * (Befund `docs/dav/befunde/mailbox-org.md`, Punkt 3).
 *
 * Sagt der Server nichts (Feld fehlt — Radicale etwa liefert es nicht zwingend), wird nichts
 * angenommen und die Paarung gilt als moeglich.
 *
 * Gefragt wird nach der PAARUNG, nicht nach der Sammlung allein: eine Aufgaben-Sammlung ist
 * nicht "unbrauchbar", sie passt nur nicht zu einem Termin-Profil. Liegt hier und nicht im Sync,
 * weil die Einstellungen dieselbe Frage beantworten muessen — ein Nutzer, dem die Zeile nichts
 * sagt, aktiviert sie und wartet auf einen Lauf, der wortlos uebersprungen wird.
 */
export function collectionSupports(col: CollectionConfig, kind: ProfileKind): boolean {
  if (kind === "contact") return col.kind === "addressbook";
  if (col.kind !== "calendar") return false;
  if (!col.components?.length) return true;
  const want = kind === "event" ? "VEVENT" : "VTODO";
  return col.components.some((c) => c.toUpperCase() === want);
}

export interface SyncSettings {
  intervalMinutes: number;
  mobileIntervalMinutes: number;
  pastDays: number;
  futureDays: number;
  startupDelaySeconds: number;
  requestTimeoutMs: number;
  batchSize: number;
}

export interface PluginSettings {
  version: 1;
  accounts: Account[];
  collections: CollectionConfig[];
  profiles: MappingProfile[];
  sync: SyncSettings;
  language: "auto" | "de" | "en";
}

export const DEFAULT_SYNC: SyncSettings = {
  intervalMinutes: 15,
  mobileIntervalMinutes: 60,
  pastDays: 90,
  futureDays: 365,
  startupDelaySeconds: 10,
  requestTimeoutMs: 30000,
  batchSize: 50,
};

export function defaultSettings(): PluginSettings {
  return {
    version: 1,
    accounts: [],
    collections: [],
    profiles: [defaultContactProfile(), defaultEventProfile(), defaultTodoProfile()],
    sync: { ...DEFAULT_SYNC },
    language: "auto",
  };
}

function clamp(n: unknown, min: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return v < min ? min : v;
}

function normalizeSync(raw: unknown): SyncSettings {
  const merged = mergeSettings(DEFAULT_SYNC, raw);
  return {
    intervalMinutes: clamp(merged.intervalMinutes, 0, DEFAULT_SYNC.intervalMinutes),
    mobileIntervalMinutes: clamp(merged.mobileIntervalMinutes, 0, DEFAULT_SYNC.mobileIntervalMinutes),
    pastDays: clamp(merged.pastDays, 0, DEFAULT_SYNC.pastDays),
    futureDays: clamp(merged.futureDays, 0, DEFAULT_SYNC.futureDays),
    startupDelaySeconds: clamp(merged.startupDelaySeconds, 0, DEFAULT_SYNC.startupDelaySeconds),
    requestTimeoutMs: clamp(merged.requestTimeoutMs, 1000, DEFAULT_SYNC.requestTimeoutMs),
    batchSize: clamp(merged.batchSize, 1, DEFAULT_SYNC.batchSize),
  };
}

function normalizeProfiles(raw: unknown): MappingProfile[] {
  const out: MappingProfile[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw) {
      const v = validateProfile(p);
      if (v.ok) out.push(v.profile);
    }
  }
  for (const def of [defaultContactProfile(), defaultEventProfile(), defaultTodoProfile()]) {
    if (!out.some((p) => p.id === def.id)) out.push(def);
  }
  return out;
}

function normalizeScheduling(raw: unknown): SchedulingInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o["addresses"]) || !o["addresses"].every((x) => typeof x === "string")) return undefined;
  if (o["outbox"] !== undefined && typeof o["outbox"] !== "string") return undefined;
  if (o["inbox"] !== undefined && typeof o["inbox"] !== "string") return undefined;
  const info: SchedulingInfo = { addresses: o["addresses"] };
  if (typeof o["outbox"] === "string") info.outbox = o["outbox"];
  if (typeof o["inbox"] === "string") info.inbox = o["inbox"];
  return info;
}

function normalizeAccounts(raw: unknown): Account[] {
  if (!Array.isArray(raw)) return [];
  const out: Account[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    if (typeof o["id"] !== "string" || typeof o["name"] !== "string" || typeof o["baseUrl"] !== "string" || typeof o["username"] !== "string" || typeof o["secretId"] !== "string") continue;
    const acc: Account = { id: o["id"], name: o["name"], baseUrl: o["baseUrl"], username: o["username"], secretId: o["secretId"] };
    if (typeof o["principal"] === "string") acc.principal = o["principal"];
    if (typeof o["calendarHome"] === "string") acc.calendarHome = o["calendarHome"];
    if (typeof o["addressbookHome"] === "string") acc.addressbookHome = o["addressbookHome"];
    const scheduling = normalizeScheduling(o["scheduling"]);
    if (scheduling) acc.scheduling = scheduling;
    out.push(acc);
  }
  return out;
}

function normalizeCollections(raw: unknown, accountIds: Set<string>, profileIds: Set<string>): CollectionConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: CollectionConfig[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o["id"] !== "string" || typeof o["accountId"] !== "string" || typeof o["href"] !== "string") continue;
    if (o["kind"] !== "calendar" && o["kind"] !== "addressbook") continue;
    if (typeof o["displayName"] !== "string" || typeof o["profileId"] !== "string") continue;
    if (!accountIds.has(o["accountId"])) continue;
    if (!profileIds.has(o["profileId"])) continue;
    const col: CollectionConfig = {
      id: o["id"],
      accountId: o["accountId"],
      href: o["href"],
      kind: o["kind"],
      displayName: o["displayName"],
      enabled: o["enabled"] === true,
      profileId: o["profileId"],
      readOnly: o["readOnly"] === true,
    };
    const comps = o["components"];
    if (Array.isArray(comps) && comps.length > 0 && comps.every((x) => typeof x === "string")) col.components = comps;
    if (typeof o["folderOverride"] === "string") col.folderOverride = o["folderOverride"];
    if (typeof o["ctag"] === "string") col.ctag = o["ctag"];
    if (typeof o["syncToken"] === "string") col.syncToken = o["syncToken"];
    out.push(col);
  }
  return out;
}

export function normalizeSettings(raw: unknown): PluginSettings {
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profiles = normalizeProfiles(r["profiles"]);
  const accounts = normalizeAccounts(r["accounts"]);
  const accountIds = new Set(accounts.map((a) => a.id));
  const profileIds = new Set(profiles.map((p) => p.id));
  const collections = normalizeCollections(r["collections"], accountIds, profileIds);
  const sync = normalizeSync(r["sync"]);
  const language = r["language"] === "de" || r["language"] === "en" ? r["language"] : "auto";
  return { version: 1, accounts, collections, profiles, sync, language };
}

export function secretIdFor(accountId: string): string {
  return kitSecretIdFor("calendar-notes", accountId);
}

/** Raeumt den Schaden auf, den die Versionen bis 0.1.4 angerichtet haben: der Passwort-Verweis
 *  im Settings-Tab speicherte die vom Schluesselbund-Dialog zurueckgegebene Secret-ID als
 *  Passwort-WERT unter der plugin-eigenen ID (`SecretComponent.onChange` liefert die ID, nicht
 *  den Wert). Betroffene Konten meldeten sich mit dem NAMEN ihres Eintrags an und bekamen von
 *  jedem Server 401 — im Settings-Tab sah die Zeile dabei befuellt aus.
 *
 *  Erkennbar ist das daran, dass unter `account.secretId` ein Wert liegt, der SELBST ein
 *  vorhandener Schluesselbund-Eintrag ist. Ein echtes Passwort ist das nie: bis 0.1.4 war
 *  `secretId` immer die generierte ID (`secretIdFor`), nie eine vom Nutzer gewaehlte, und der
 *  Wert darunter kam ausschliesslich aus diesem Rueckruf.
 *
 *  Der Fall ist verlustfrei reparierbar — der Muellwert IST die ID mit dem echten Passwort, das
 *  Konto wird darauf umgehaengt. Zeigt der Wert auf die eigene ID (Picker mit unveraenderter
 *  Vorauswahl bestaetigt), gibt es nichts, worauf umzuhaengen waere: das Konto gilt wieder als
 *  unverknuepft, damit die Zeile ehrlich „verknuepfen" anbietet statt Punkte zu zeigen. Der
 *  unbrauchbare Eintrag wird best effort geleert (`SecretStore` kennt kein Loeschen). */
export function repairSecretLinks(settings: PluginSettings, secrets: SecretStore): PluginSettings {
  const repaired = new Map<string, string>();
  for (const account of settings.accounts) {
    if (account.secretId === "") continue;
    const stored = secrets.get(account.secretId);
    if (stored === null || stored === "") continue;
    // Der Wert zeigt auf die eigene ID → kein Ziel zum Umhaengen. Sonst muss er ein
    // vorhandener Eintrag sein, sonst ist es kein Schaden dieser Sorte.
    if (stored !== account.secretId && !secrets.has(stored)) continue;
    repaired.set(account.id, stored === account.secretId ? "" : stored);
    try {
      secrets.set(account.secretId, "");
    } catch {
      /* best effort — ein nicht leerbarer Eintrag darf den Start nicht verhindern */
    }
  }
  if (repaired.size === 0) return settings;
  return { ...settings, accounts: settings.accounts.map((a) => (repaired.has(a.id) ? { ...a, secretId: repaired.get(a.id)! } : a)) };
}

export function newId(prefix: string, rand: () => number): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += Math.floor(rand() * 36).toString(36);
  return `${prefix}-${out}`;
}

export function sourceOf(c: CollectionConfig): string {
  return `${c.accountId}/${c.id}`;
}

export function effectiveProfile(s: PluginSettings, c: CollectionConfig): MappingProfile | undefined {
  const p = s.profiles.find((p) => p.id === c.profileId);
  if (!p) return undefined;
  return c.folderOverride ? { ...p, folder: c.folderOverride } : p;
}
