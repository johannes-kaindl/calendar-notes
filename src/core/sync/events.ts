import type { NotePlan } from "../mirror/plan";
import type { RunInfo } from "../state/collection-state";

export type Unsubscribe = () => void;

/** Generischer, minimaler Event-Emitter — pure (`src/core/**`, `check:pure`), kein
 *  Node-`EventEmitter`-Import. `E` bindet Event-Namen an ihren Payload-Typ, damit
 *  `on`/`emit` je Event ohne Cast typsicher bleiben. */
export interface Emitter<E extends Record<string, unknown>> {
  on<K extends keyof E & string>(event: K, cb: (payload: E[K]) => void): Unsubscribe;
  emit<K extends keyof E & string>(event: K, payload: E[K]): void;
}

export function createEmitter<E extends Record<string, unknown>>(): Emitter<E> {
  const listeners = new Map<keyof E & string, Set<(payload: E[keyof E & string]) => void>>();
  return {
    on(event, cb) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(cb as (payload: E[keyof E & string]) => void);
      return () => {
        set.delete(cb as (payload: E[keyof E & string]) => void);
      };
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      // Kopie, damit ein `unsubscribe()` aus einem Callback heraus die laufende Iteration nicht stoert.
      for (const cb of [...set]) {
        // Fix-Runde 1, Punkt 1: ein werfender Listener darf den Aufrufer (SyncService,
        // executeCommandPlan) nicht stoppen — ein Fremdplugin-Callback (z. B. ueber
        // `api.on(...)`) soll den eigenen Sync-/Kommando-Lauf nicht kippen koennen. `emit()`
        // selbst bleibt synchron und ohne Rueckgabewert, ein Fehler hat also nirgends
        // hinzulaufen — verschluckt statt geworfen.
        try {
          cb(payload);
        } catch {
          /* Listener-Fehler bewusst verschluckt, s. o. */
        }
      }
    },
  };
}

/** Events, die `SyncService`/`executeCommandPlan` ueber `SyncDeps.events` feuern (Task 7,
 *  Spec §5b) — `synced` nach jedem Collection-Ergebnis (Trockenlauf inklusive), `changed`
 *  je tatsaechlich ausgefuehrtem `NotePlan` (Sync-Lauf UND Kommando-Resync). */
export interface SyncEvents extends Record<string, unknown> {
  synced: { collectionId: string; counts: RunInfo["counts"] };
  changed: { path: string; op: NotePlan["op"]; uid: string };
}

export type SyncEmitter = Emitter<SyncEvents>;
