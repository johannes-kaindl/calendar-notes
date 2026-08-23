import { describe, it, expect } from "vitest";
import { App, Plugin } from "obsidian";
import { CalendarNotesSettingTab, type SettingsHost } from "../../src/obsidian/settings-tab";
import { defaultSettings, type PluginSettings } from "../../src/core/settings";
import type { Account, CollectionConfig } from "../../src/core/settings";
import type { RunInfo } from "../../src/core/state/collection-state";
import type { DiscoveryResult } from "../../src/core/dav/discovery";
import type { SecretStore } from "../../src/obsidian/secrets";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

// `Plugin` ist in den realen Obsidian-Typings abstrakt — eine leere Unterklasse instanziieren
// ist die einzige Form, die sowohl zur Laufzeit (Mock) als auch fuer `tsc -p
// tsconfig.test.json` (echte Typings) funktioniert.
class TestPlugin extends Plugin {}

function fakeHost(settings: PluginSettings): SettingsHost & { saved: PluginSettings[] } {
  const secretValues = new Map<string, string>();
  const secrets: SecretStore = {
    get: (id) => secretValues.get(id) ?? null,
    set: (id, v) => { secretValues.set(id, v); },
    has: (id) => secretValues.has(id),
  };
  const host = {
    settings,
    saved: [] as PluginSettings[],
    async saveSettings(): Promise<void> {
      host.saved.push(host.settings);
    },
    secrets,
    async discover(_account: Account): Promise<DiscoveryResult> {
      return { principal: "p", collections: [], warnings: [] };
    },
    syncNow(_collectionId?: string): void {},
    preview(): void {},
    status(_collectionId: string): { lastRun?: RunInfo; running: boolean } {
      return { running: false };
    },
    rand(): number {
      return 0.42;
    },
    removeState(_source: string): void {},
    adopt(_collectionId: string): void {},
    profileFromActiveNote(): void {},
  };
  return host;
}

function newTab(host: SettingsHost): CalendarNotesSettingTab {
  const manifest = { id: "calendar-notes", name: "Calendar and Contact Notes", version: "0.1.0", minAppVersion: "1.13.0", description: "", author: "" };
  return new CalendarNotesSettingTab(new App(), new TestPlugin(new App(), manifest), host);
}

function withAccountAndCollections(): PluginSettings {
  const s = defaultSettings();
  const account: Account = { id: "a1", name: "Home", baseUrl: "https://dav.example/", username: "u", secretId: "calendar-notes-a1" };
  const eventCol: CollectionConfig = { id: "c1", accountId: "a1", href: "https://dav.example/cal/", kind: "calendar", displayName: "Calendar", enabled: true, profileId: "default-event", readOnly: false };
  const contactCol: CollectionConfig = { id: "c2", accountId: "a1", href: "https://dav.example/ab/", kind: "addressbook", displayName: "Contacts", enabled: false, profileId: "default-contact", readOnly: false };
  return { ...s, accounts: [account], collections: [eventCol, contactCol] };
}

describe("CalendarNotesSettingTab.getSettingDefinitions", () => {
  it("returns the five groups in order: Konten, Sammlungen, Profile, Synchronisation, Aktionen", () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    const defs = tab.getSettingDefinitions() as any[];
    expect(defs.map((d) => d.heading)).toEqual(["Konten", "Sammlungen", "Profile", "Synchronisation", "Aktionen"]);
  });

  it("account list has one item", () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    const defs = tab.getSettingDefinitions() as any[];
    const accounts = defs[0];
    expect(accounts.type).toBe("list");
    expect(accounts.items).toHaveLength(1);
  });

  it("without accounts, the account list shows an emptyState text", () => {
    const host = fakeHost(defaultSettings());
    const tab = newTab(host);
    const defs = tab.getSettingDefinitions() as any[];
    const accounts = defs[0];
    expect(accounts.items).toHaveLength(0);
    expect(typeof accounts.emptyState).toBe("string");
    expect(accounts.emptyState.length).toBeGreaterThan(0);
  });

  it("the collections group only offers matching-kind profiles per collection", () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    const defs = tab.getSettingDefinitions() as any[];
    const collectionsGroup = defs[1];
    expect(collectionsGroup.type).toBe("group");
    // Konto-Ebene ist eine navigierbare "page" (Obsidians SettingGroupItem-Typing erlaubt keine
    // verschachtelte Gruppe innerhalb einer Gruppe) — deren items sind wieder volle
    // SettingDefinitionItem[] und enthalten je Sammlung eine eigene Gruppe.
    const accountGroup = collectionsGroup.items[0];
    expect(accountGroup.type).toBe("page");
    expect(accountGroup.name).toBe("Home");
    expect(accountGroup.items).toHaveLength(2); // Calendar + Contacts

    const calendarGroup = accountGroup.items.find((g: any) => g.heading === "Calendar");
    const calendarProfileItem = calendarGroup.items.find((i: any) => i.control?.type === "dropdown");
    expect(Object.keys(calendarProfileItem.control.options)).toEqual(["default-event"]);

    const contactGroup = accountGroup.items.find((g: any) => g.heading === "Contacts");
    const contactProfileItem = contactGroup.items.find((i: any) => i.control?.type === "dropdown");
    expect(Object.keys(contactProfileItem.control.options)).toEqual(["default-contact"]);
  });

  it("setControlValue('sync.intervalMinutes', 5) writes into settings.sync", async () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    await tab.setControlValue("sync.intervalMinutes", 5);
    expect(host.settings.sync.intervalMinutes).toBe(5);
    expect(host.saved.length).toBeGreaterThan(0);
  });

  it("getControlValue resolves sync.* and language paths", () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    expect(tab.getControlValue("sync.pastDays")).toBe(host.settings.sync.pastDays);
    expect(tab.getControlValue("language")).toBe("auto");
  });

  it("removeState(source) is called for each removed collection when an account is deleted", () => {
    const removed: string[] = [];
    const settings = withAccountAndCollections();
    const host = fakeHost(settings);
    host.removeState = (source: string) => { removed.push(source); };
    const tab = newTab(host);
    // `update()` kommt vom nativen 1.13-Renderer (nicht Teil des Test-Mocks) — hier stubben,
    // die Methode selbst wird nicht getestet.
    (tab as unknown as { update(): void }).update = () => {};
    (tab as unknown as { deleteAccount(id: string): void }).deleteAccount("a1");
    expect(removed.sort()).toEqual(["a1/c1", "a1/c2"]);
    expect(host.settings.collections).toEqual([]);
  });

  it("discovery merge: an existing enabled collection NOT returned by discovery survives with its profileId/enabled", () => {
    const settings = withAccountAndCollections();
    const host = fakeHost(settings);
    const tab = newTab(host);
    const account = host.settings.accounts[0]!;
    // Discovery liefert diesmal NUR die Kontakte-Sammlung zurück (der Kalender fehlt, z.B. Timeout) —
    // der Kalender (c1: enabled, profileId default-event) darf trotzdem nicht verschwinden.
    (tab as unknown as { mergeDiscoveredCollections(a: typeof account, r: unknown): void }).mergeDiscoveredCollections(account, {
      principal: "p",
      collections: [{ href: "https://dav.example/ab/", kind: "addressbook", displayName: "Contacts (renamed)", readOnly: false }],
      warnings: [],
    });
    const survivor = host.settings.collections.find((c) => c.id === "c1");
    expect(survivor).toBeDefined();
    expect(survivor?.enabled).toBe(true);
    expect(survivor?.profileId).toBe("default-event");
    const updated = host.settings.collections.find((c) => c.id === "c2");
    expect(updated?.displayName).toBe("Contacts (renamed)");
    expect(host.settings.collections).toHaveLength(2);
  });
});
