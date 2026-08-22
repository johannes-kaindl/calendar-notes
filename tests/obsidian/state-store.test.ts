import { describe, it, expect } from "vitest";
import { adapterStateStore, MemoryStateStore } from "../../src/obsidian/state-store";
import { emptyState, type CollectionState } from "../../src/core/state/collection-state";

interface FakeAdapter {
  exists(p: string): Promise<boolean>;
  mkdir(p: string): Promise<void>;
  read(p: string): Promise<string>;
  write(p: string, data: string): Promise<void>;
  remove(p: string): Promise<void>;
}

function fakeAdapter(): FakeAdapter & { files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files, dirs,
    exists: async (p) => files.has(p) || dirs.has(p),
    mkdir: async (p) => { dirs.add(p); },
    read: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`not found: ${p}`);
      return v;
    },
    write: async (p, data) => { files.set(p, data); },
    remove: async (p) => { files.delete(p); },
  };
}

describe("adapterStateStore", () => {
  it("save/load roundtrip, path uses acc__col.json (source '/' -> '__')", async () => {
    const adapter = fakeAdapter();
    const store = adapterStateStore(adapter, "plugindir");
    const state: CollectionState = { ...emptyState("acc/col"), snapshot: { etags: { a: "1" } } };
    await store.save(state);
    expect([...adapter.files.keys()]).toEqual(["plugindir/state/acc__col.json"]);
    const loaded = await store.load("acc/col");
    expect(loaded).toEqual(state);
  });

  it("load of an unknown source returns emptyState(source)", async () => {
    const adapter = fakeAdapter();
    const store = adapterStateStore(adapter, "plugindir");
    const loaded = await store.load("acc/unknown");
    expect(loaded).toEqual(emptyState("acc/unknown"));
  });

  it("mkdir is called when the state dir is missing, then write succeeds", async () => {
    const adapter = fakeAdapter();
    const store = adapterStateStore(adapter, "plugindir");
    const state = emptyState("acc/col");
    await store.save(state);
    expect(adapter.dirs.has("plugindir/state")).toBe(true);
  });

  it("remove deletes the file", async () => {
    const adapter = fakeAdapter();
    const store = adapterStateStore(adapter, "plugindir");
    await store.save(emptyState("acc/col"));
    await store.remove("acc/col");
    expect(adapter.files.has("plugindir/state/acc__col.json")).toBe(false);
  });
});

describe("MemoryStateStore", () => {
  it("save/load/remove roundtrip", async () => {
    const store = new MemoryStateStore();
    const state = emptyState("acc/col");
    await store.save(state);
    expect(await store.load("acc/col")).toEqual(state);
    await store.remove("acc/col");
    expect(await store.load("acc/col")).toEqual(emptyState("acc/col"));
  });
});
