// Globaler vitest-Setup.
//
// uebernommen (Muster) aus apple-health/tests/setup.ts, 2026-08-22: `environment: "node"`
// (vitest.config.ts) kennt kein `window`. In Obsidian gibt es eines, und
// `obsidianmd/prefer-window-timers` verlangt ausdruecklich, Timer darueber zu setzen
// (ein Popout-Fenster zeigt sonst auf das falsche Fenster). Ohne diesen Shim ist jeder
// Plugin-Pfad mit einem Timer (hier: src/obsidian/transport.ts) in Node nicht lauffaehig.
if (!("window" in globalThis)) {
  (globalThis as Record<string, unknown>).window = {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id?: number) => { clearTimeout(id); },
    setInterval: (fn: () => void, ms?: number) => setInterval(fn, ms),
    clearInterval: (id?: number) => { clearInterval(id); },
  };
}
