import { describe, it, expect } from "vitest";
import { makeFakeApp, TFile } from "../vendor/kit/obsidian-mock";
import { getFrontMatterInfo } from "../__mocks__/obsidian";
import { buildNoteIndex, VaultNoteLookup, vaultPlanExecutor } from "../../src/obsidian/vault-notes";
import { defaultContactProfile } from "../../src/core/mirror/profile";
import { userContent } from "../../src/core/mirror/body";
import type { NotePlan } from "../../src/core/mirror/plan";

const p = defaultContactProfile(); // uidField dav_uid, sourceField dav_source, recurrenceIdField dav_recurrence_id

describe("buildNoteIndex", () => {
  it("indexes files with uid+source, skips one without uid, respects an override recurrenceId", () => {
    const files = [
      { path: "Contacts/A.md", frontmatter: { dav_uid: "u1", dav_source: "acc/kon" } },
      { path: "Contacts/NoUid.md", frontmatter: { dav_source: "acc/kon" } },
      { path: "Events/B.md", frontmatter: { dav_uid: "u2", dav_source: "acc/kal", dav_recurrence_id: "2026-09-03T07:00:00Z" } },
    ];
    const idx = buildNoteIndex(files, p);
    expect(idx.size).toBe(2);
    expect([...idx.values()].map((e) => e.path).sort()).toEqual(["Contacts/A.md", "Events/B.md"]);
    const master = [...idx.values()].find((e) => e.path === "Contacts/A.md");
    expect(master).toEqual({ path: "Contacts/A.md", uid: "u1", source: "acc/kon" });
    const override = [...idx.values()].find((e) => e.path === "Events/B.md");
    expect(override).toEqual({ path: "Events/B.md", uid: "u2", source: "acc/kal", recurrenceId: "2026-09-03T07:00:00Z" });
  });
});

function appWithFiles(entries: { path: string; frontmatter?: Record<string, unknown>; body?: string }[]): ReturnType<typeof makeFakeApp> {
  const app = makeFakeApp();
  const files = entries.map((e) => Object.assign(new TFile(e.path), { __body: e.body ?? "" }));
  const byPath = new Map(files.map((f, i) => [f.path, { file: f, fm: entries[i]!.frontmatter }]));
  app.vault.getMarkdownFiles.mockReturnValue(files);
  app.vault.getAbstractFileByPath.mockImplementation((path: string) => byPath.get(path)?.file ?? null);
  app.vault.cachedRead.mockImplementation((f: any) => Promise.resolve(f.__body ?? ""));
  app.metadataCache.getFileCache.mockImplementation((f: any) => {
    const hit = byPath.get(f.path);
    return hit?.fm ? { frontmatter: hit.fm } : null;
  });
  return app;
}

describe("VaultNoteLookup", () => {
  it("byUid finds an indexed note after prime()", async () => {
    const app = appWithFiles([{ path: "Contacts/A.md", frontmatter: { dav_uid: "u1", dav_source: "acc/kon" }, body: "hi" }]);
    const lookup = new VaultNoteLookup(app, p);
    await lookup.prime();
    const hit = lookup.byUid("u1", "acc/kon");
    expect(hit).toEqual({ path: "Contacts/A.md", frontmatter: { dav_uid: "u1", dav_source: "acc/kon" }, body: "hi" });
  });

  it("byPath before prime() is undefined; after prime() it resolves", async () => {
    const app = appWithFiles([{ path: "Contacts/A.md", frontmatter: { dav_uid: "u1", dav_source: "acc/kon" }, body: "hi" }]);
    const lookup = new VaultNoteLookup(app, p);
    expect(lookup.byPath("Contacts/A.md")).toBeUndefined();
    await lookup.prime();
    expect(lookup.byPath("Contacts/A.md")).toBeDefined();
  });

  it("prime(paths) also loads a state path outside the profile index", async () => {
    const app = appWithFiles([
      { path: "Contacts/A.md", frontmatter: { dav_uid: "u1", dav_source: "acc/kon" }, body: "hi" },
      { path: "Contacts/Stale.md", frontmatter: { foo: "bar" }, body: "stale" },
    ]);
    const lookup = new VaultNoteLookup(app, p);
    await lookup.prime(["Contacts/Stale.md"]);
    expect(lookup.byPath("Contacts/Stale.md")).toEqual({ path: "Contacts/Stale.md", frontmatter: { foo: "bar" }, body: "stale" });
  });

  it("exists() answers vault-wide, not from the profile index (a non-profile note at the same path counts)", () => {
    const app = appWithFiles([{ path: "Contacts/Foreign.md", frontmatter: { some: "thing" } }]);
    const lookup = new VaultNoteLookup(app, p);
    expect(lookup.exists("Contacts/Foreign.md")).toBe(true);
    expect(lookup.exists("Contacts/Nope.md")).toBe(false);
  });

  it("hasBacklinks scans metadataCache.resolvedLinks for the target path", () => {
    const app = appWithFiles([]);
    app.metadataCache.resolvedLinks = { "A.md": { "Contacts/X.md": 1 } };
    const lookup = new VaultNoteLookup(app, p);
    expect(lookup.hasBacklinks("Contacts/X.md")).toBe(true);
    expect(lookup.hasBacklinks("Contacts/Y.md")).toBe(false);
  });
});

describe("VaultNoteLookup.prime() strips frontmatter from the body (M2a-Vertrag: ExistingNote.body ist frontmatter-frei)", () => {
  it("byPath().body excludes the YAML block, keeping only the user content", async () => {
    const raw = "---\ndav_uid: u1\ndav_source: acc/kon\n---\nHello world\n";
    const app = makeFakeApp();
    const file = Object.assign(new TFile("Contacts/A.md"), { __body: raw });
    app.vault.getMarkdownFiles.mockReturnValue([file]);
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => (path === file.path ? file : null));
    app.vault.cachedRead.mockImplementation(() => Promise.resolve(raw));
    const info = getFrontMatterInfo(raw);
    app.metadataCache.getFileCache.mockImplementation(() => ({
      frontmatter: { dav_uid: "u1", dav_source: "acc/kon" },
      frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 2, col: 3, offset: info.contentStart } },
    }));
    const lookup = new VaultNoteLookup(app, p);
    await lookup.prime();
    expect(lookup.byPath("Contacts/A.md")?.body).toBe("Hello world\n");
  });

  it("without a frontmatterPosition (no cache entry), falls back to stripping the --- block via regex", async () => {
    const raw = "---\ndav_uid: u1\ndav_source: acc/kon\n---\nHello world\n";
    const app = makeFakeApp();
    const file = Object.assign(new TFile("Contacts/A.md"), { __body: raw });
    app.vault.getMarkdownFiles.mockReturnValue([file]);
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => (path === file.path ? file : null));
    app.vault.cachedRead.mockImplementation(() => Promise.resolve(raw));
    app.metadataCache.getFileCache.mockImplementation(() => ({ frontmatter: { dav_uid: "u1", dav_source: "acc/kon" } }));
    const lookup = new VaultNoteLookup(app, p);
    await lookup.prime();
    expect(lookup.byPath("Contacts/A.md")?.body).toBe("Hello world\n");
  });

  it("prime() + userContent(): a note with only a dav block and no user text yields empty user content (delete:trash bleibt erreichbar)", async () => {
    const raw = "---\ndav_uid: u1\ndav_source: acc/kon\n---\n%% dav:begin %%\nsome managed content\n%% dav:end %%\n";
    const app = makeFakeApp();
    const file = Object.assign(new TFile("Contacts/A.md"), { __body: raw });
    app.vault.getMarkdownFiles.mockReturnValue([file]);
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => (path === file.path ? file : null));
    app.vault.cachedRead.mockImplementation(() => Promise.resolve(raw));
    const info = getFrontMatterInfo(raw);
    app.metadataCache.getFileCache.mockImplementation(() => ({
      frontmatter: { dav_uid: "u1", dav_source: "acc/kon" },
      frontmatterPosition: { start: { line: 0, col: 0, offset: 0 }, end: { line: 2, col: 3, offset: info.contentStart } },
    }));
    const lookup = new VaultNoteLookup(app, p);
    await lookup.prime();
    const note = lookup.byPath("Contacts/A.md")!;
    expect(userContent(note.body)).toBe("");
  });
});

interface Call { fn: string; args: unknown[] }

/** In-memory Datei-Inhalt (String, inkl. Frontmatter), damit `processFrontMatter` UND
 *  `vault.process` gegen denselben Text arbeiten — genau die Reihenfolge, die im echten
 *  Vault auch passiert (`processFrontMatter` schreibt zuerst die YAML, `vault.process`
 *  darf sie danach nicht verlieren). */
function fileVaultApp(initialContent: Record<string, string>): { app: any; contents: Map<string, string> } {
  const contents = new Map(Object.entries(initialContent));
  const files = new Map(Object.keys(initialContent).map((path) => [path, new TFile(path)]));
  const app: any = {
    vault: {
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
      process: async (file: TFile, fn: (d: string) => string) => {
        const cur = contents.get(file.path) ?? "";
        const out = fn(cur);
        contents.set(file.path, out);
        return out;
      },
    },
    fileManager: {
      processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const cur = contents.get(file.path) ?? "";
        const info = getFrontMatterInfo(cur);
        const fm: Record<string, unknown> = {};
        if (info.exists) {
          for (const line of info.frontmatter.split("\n")) {
            const m = /^([\w.-]+):\s*(.*)$/.exec(line);
            if (m) fm[m[1]!] = m[2];
          }
        }
        fn(fm);
        const yaml = Object.entries(fm).map(([k, v]) => `${k}: ${String(v)}`).join("\n");
        const body = cur.slice(info.contentStart);
        contents.set(file.path, `---\n${yaml}\n---\n${body}`);
      },
    },
  };
  return { app, contents };
}

describe("vaultPlanExecutor update: body-only Overwrite darf die eben geschriebene Frontmatter nicht verlieren", () => {
  it("keeps the (new) frontmatter and writes the new body", async () => {
    const initial = "---\ndav_uid: u1\ndav_etag: old\n---\nold body\n";
    const { app, contents } = fileVaultApp({ "Contacts/A.md": initial });
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "update", path: "Contacts/A.md", uid: "u1", set: { dav_etag: "new" }, unset: [], body: "new body\n", written: {}, hash: "h", handEdited: [] };
    await executor.execute(plan);
    const finalText = contents.get("Contacts/A.md")!;
    expect(finalText).toContain("dav_etag: new");
    expect(finalText.endsWith("new body\n")).toBe(true);
    expect(finalText).not.toContain("old body");
  });
});

function loggingApp(opts: { existing?: Record<string, unknown> } = {}): { app: any; calls: Call[] } {
  const calls: Call[] = [];
  const folders = new Set<string>();
  const files = new Map<string, TFile>();
  for (const path of Object.keys(opts.existing ?? {})) files.set(path, new TFile(path));
  const app: any = {
    vault: {
      getFolderByPath: (p: string) => (folders.has(p) ? {} : null),
      createFolder: async (p: string) => { calls.push({ fn: "createFolder", args: [p] }); folders.add(p); },
      create: async (path: string, body: string) => { calls.push({ fn: "create", args: [path, body] }); const f = new TFile(path); files.set(path, f); return f; },
      process: async (file: TFile, fn: (d: string) => string) => { const out = fn(""); calls.push({ fn: "process", args: [file.path, out] }); return out; },
      getAbstractFileByPath: (p: string) => files.get(p) ?? null,
    },
    fileManager: {
      processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm: Record<string, unknown> = {};
        fn(fm);
        calls.push({ fn: "processFrontMatter", args: [file.path, fm] });
      },
      trashFile: async (file: TFile) => { calls.push({ fn: "trashFile", args: [file.path] }); },
    },
  };
  return { app, calls };
}

describe("vaultPlanExecutor", () => {
  it("create: ensures nested folder, creates file, sets frontmatter", async () => {
    const { app, calls } = loggingApp();
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "create", path: "Contacts/Sub/A.md", uid: "u1", frontmatter: { dav_uid: "u1" }, body: "body", written: {}, hash: "h" };
    await executor.execute(plan);
    expect(calls).toEqual([
      { fn: "createFolder", args: ["Contacts"] },
      { fn: "createFolder", args: ["Contacts/Sub"] },
      { fn: "create", args: ["Contacts/Sub/A.md", "body"] },
      { fn: "processFrontMatter", args: ["Contacts/Sub/A.md", { dav_uid: "u1" }] },
    ]);
  });

  it("update without body does not call process", async () => {
    const { app, calls } = loggingApp({ existing: { "Contacts/A.md": {} } });
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "update", path: "Contacts/A.md", uid: "u1", set: { x: "1" }, unset: ["y"], written: {}, hash: "h", handEdited: [] };
    await executor.execute(plan);
    expect(calls).toEqual([{ fn: "processFrontMatter", args: ["Contacts/A.md", { x: "1" }] }]);
  });

  it("update with body calls process after processFrontMatter", async () => {
    const { app, calls } = loggingApp({ existing: { "Contacts/A.md": {} } });
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "update", path: "Contacts/A.md", uid: "u1", set: {}, unset: [], body: "new body", written: {}, hash: "h", handEdited: [] };
    await executor.execute(plan);
    expect(calls).toEqual([
      { fn: "processFrontMatter", args: ["Contacts/A.md", {}] },
      { fn: "process", args: ["Contacts/A.md", "new body"] },
    ]);
  });

  it("archive sets frontmatter", async () => {
    const { app, calls } = loggingApp({ existing: { "Contacts/A.md": {} } });
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "archive", path: "Contacts/A.md", uid: "u1", set: { dav_state: "archived" } };
    await executor.execute(plan);
    expect(calls).toEqual([{ fn: "processFrontMatter", args: ["Contacts/A.md", { dav_state: "archived" }] }]);
  });

  it("delete:trash calls fileManager.trashFile", async () => {
    const { app, calls } = loggingApp({ existing: { "Contacts/A.md": {} } });
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "delete", path: "Contacts/A.md", uid: "u1", mode: "trash" };
    await executor.execute(plan);
    expect(calls).toEqual([{ fn: "trashFile", args: ["Contacts/A.md"] }]);
  });

  it("delete:mark sets frontmatter instead of trashing", async () => {
    const { app, calls } = loggingApp({ existing: { "Contacts/A.md": {} } });
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "delete", path: "Contacts/A.md", uid: "u1", mode: "mark", set: { dav_state: "deleted" } };
    await executor.execute(plan);
    expect(calls).toEqual([{ fn: "processFrontMatter", args: ["Contacts/A.md", { dav_state: "deleted" }] }]);
  });

  it("skip does nothing", async () => {
    const { app, calls } = loggingApp();
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "skip", path: "Contacts/A.md", uid: "u1", reason: "unchanged" };
    await executor.execute(plan);
    expect(calls).toEqual([]);
  });

  it("update on a missing file throws", async () => {
    const { app } = loggingApp();
    const executor = vaultPlanExecutor(app);
    const plan: NotePlan = { op: "update", path: "Contacts/Gone.md", uid: "u1", set: {}, unset: [], written: {}, hash: "h", handEdited: [] };
    await expect(executor.execute(plan)).rejects.toThrow("Notiz nicht gefunden: Contacts/Gone.md");
  });
});
