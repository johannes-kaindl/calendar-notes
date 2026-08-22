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
      headers: req.headers ?? {},
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
