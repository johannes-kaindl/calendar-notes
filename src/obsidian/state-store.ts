import { emptyState, parseState, type CollectionState } from "../core/state/collection-state";
import type { StateStore } from "../core/sync/types";

export type { StateStore };

/** Minimale, strukturelle Teilmenge von Obsidians `DataAdapter` (vault.adapter) —
 *  bewusst nicht `import type { DataAdapter } from "obsidian"`, damit Tests eine
 *  schlanke Attrappe uebergeben koennen statt den vollen Obsidian-Typ zu erfuellen. */
export interface MinimalDataAdapter {
  exists(normalizedPath: string): Promise<boolean>;
  mkdir(normalizedPath: string): Promise<void>;
  read(normalizedPath: string): Promise<string>;
  write(normalizedPath: string, data: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
}

function encode(source: string): string {
  return source.replace(/\//g, "__");
}

/** StateStore ueber den Vault-Adapter — eine Datei je Collection unter
 *  `${pluginDir}/state/${source mit / -> __}.json`. `load` ist tolerant
 *  (fehlende/kaputte Datei -> `emptyState(source)`, `parseState` filtert Muell). */
export function adapterStateStore(adapter: MinimalDataAdapter, pluginDir: string): StateStore {
  const dir = `${pluginDir}/state`;
  const pathFor = (source: string) => `${dir}/${encode(source)}.json`;

  return {
    async load(source: string): Promise<CollectionState> {
      const path = pathFor(source);
      if (!(await adapter.exists(path))) return emptyState(source);
      try {
        const raw = await adapter.read(path);
        return parseState(JSON.parse(raw) as unknown, source);
      } catch {
        return emptyState(source);
      }
    },
    async save(state: CollectionState): Promise<void> {
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.write(pathFor(state.source), JSON.stringify(state));
    },
    async remove(source: string): Promise<void> {
      const path = pathFor(source);
      if (await adapter.exists(path)) await adapter.remove(path);
    },
  };
}

/** In-Memory-Fallback fuer Tests. */
export class MemoryStateStore implements StateStore {
  private readonly states = new Map<string, CollectionState>();

  async load(source: string): Promise<CollectionState> {
    return this.states.get(source) ?? emptyState(source);
  }

  async save(state: CollectionState): Promise<void> {
    this.states.set(state.source, state);
  }

  async remove(source: string): Promise<void> {
    this.states.delete(source);
  }
}
