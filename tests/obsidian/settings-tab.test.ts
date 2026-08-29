import { describe, it, expect } from "vitest";
import { App, Plugin, Setting } from "obsidian";
// Direkt aus dem Mock, nicht aus "obsidian": `instances`/`choose` sind Testhilfen, die es in
// den echten Typings nicht gibt — `tsc -p tsconfig.test.json` prueft gegen die echten.
import { SecretComponent } from "../__mocks__/obsidian";
import { makeFakeEl } from "../vendor/kit/obsidian-mock";
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

function fakeHost(settings: PluginSettings): SettingsHost & { saved: PluginSettings[]; secretWrites: [string, string][] } {
  const secretValues = new Map<string, string>();
  const secretWrites: [string, string][] = [];
  const secrets: SecretStore = {
    get: (id) => secretValues.get(id) ?? null,
    set: (id, v) => { secretWrites.push([id, v]); secretValues.set(id, v); },
    has: (id) => (secretValues.get(id) ?? "") !== "",
  };
  const host = {
    settings,
    saved: [] as PluginSettings[],
    secretWrites,
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
  it("fuehrt die Gruppen in Reihenfolge, mit einer Einleitungszeile vor allen Gruppen", () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    const defs = tab.getSettingDefinitions() as any[];
    // Erstes Element ist die Einleitung ohne Ueberschrift (erklaert, was das Plugin ueberhaupt tut).
    expect(defs[0].heading).toBeUndefined();
    expect(defs[0].desc.length).toBeGreaterThan(0);
    expect(defs.map((d) => d.heading).filter(Boolean)).toEqual([
      "Konten",
      "Kalender & Adressbücher",
      "Profile — welches Feld gehört wohin",
      "Abgleich",
      "Darstellung",
      "Aktionen",
    ]);
  });

  // Eine `type: "list"` zaehlt onDelete/onReorder ueber den Index in `items`. Eine
  // Erklaerzeile darin wuerde beim Loeschen das falsche Objekt treffen — deshalb duerfen
  // die Listen NUR ihre eigenen Eintraege fuehren. Regressionsschutz fuer 2026-08-29.
  it("Listen mit onDelete enthalten ausschliesslich ihre eigenen Eintraege", () => {
    const host = fakeHost(withAccountAndCollections());
    const defs = newTab(host).getSettingDefinitions() as any[];
    const lists = defs.filter((d) => d.type === "list" && typeof d.onDelete === "function");
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      for (const item of list.items) {
        // Jede Zeile einer solchen Liste bildet genau ein loeschbares Objekt ab: sie zeichnet
        // sich selbst (render). Eine reine Text-/Aktionszeile hat kein render und gehoert
        // damit nicht hinein.
        expect(typeof item.render).toBe("function");
      }
    }
  });

  it("account list has one item", () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    const accounts = accountList(tab);
    expect(accounts.type).toBe("list");
    expect(accounts.items).toHaveLength(1);
  });

  it("without accounts, the account list shows an emptyState text", () => {
    const host = fakeHost(defaultSettings());
    const tab = newTab(host);
    const accounts = accountList(tab);
    expect(accounts.items).toHaveLength(0);
    expect(typeof accounts.emptyState).toBe("string");
    expect(accounts.emptyState.length).toBeGreaterThan(0);
  });

  it("the collections group only offers matching-kind profiles per collection", () => {
    const host = fakeHost(withAccountAndCollections());
    const tab = newTab(host);
    const defs = tab.getSettingDefinitions() as any[];
    const collectionsGroup = defs.find((d) => d.heading === "Kalender & Adressbücher");
    expect(collectionsGroup.type).toBe("group");
    // Konto-Ebene ist eine navigierbare "page" (Obsidians SettingGroupItem-Typing erlaubt keine
    // verschachtelte Gruppe innerhalb einer Gruppe) — deren items sind wieder volle
    // SettingDefinitionItem[] und enthalten je Sammlung eine eigene Gruppe.
    const accountGroup = collectionsGroup.items.find((i: any) => i.type === "page");
    expect(accountGroup.type).toBe("page");
    // Der Seitenname nennt das Konto UND die Anzahl — ohne den Zusatz las sich der
    // Kontoname wie der Name einer einzelnen Sammlung (Erstkontakt-Befund 2026-08-29).
    expect(accountGroup.name).toBe("Home — 2 gefunden");
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

  // Die Discovery erhebt `supported-calendar-component-set` seit jeher, der Merge liess
  // den Wert aber fallen — eine reine VTODO-Collection war danach von einem gewoehnlichen
  // Kalender nicht mehr zu unterscheiden (Befund mailbox.org, 2026-08-29).
  it("discovery merge: components wird durchgereicht — bei neuen UND bei bestehenden Sammlungen", () => {
    const settings = withAccountAndCollections();
    const host = fakeHost(settings);
    const tab = newTab(host);
    const account = host.settings.accounts[0]!;
    (tab as unknown as { mergeDiscoveredCollections(a: typeof account, r: unknown): void }).mergeDiscoveredCollections(account, {
      principal: "p",
      collections: [
        { href: "https://dav.example/cal/", kind: "calendar", displayName: "Calendar", readOnly: false, components: ["VEVENT"] },
        { href: "https://dav.example/todo/", kind: "calendar", displayName: "Tasks", readOnly: false, components: ["VTODO"] },
      ],
      warnings: [],
    });
    const existing = host.settings.collections.find((c) => c.id === "c1");
    expect(existing?.components).toEqual(["VEVENT"]);
    const fresh = host.settings.collections.find((c) => c.href === "https://dav.example/todo/");
    expect(fresh?.components).toEqual(["VTODO"]);
  });

  // Liefert die Discovery die Eigenschaft diesmal nicht mit, darf ein frueher erhobener
  // Wert nicht als Wahrheit stehenbleiben — sonst bleibt eine Sammlung dauerhaft gesperrt,
  // nachdem der Server seine Angabe zurueckgezogen hat.
  it("discovery merge: fehlende components-Angabe löscht den alten Wert", () => {
    const settings = withAccountAndCollections();
    settings.collections[0]!.components = ["VTODO"];
    const host = fakeHost(settings);
    const tab = newTab(host);
    const account = host.settings.accounts[0]!;
    (tab as unknown as { mergeDiscoveredCollections(a: typeof account, r: unknown): void }).mergeDiscoveredCollections(account, {
      principal: "p",
      collections: [{ href: "https://dav.example/cal/", kind: "calendar", displayName: "Calendar", readOnly: false }],
      warnings: [],
    });
    expect(host.settings.collections.find((c) => c.id === "c1")?.components).toBeUndefined();
  });
});

/** Zeichnet die erste Konto-Zeile und liefert deren `SecretComponent`. */
/** Die Konten-Liste, unabhaengig von ihrer Position in der Definitionsliste. */
function accountList(tab: CalendarNotesSettingTab): any {
  const defs = tab.getSettingDefinitions() as any[];
  const list = defs.find((d) => d.heading === "Konten");
  expect(list).toBeDefined();
  return list;
}

function renderFirstAccountRow(tab: CalendarNotesSettingTab): SecretComponent {
  SecretComponent.instances.length = 0;
  accountList(tab).items[0].render(new Setting(makeFakeEl()));
  const component = SecretComponent.instances[0];
  expect(component).toBeDefined();
  return component!;
}

describe("Passwort-Zeile eines Kontos (SecretComponent)", () => {
  it("verweist auf die am Konto hinterlegte Secret-ID", () => {
    const host = fakeHost(withAccountAndCollections());
    const component = renderFirstAccountRow(newTab(host));
    expect(component.settingKey).toBe("calendar-notes-a1");
  });

  // Der Fehler bis 0.1.4: der Rueckruf liefert die ID des Schluesselbund-Eintrags, nicht das
  // Passwort — sie wurde als Passwort-WERT gespeichert, das Konto meldete sich also mit dem
  // NAMEN des Eintrags an. Ergebnis: 401 gegen jeden Server, auf jedem Geraet.
  it("merkt die gewaehlte Secret-ID am Konto, statt sie als Passwort zu speichern", () => {
    const host = fakeHost(withAccountAndCollections());
    const component = renderFirstAccountRow(newTab(host));

    component.choose("meine-nextcloud");

    expect(host.settings.accounts[0]!.secretId).toBe("meine-nextcloud");
    expect(host.secretWrites).toEqual([]);
    expect(host.saved.length).toBeGreaterThan(0);
  });

  it("das X loest die Verknuepfung (Rueckruf mit null), ohne zu werfen", () => {
    const host = fakeHost(withAccountAndCollections());
    const component = renderFirstAccountRow(newTab(host));

    expect(() => component.choose(null)).not.toThrow();

    expect(host.settings.accounts[0]!.secretId).toBe("");
    expect(host.secretWrites).toEqual([]);
  });

  it("beim Loeschen eines Kontos bleibt der Schluesselbund-Eintrag unangetastet", () => {
    const host = fakeHost(withAccountAndCollections());
    host.secrets.set("calendar-notes-a1", "geheim");
    host.secretWrites.length = 0;
    const tab = newTab(host);
    (tab as unknown as { update(): void }).update = () => {};
    (tab as unknown as { deleteAccount(id: string): void }).deleteAccount("a1");

    expect(host.secretWrites).toEqual([]);
    expect(host.secrets.get("calendar-notes-a1")).toBe("geheim");
  });
});
