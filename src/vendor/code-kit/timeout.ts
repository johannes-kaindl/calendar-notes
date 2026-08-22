// vendored from code-kit@0.1.0, src/ts/pure/timeout.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Timer-Port für `withTimeout`. Strukturell erfüllt von `ClockPort` (`obsidian/clock`),
 *  von `window` selbst und von einem Fake im Test. Bewusst injiziert statt `setTimeout`
 *  direkt zu rufen: vendorierter Kit-Code wird vom Lint des Consumers erfasst, und
 *  `obsidianmd/prefer-window-timers` verlangt dort `window.setTimeout` — die Bindung an
 *  `window` gehört deshalb in die obsidian-Schicht des Consumers, nicht hierher. */
export interface TimeoutTimers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** Ergebnis von `withTimeout` — diskriminierte Union statt Sentinel-Wert, damit ein
 *  legitimer Nutzwert nie mit „abgelaufen" verwechselt werden kann. */
export type TimeoutResult<T> = { timedOut: false; value: T } | { timedOut: true };

/** Wartet auf `work`, aber höchstens `ms` Millisekunden.
 *
 *  Motivation: Obsidians `requestUrl` kennt **weder Timeout noch Abort**. Jedes Plugin, das
 *  gegen einen lokalen LLM-Endpunkt spricht, baut denselben `Promise.race`-Wrapper — und
 *  vergisst dabei leicht, den Timer zu räumen, wenn die Arbeit zuerst fertig wird. Dann läuft
 *  der Timer im Hintergrund nach (bei langen Timeouts minutenlang) und hält den Renderer wach.
 *  Diese Fassung räumt ihn in `finally`, also auch auf dem Fehlerpfad.
 *
 *  Der Timeout **bricht die Arbeit nicht ab** — `requestUrl` kann das nicht. Er begrenzt nur
 *  die Wartezeit; die laufende Anfrage läuft im Hintergrund zu Ende und ihr Ergebnis verfällt.
 *
 *  Ein Fehler aus `work` wird durchgereicht, nicht als Timeout ausgegeben — der Aufrufer soll
 *  „Server antwortete 500" von „Server antwortete gar nicht" unterscheiden können. */
export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  timers: TimeoutTimers,
): Promise<TimeoutResult<T>> {
  let id: number | undefined;
  const expiry = new Promise<TimeoutResult<T>>((resolve) => {
    id = timers.setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([
      work.then((value): TimeoutResult<T> => ({ timedOut: false, value })),
      expiry,
    ]);
  } finally {
    if (id !== undefined) timers.clearTimeout(id);
  }
}
