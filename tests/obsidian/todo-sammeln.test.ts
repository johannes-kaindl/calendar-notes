import { describe, it, expect } from "vitest";
import { TFile, type App } from "obsidian";
import { CommandFlow } from "../../src/obsidian/command-flow";
import { defaultTodoProfile } from "../../src/core/mirror/profile";
import type { PluginSettings } from "../../src/core/settings";
import type { CollectionState } from "../../src/core/state/collection-state";
import type { TodoNoteState } from "../../src/core/sync/todo-collect";
import type { SyncDeps } from "../../src/core/sync/types";

function datei(path: string): TFile {
  const f = new TFile();
  (f as unknown as { path: string }).path = path;
  return f;
}

/** Vault mit den genannten Notizen; `frontmatter` je Pfad. */
function fakeApp(fm: Record<string, Record<string, unknown>>): App {
  const dateien = Object.keys(fm).map(datei);
  return {
    vault: {
      getMarkdownFiles: () => dateien,
      getAbstractFileByPath: (p: string) => dateien.find((f) => f.path === p) ?? null,
    },
    metadataCache: { getFileCache: (f: TFile) => ({ frontmatter: fm[f.path] ?? {} }) },
  } as unknown as App;
}

function leererState(source: string): CollectionState {
  return { version: 1, source, snapshot: {}, objects: {} } as unknown as CollectionState;
}

/** Zwei Sammlungen am SELBEN Aufgaben-Profil — also am selben Ordner. */
function settings(): PluginSettings {
  const col = (id: string) => ({
    id, accountId: "a1", href: `https://dav.example/${id}/`, kind: "calendar" as const,
    displayName: id, enabled: true, profileId: "default-todo", readOnly: false,
  });
  return {
    accounts: [{ id: "a1", secretId: "s1" }],
    collections: [col("c1"), col("c2")],
    profiles: [defaultTodoProfile()],
  } as unknown as PluginSettings;
}

function flowMit(app: App, states: Record<string, CollectionState>): CommandFlow {
  const deps = {
    settings: () => settings(),
    stateStore: { load: (source: string) => Promise.resolve(states[source] ?? leererState(source)) },
    now: () => new Date("2026-09-05T10:00:00Z"),
  } as unknown as SyncDeps;
  return new CommandFlow(app, deps, {} as never);
}

function sammle(flow: CommandFlow, s: PluginSettings): Promise<TodoNoteState[]> {
  return (flow as unknown as { sammleTodoNotizen(s: PluginSettings): Promise<TodoNoteState[]> }).sammleTodoNotizen(s);
}

describe("sammleTodoNotizen", () => {
  it("nimmt eine neue Notiz genau EINMAL auf, auch bei zwei Sammlungen im selben Ordner", async () => {
    // Der Fall, an dem eine Schleife pro Sammlung ueber den Ordner scheitert: sie findet
    // dieselbe neue Notiz zweimal und legt sie auf dem Server doppelt an.
    const app = fakeApp({ "Tasks/Neu.md": { title: "Neu" } });
    const out = await sammle(flowMit(app, {}), settings());
    expect(out.filter((n) => n.path === "Tasks/Neu.md")).toHaveLength(1);
    expect(out[0]?.uid).toBeUndefined();
  });

  it("haelt eine gespiegelte Notiz NICHT fuer neu, auch wenn ihre Sammlung erst spaeter drankommt", async () => {
    // Die Reihenfolge-Falle: A gehoert zu c2, der Ordner wird aber schon fuer c1 durchsucht.
    // Ohne vorgezogene State-Runde entstuende fuer A ein Anlege-Plan neben ihrem Spiegel.
    const app = fakeApp({ "Tasks/A.md": {} }); // bewusst OHNE dav_uid im Frontmatter
    const state = {
      version: 1, source: "a1/c2", snapshot: {},
      objects: { "/c2/a.ics": { uid: "u-a", etag: '"e1"', raw: "", notes: { "": { path: "Tasks/A.md", written: { title: "A" } } }, history: [] } },
    } as unknown as CollectionState;
    const out = await sammle(flowMit(app, { "a1/c2": state }), settings());
    expect(out).toHaveLength(1);
    expect(out[0]?.uid).toBe("u-a");
    expect(out[0]?.href).toBe("/c2/a.ics"); // href-Pfad, nicht die volle URL
  });

  it("laesst eine Notiz aus, die eine dav_uid traegt, aber im State fehlt", async () => {
    // Sie gehoert einem State, den dieser Lauf nicht sieht — sie hier als "neu" zu senden,
    // legte ein zweites Serverobjekt zur selben Aufgabe an.
    const app = fakeApp({ "Tasks/Fremd.md": { dav_uid: "u-fremd" } });
    expect(await sammle(flowMit(app, {}), settings())).toEqual([]);
  });

  it("uebergeht Notizen ausserhalb des Profilordners", async () => {
    const app = fakeApp({ "Sonstiges/X.md": { title: "X" } });
    expect(await sammle(flowMit(app, {}), settings())).toEqual([]);
  });
});
