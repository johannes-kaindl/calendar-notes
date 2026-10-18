// vendored from obsidian-kit@0.63.0, src/testing/window-timers.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Timer-Shim für node-Tests von Code, der `window.setTimeout` ruft (Community-Store-Regel
// `prefer-window-timers`). Zero external imports, wie `obsidian-mock.ts` — eine Datei, die ein Consumer
// nach `tests/vendor/kit/` vendort.
//
// Warum es ihn gibt: in `environment: "node"` gibt es kein `window`. Ein Timer in einem `.then()` läuft erst
// nach dem Test; fehlt `window`, kippt das als unbehandelte Promise-Ablehnung, und ob der Lauf dadurch rot
// wird, entscheidet ein Rennen gegen das Prozessende (health-vitals 0.4.0 und 0.4.1: lokal grün, im CI rot).
// Ein Stub je betroffener Testdatei behebt immer nur den nächsten Fundort; der Shim steht einmal im Setup.
//
// Herkunft: health-vitals `tests/setup.ts:15-22` (nur gelesen), erweitert um `full` und die Rückgabe.

/** Setzt `globalThis.window`, wenn es keines gibt, und liefert die Funktion, die den Vorzustand herstellt.
 *  Ohne `full` trägt `window` nur die vier Timer, jeden **per Aufruf** an `globalThis` delegiert — die
 *  Delegation greift deshalb auch auf die Variante, die ein späteres `vi.useFakeTimers()` einsetzt. Mit
 *  `full: true` ist `window` das globale Objekt selbst (für Code, der mehr von `window` liest). Gibt es schon
 *  ein `window` (happy-dom, jsdom), geschieht nichts und die Rückgabe ist ein No-op. */
export function installWindowTimers(opts?: { full?: boolean }): () => void {
  const g = globalThis as Record<string, unknown>;
  if ("window" in g) return () => {};
  g.window = opts?.full
    ? globalThis
    : {
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
      clearTimeout: (id?: ReturnType<typeof setTimeout>) => { clearTimeout(id); },
      setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms),
      clearInterval: (id?: ReturnType<typeof setInterval>) => { clearInterval(id); },
    };
  return () => { delete g.window; };
}
