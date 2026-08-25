import { describe, it, expect } from "vitest";
import { defaultSettings, normalizeSettings, repairSecretLinks, secretIdFor, newId, sourceOf, effectiveProfile, DEFAULT_SYNC } from "../../src/core/settings";
import type { SecretStore } from "../../src/core/sync/types";
describe("settings", () => {
  it("defaults carry both default profiles", () => {
    const s = defaultSettings();
    expect(s.profiles.map((p) => p.id)).toEqual(["default-contact", "default-event"]);
    expect(s.sync).toEqual(DEFAULT_SYNC);
  });
  it("normalize: merges, drops invalid profile, re-adds missing defaults, drops orphan collection, clamps", () => {
    const s = normalizeSettings({ accounts: [{ id: "a1", name: "X", baseUrl: "https://d/", username: "u", secretId: "calendar-notes-a1" }],
      collections: [{ id: "c1", accountId: "a1", href: "https://d/k/", kind: "calendar", displayName: "K", enabled: true, profileId: "default-event", readOnly: false }, { id: "c2", accountId: "ghost", href: "x", kind: "calendar", displayName: "G", enabled: true, profileId: "default-event", readOnly: false }],
      profiles: [{ id: "broken" }], sync: { intervalMinutes: -5, requestTimeoutMs: 10 } });
    expect(s.collections.map((c) => c.id)).toEqual(["c1"]);
    expect(s.profiles.map((p) => p.id).sort()).toEqual(["default-contact", "default-event"]);
    expect(s.sync.intervalMinutes).toBe(0); expect(s.sync.requestTimeoutMs).toBe(1000); expect(s.sync.pastDays).toBe(90);
  });
  it("normalize: keeps well-formed account.scheduling, drops malformed", () => {
    const s = normalizeSettings({
      accounts: [
        { id: "a1", name: "X", baseUrl: "https://d/", username: "u", secretId: "calendar-notes-a1", scheduling: { outbox: "https://d/outbox/", inbox: "https://d/inbox/", addresses: ["jay@example.test"] } },
        { id: "a2", name: "Y", baseUrl: "https://d2/", username: "u", secretId: "calendar-notes-a2", scheduling: { outbox: 42, addresses: ["jay@example.test"] } },
      ],
    });
    expect(s.accounts[0]!.scheduling).toEqual({ outbox: "https://d/outbox/", inbox: "https://d/inbox/", addresses: ["jay@example.test"] });
    expect(s.accounts[1]!.scheduling).toBeUndefined();
  });
  it("normalize(undefined) == defaults; keeps a valid custom profile", () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings());
    const custom = { ...defaultSettings().profiles[0]!, id: "pallas", name: "Pallas" };
    expect(normalizeSettings({ profiles: [custom] }).profiles.map((p) => p.id)).toEqual(["pallas", "default-contact", "default-event"]);
  });
  it("helpers", () => {
    expect(secretIdFor("a1")).toBe("calendar-notes-a1");
    let i = 0; const rand = () => [0.1, 0.5, 0.9][i++ % 3]!;
    expect(newId("acc", rand)).toMatch(/^acc-[a-z0-9]{8}$/);
    const s = defaultSettings(); const c = { id: "c1", accountId: "a1", href: "h", kind: "calendar" as const, displayName: "K", enabled: true, profileId: "default-event", readOnly: false, folderOverride: "Termine/2026" };
    expect(sourceOf(c)).toBe("a1/c1");
    expect(effectiveProfile(s, c)?.folder).toBe("Termine/2026");
    expect(effectiveProfile(s, { ...c, profileId: "nope" })).toBeUndefined();
  });
});

describe("repairSecretLinks", () => {
  function store(values: Record<string, string>): SecretStore & { writes: [string, string][] } {
    const map = new Map(Object.entries(values));
    const writes: [string, string][] = [];
    return {
      writes,
      get: (id) => map.get(id) ?? null,
      set: (id, v) => { writes.push([id, v]); map.set(id, v); },
      has: (id) => (map.get(id) ?? "") !== "",
    };
  }
  function withAccounts(...accounts: { id: string; secretId: string }[]) {
    return {
      ...defaultSettings(),
      accounts: accounts.map((a) => ({ id: a.id, name: a.id, baseUrl: "https://d/", username: "u", secretId: a.secretId })),
    };
  }

  // Der Normalfall des 0.1.4-Schadens: der Nutzer hat im Dialog einen Eintrag "mailbox"
  // angelegt, dessen ID landete als WERT unter der plugin-eigenen ID. Das Passwort selbst ist
  // unbeschadet — das Konto wird darauf umgehaengt, ohne dass jemand etwas neu eingeben muss.
  it("haengt ein Konto auf den Eintrag um, dessen Namen es faelschlich als Passwort trug", () => {
    const settings = withAccounts({ id: "a1", secretId: "calendar-notes-a1" });
    const secrets = store({ "calendar-notes-a1": "mailbox", mailbox: "hunter2" });

    const out = repairSecretLinks(settings, secrets);

    expect(out.accounts[0]!.secretId).toBe("mailbox");
    expect(secrets.get("mailbox")).toBe("hunter2");
    expect(secrets.writes).toEqual([["calendar-notes-a1", ""]]);
  });

  it("loest ein Konto, dessen Eintrag die eigene ID als Wert traegt, und leert den Eintrag", () => {
    const settings = withAccounts({ id: "a1", secretId: "calendar-notes-a1" });
    const secrets = store({ "calendar-notes-a1": "calendar-notes-a1" });

    const out = repairSecretLinks(settings, secrets);

    expect(out.accounts[0]!.secretId).toBe("");
    expect(secrets.writes).toEqual([["calendar-notes-a1", ""]]);
  });

  it("laesst ein echtes Passwort und seine Verknuepfung unangetastet", () => {
    const settings = withAccounts({ id: "a1", secretId: "meine-nextcloud" });
    const secrets = store({ "meine-nextcloud": "hunter2" });

    const out = repairSecretLinks(settings, secrets);

    expect(out).toBe(settings);
    expect(secrets.writes).toEqual([]);
  });

  // Ein Passwort, das zufaellig wie eine Secret-ID aussieht, aber auf keinen Eintrag zeigt,
  // ist kein Schaden dieser Sorte — es bleibt liegen.
  it("fasst einen Wert nicht an, der auf keinen vorhandenen Eintrag zeigt", () => {
    const settings = withAccounts({ id: "a1", secretId: "calendar-notes-a1" });
    const secrets = store({ "calendar-notes-a1": "gibt-es-nicht" });

    const out = repairSecretLinks(settings, secrets);

    expect(out).toBe(settings);
    expect(secrets.writes).toEqual([]);
  });

  it("repariert nur die betroffenen Konten und fasst leere Verknuepfungen nicht an", () => {
    const settings = withAccounts({ id: "a1", secretId: "calendar-notes-a1" }, { id: "a2", secretId: "gut" }, { id: "a3", secretId: "" });
    const secrets = store({ "calendar-notes-a1": "gut", gut: "hunter2" });

    const out = repairSecretLinks(settings, secrets);

    expect(out.accounts.map((a) => a.secretId)).toEqual(["gut", "gut", ""]);
    expect(secrets.writes).toEqual([["calendar-notes-a1", ""]]);
  });

  it("ein nicht leerbarer Eintrag verhindert die Reparatur nicht", () => {
    const settings = withAccounts({ id: "a1", secretId: "calendar-notes-a1" });
    const secrets = store({ "calendar-notes-a1": "mailbox", mailbox: "hunter2" });
    secrets.set = () => { throw new Error("keychain locked"); };

    const out = repairSecretLinks(settings, secrets);

    expect(out.accounts[0]!.secretId).toBe("mailbox");
  });
});
