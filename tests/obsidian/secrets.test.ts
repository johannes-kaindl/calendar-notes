import { describe, it, expect } from "vitest";
import { obsidianSecretStore, MemorySecretStore } from "../../src/obsidian/secrets";
import type { App } from "obsidian";

function fakeApp(opts?: { setSecret?: (id: string, v: string) => void }): App {
  const store = new Map<string, string>();
  return {
    secretStorage: {
      getSecret: (id: string) => store.get(id) ?? null,
      setSecret: (id: string, v: string) => {
        if (opts?.setSecret) opts.setSecret(id, v);
        else store.set(id, v);
      },
      listSecrets: () => [...store.keys()],
    },
  } as unknown as App;
}

describe("MemorySecretStore", () => {
  it("set/get/has roundtrip", () => {
    const s = new MemorySecretStore();
    expect(s.has("a")).toBe(false);
    expect(s.get("a")).toBeNull();
    s.set("a", "geheim");
    expect(s.has("a")).toBe(true);
    expect(s.get("a")).toBe("geheim");
  });

  it("an empty secret counts as missing (has() is false)", () => {
    const s = new MemorySecretStore();
    s.set("a", "");
    expect(s.has("a")).toBe(false);
    expect(s.get("a")).toBe("");
  });
});

describe("obsidianSecretStore", () => {
  it("get/set/has go through app.secretStorage", () => {
    const app = fakeApp();
    const s = obsidianSecretStore(app);
    expect(s.has("id1")).toBe(false);
    s.set("id1", "geheim");
    expect(s.has("id1")).toBe(true);
    expect(s.get("id1")).toBe("geheim");
  });

  it("set throws when the read-back does not match (TaskNotes-Kniff)", () => {
    const app = fakeApp({ setSecret: () => {} }); // schluckt den Wert stillschweigend
    const s = obsidianSecretStore(app);
    expect(() => s.set("id1", "geheim")).toThrow("Obsidian SecretStorage did not persist id1");
  });

  it("an empty secret counts as missing (has() is false)", () => {
    const app = fakeApp();
    const s = obsidianSecretStore(app);
    s.set("id1", "");
    expect(s.has("id1")).toBe(false);
    expect(s.get("id1")).toBe("");
  });
});
