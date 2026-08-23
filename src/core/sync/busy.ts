/**
 * Bidirektionaler Busy-Guard, geteilt ueber `SyncDeps.busy` zwischen `SyncService`
 * (voller Collection-Lauf) und `executeCommandPlan` (Einzel-Kommando): egal wer zuerst
 * `tryAcquire()` gewinnt, die andere Seite sieht `isBusy() === true` und bricht mit ihrem
 * jeweils eigenen busy-Resultat ab, statt gleichzeitig gegen dasselbe Objekt zu schreiben.
 * Ein einfacher gemeinsamer Zustand reicht (kein Reentrancy-Zaehler noetig) — Obsidian ist
 * single-threaded, `tryAcquire`/`release` laufen nie parallel innerhalb eines Ticks.
 */
export interface BusyGuard {
  /** Belegt den Guard, wenn er frei ist (true), sonst false — ohne Seiteneffekt im Fehlfall. */
  tryAcquire(): boolean;
  /** Gibt den Guard frei. Idempotent (Aufruf ohne vorheriges `tryAcquire()` ist ein No-Op). */
  release(): void;
  isBusy(): boolean;
}

export function createBusyGuard(): BusyGuard {
  let busy = false;
  return {
    tryAcquire(): boolean {
      if (busy) return false;
      busy = true;
      return true;
    },
    release(): void {
      busy = false;
    },
    isBusy(): boolean {
      return busy;
    },
  };
}
