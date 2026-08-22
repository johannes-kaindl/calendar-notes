import { TFile, getFrontMatterInfo, type App } from "obsidian";
import type { ExistingNote, NotePlan } from "../core/mirror/plan";
import type { NoteLookup } from "../core/mirror/apply";
import type { MappingProfile } from "../core/mirror/profile";
import type { PlanExecutor } from "../core/sync/types";
import { vaultDirname } from "../vendor/kit/vault-path";

export type { PlanExecutor };

export interface NoteIndexEntry { path: string; uid: string; source: string; recurrenceId?: string }

function indexKey(source: string, uid: string, recurrenceId?: string): string {
  return JSON.stringify([source, uid, recurrenceId ?? ""]);
}

/** Pure Helfer: baut den Uid/Source/RecurrenceId → Pfad-Index aus einer Liste von
 *  (bereits aus dem Vault gelesenen) Datei-Frontmatter-Paaren. Dateien ohne uid/source
 *  im Profil-Feld werden übersprungen (gehören nicht zu diesem Profil). */
export function buildNoteIndex(
  files: { path: string; frontmatter?: Record<string, unknown> }[],
  profile: MappingProfile,
): Map<string, NoteIndexEntry> {
  const index = new Map<string, NoteIndexEntry>();
  for (const f of files) {
    const fm = f.frontmatter;
    if (!fm) continue;
    const uidVal = fm[profile.uidField];
    const sourceVal = fm[profile.sourceField];
    if (typeof uidVal !== "string" || uidVal.length === 0) continue;
    if (typeof sourceVal !== "string" || sourceVal.length === 0) continue;
    const ridVal = fm[profile.recurrenceIdField];
    const recurrenceId = typeof ridVal === "string" && ridVal.length > 0 ? ridVal : undefined;
    const entry: NoteIndexEntry = { path: f.path, uid: uidVal, source: sourceVal, ...(recurrenceId ? { recurrenceId } : {}) };
    index.set(indexKey(sourceVal, uidVal, recurrenceId), entry);
  }
  return index;
}

/** NoteLookup ueber den Vault: `NoteLookup` (M2a) ist synchron, `app.vault.cachedRead`
 *  ist es nicht — deshalb cached diese Klasse Koerper ueber `prime()`, das der Aufrufer
 *  (SyncService) vor `applyDelta` aufruft. `byPath` fuer einen nicht geprimten Pfad
 *  liefert bewusst `undefined` statt selbst nachzuladen — `applyDelta` meldet das dann
 *  als Fehler, das ist der gewuenschte Ausfall statt eines stillen Ueberspringens. */
export class VaultNoteLookup implements NoteLookup {
  private index: Map<string, NoteIndexEntry> | undefined;
  private readonly primed = new Map<string, ExistingNote>();

  constructor(private readonly app: App, private readonly profile: MappingProfile) {}

  private ensureIndex(): Map<string, NoteIndexEntry> {
    if (!this.index) {
      const files = this.app.vault.getMarkdownFiles().map((f: TFile) => ({
        path: f.path,
        frontmatter: this.app.metadataCache.getFileCache(f)?.frontmatter,
      }));
      this.index = buildNoteIndex(files, this.profile);
    }
    return this.index;
  }

  /** Laedt Frontmatter+Koerper fuer alle Index-Treffer des Profils UND fuer die
   *  uebergebenen zusaetzlichen Pfade (State-Pfade, die evtl. nicht mehr im Index
   *  auftauchen — etwa nach einem manuellen Frontmatter-Edit). Ein Pfad ohne
   *  entsprechende Datei im Vault bleibt unprimed. */
  async prime(paths?: string[]): Promise<void> {
    const idx = this.ensureIndex();
    const targets = new Set<string>([...idx.values()].map((e) => e.path));
    for (const p of paths ?? []) targets.add(p);
    for (const path of targets) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter ?? {};
      const raw = await this.app.vault.cachedRead(file);
      const body = stripFrontmatter(raw, cache?.frontmatterPosition?.end.offset);
      this.primed.set(path, { path, frontmatter, body });
    }
  }

  byUid(uid: string, source: string, recurrenceId?: string): ExistingNote | undefined {
    const entry = this.ensureIndex().get(indexKey(source, uid, recurrenceId));
    return entry ? this.primed.get(entry.path) : undefined;
  }

  byPath(path: string): ExistingNote | undefined {
    return this.primed.get(path);
  }

  /** Vaultweit, NICHT aus dem Profil-Index: eine Nicht-Profil-Notiz am selben Pfad
   *  muss als "belegt" gelten, sonst ueberschreibt die Kollisions-Suffixierung
   *  (`freePath` in core/mirror/apply.ts) eine fremde Notiz. */
  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) != null;
  }

  hasBacklinks(path: string): boolean {
    const resolved = this.app.metadataCache.resolvedLinks as Record<string, Record<string, number>> | undefined;
    for (const targets of Object.values(resolved ?? {})) {
      if (Object.hasOwn(targets, path)) return true;
    }
    return false;
  }
}

async function ensureFolder(app: App, dir: string): Promise<void> {
  if (!dir) return;
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part;
    if (app.vault.getFolderByPath(cur)) continue;
    try {
      await app.vault.createFolder(cur);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes("already exists")) throw e;
    }
  }
}

// Matches "---\n<block>\n---\n" at the very start of a document — dieselbe Form wie
// DELIM_RE in vendor/kit/frontmatter.ts (Fallback, wenn metadataCache keinen Eintrag hat).
const FM_DELIM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/** Koerper ohne YAML-Frontmatter fuer den M2a-Mirror-Vertrag (`ExistingNote.body`,
 *  `src/core/mirror/plan.ts`/`body.ts` rechnen NIE mit Frontmatter im Body). Bevorzugt
 *  `metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset` (Obsidians eigene
 *  Positionsangabe); ohne Cache-Eintrag Fallback per Regex. */
export function stripFrontmatter(raw: string, end: number | undefined): string {
  if (end !== undefined) return raw.slice(end).replace(/^\r?\n/, "");
  const m = FM_DELIM_RE.exec(raw);
  return m ? raw.slice(m[0].length) : raw;
}

function fileAt(app: App, path: string): TFile {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`Notiz nicht gefunden: ${path}`);
  return f;
}

/** Fuehrt einen `NotePlan` gegen den Vault aus. `create`/`update`/`archive`/`delete:mark`
 *  gehen ueber `processFrontMatter` (Obsidians eigener atomarer Frontmatter-Schreibpfad),
 *  `delete:trash` ueber `fileManager.trashFile`. `skip` tut nichts. */
export function vaultPlanExecutor(app: App): PlanExecutor {
  return {
    async execute(plan: NotePlan): Promise<void> {
      switch (plan.op) {
        case "create": {
          await ensureFolder(app, vaultDirname(plan.path));
          const file = await app.vault.create(plan.path, plan.body);
          await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            Object.assign(fm, plan.frontmatter);
          });
          return;
        }
        case "update": {
          const file = fileAt(app, plan.path);
          await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(plan.set)) fm[k] = v;
            for (const k of plan.unset) delete fm[k];
          });
          if (plan.body !== undefined) {
            const body = plan.body;
            // `body` (M2a-Vertrag) traegt NIE Frontmatter — die YAML-Zeilen des Ziel-Textes
            // (frisch geschrieben von `processFrontMatter` oben) muessen erhalten bleiben,
            // sonst ueberschreibt dieser Call sie stumm.
            await app.vault.process(file, (data) => data.slice(0, getFrontMatterInfo(data).contentStart) + body);
          }
          return;
        }
        case "archive": {
          const file = fileAt(app, plan.path);
          await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(plan.set)) fm[k] = v;
          });
          return;
        }
        case "delete": {
          const file = fileAt(app, plan.path);
          if (plan.mode === "trash") {
            await app.fileManager.trashFile(file);
            return;
          }
          await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(plan.set ?? {})) fm[k] = v;
          });
          return;
        }
        case "skip":
          return;
      }
    },
  };
}
