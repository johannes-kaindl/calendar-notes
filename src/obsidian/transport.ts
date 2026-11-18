import { requestUrl as obsidianRequestUrl, type RequestUrlParam } from "obsidian";
import type { DavRequest, DavResponse, Transport } from "../core/dav/types";
import { withTimeout, type TimeoutTimers } from "../vendor/code-kit/timeout";

// `window.setTimeout`, nicht `activeWindow`/bares `setTimeout` (`obsidianmd/prefer-window-timers`).
// Die Vitest-Umgebung ist "node" (kein `window`); tests/setup.ts stellt dafuer einen
// minimalen `window`-Shim bereit, der auf die globalen Timer delegiert.
const timers: TimeoutTimers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

/** Ein GET geht am HTTP-Cache des Wirts vorbei. `requestUrl` laeuft ueber den Netzwerk-Stack des Wirts (Chromium); Radicale
 *  liefert `Last-Modified` ohne `Cache-Control`, der Cache darf die Antwort dann heuristisch ein Zehntel der Zeit seit der
 *  letzten Aenderung frisch halten. Ein GET, das Sekundenbruchteile nach einem PUT derselben Adresse folgt, kam so mit dem alten
 *  Etag zurueck (Mikrotest GET-PUT-GET, Obsidian 1.12.4: 4 von 150 veraltet, mit `no-cache` 0 von 150); der Resync nach einem
 *  Kommando speicherte dann den alten Stand, der naechste Befehl lief in einen 412 (P11/P12-Flake). Der Server ist die Wahrheit:
 *  jedes GET fragt ihn. Eine vom Aufrufer gesetzte `Cache-Control`-Zeile bleibt unveraendert. */
function ohneCache(req: DavRequest): Record<string, string> {
  const headers = req.headers ?? {};
  if (req.method.toUpperCase() !== "GET") return headers;
  if (Object.keys(headers).some((k) => k.toLowerCase() === "cache-control")) return headers;
  return { ...headers, "Cache-Control": "no-cache" };
}

/** Transport ueber Obsidians `requestUrl` — kennt weder Timeout noch Abort, deshalb
 *  `withTimeout` (vendored) drumherum. `throw: false`, weil `Transport` Statuscodes
 *  selbst auswertet (404/207/…) statt sich auf geworfene Fehler zu verlassen. Ein
 *  Timeout oder ein geworfener Netzwerkfehler wird als `DavResponse` mit status 0
 *  gemeldet, nicht als Exception — der Aufrufer (dav/*) kennt nur `Transport`s
 *  Promise<DavResponse>-Vertrag. */
export function obsidianTransport(opts: { timeoutMs: number; request?: typeof obsidianRequestUrl }): Transport {
  const request = opts.request ?? obsidianRequestUrl;
  return async (req: DavRequest): Promise<DavResponse> => {
    const param: RequestUrlParam = {
      url: req.url,
      method: req.method,
      headers: ohneCache(req),
      throw: false,
    };
    if (req.body !== undefined) param.body = req.body;
    let work: Promise<DavResponse>;
    try {
      work = Promise.resolve(request(param)).then((res) => ({ status: res.status, headers: res.headers, text: res.text }));
    } catch (err) {
      return { status: 0, headers: {}, text: String(err instanceof Error ? err.message : err) };
    }
    try {
      const result = await withTimeout(work, opts.timeoutMs, timers);
      return result.timedOut ? { status: 0, headers: {}, text: "timeout" } : result.value;
    } catch (err) {
      return { status: 0, headers: {}, text: String(err instanceof Error ? err.message : err) };
    }
  };
}
