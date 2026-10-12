// vendored from code-kit@0.24.0, src/ts/pure/busy-guard.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: calendar-notes `src/core/sync/busy.ts` (2026-08-30) and mailstone `src/core/sync/busy.ts` (a copy with a
// stamp in line 1, byte-identical otherwise — `diff` measured 2026-10-12, Welle 19). 32 lines, no imports.

/** A shared "one at a time" flag for two entry points that must not write to the same thing at once.
 *
 *  The pattern: a full run and a single command both work on the same object (calendar-notes: `SyncService` for the
 *  whole collection, `executeCommandPlan` for one command). Both hold ONE guard. Whoever calls `tryAcquire()` first
 *  wins; the other side sees `isBusy() === true` and stops with its own "busy" result instead of writing in parallel.
 *
 *  A plain shared flag is enough, **no reentrancy counter**: Obsidian is single-threaded, so `tryAcquire` and
 *  `release` never interleave within one tick. The cost of that choice: a second `release()` frees the guard no
 *  matter who holds it, so only the holder may call it — pair every winning `tryAcquire()` with exactly one
 *  `release()` in a `finally`.
 *
 *  Not a queue and not a lock with waiting: a loser gets `false` at once and decides what to do (report, retry later,
 *  drop). */
export interface BusyGuard {
  /** Takes the guard if it is free (`true`), otherwise `false` — with no side effect in the failing case. */
  tryAcquire(): boolean;
  /** Frees the guard. Idempotent: a call without a prior `tryAcquire()` is a no-op. */
  release(): void;
  /** `true` while somebody holds the guard. */
  isBusy(): boolean;
}

/** A new, free guard. Every call returns an independent one; share the returned object, not the factory. */
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
