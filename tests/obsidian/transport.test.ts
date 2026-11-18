import { describe, it, expect, vi } from "vitest";
import { obsidianTransport } from "../../src/obsidian/transport";
import type { RequestUrlParam, RequestUrlResponse, requestUrl as RequestUrlFn } from "obsidian";

/** Attrappe für `typeof requestUrl` — echte requestUrl liefert eine Promise mit
 *  angehängten arrayBuffer/json/text-Promises; der Fake braucht die Form nicht,
 *  nur `await`-Kompatibilität. Der Cast ist bewusst: der Task-3-Vertrag verlangt
 *  `request?: typeof requestUrl`, Tests injizieren aber eine schlanke Attrappe. */
function fakeRequestUrl(impl: (opts: RequestUrlParam) => Promise<RequestUrlResponse>): typeof RequestUrlFn {
  return vi.fn(impl) as unknown as typeof RequestUrlFn;
}

describe("obsidianTransport", () => {
  it("maps a resolved requestUrl response through to DavResponse and passes throw:false", async () => {
    let captured: RequestUrlParam | undefined;
    const request = fakeRequestUrl(async (opts) => {
      captured = opts;
      return { status: 207, headers: { etag: '"1"' }, text: "x", json: {}, arrayBuffer: new ArrayBuffer(0) };
    });
    const t = obsidianTransport({ timeoutMs: 1000, request });
    const res = await t({ method: "PROPFIND", url: "https://d/a/", headers: { Depth: "0" }, body: "<xml/>" });
    expect(res).toEqual({ status: 207, headers: { etag: '"1"' }, text: "x" });
    expect(captured?.method).toBe("PROPFIND");
    expect(captured?.url).toBe("https://d/a/");
    expect(captured?.body).toBe("<xml/>");
    expect(captured?.headers).toEqual({ Depth: "0" });
    expect(captured?.throw).toBe(false);
  });

  it("returns status 0 / text 'timeout' when the request never resolves within timeoutMs", async () => {
    const request = fakeRequestUrl(() => new Promise<RequestUrlResponse>(() => {}));
    const t = obsidianTransport({ timeoutMs: 20, request });
    const res = await t({ method: "GET", url: "https://d/a/" });
    expect(res).toEqual({ status: 0, headers: {}, text: "timeout" });
  });

  it("returns status 0 with the error message when the request throws", async () => {
    const request = fakeRequestUrl(async () => {
      throw new Error("network down");
    });
    const t = obsidianTransport({ timeoutMs: 1000, request });
    const res = await t({ method: "GET", url: "https://d/a/" });
    expect(res).toEqual({ status: 0, headers: {}, text: "network down" });
  });

  // Befund Welle 36 (Mikrotest GET-PUT-GET, Obsidian 1.12.4): ein GET kurz nach einem PUT derselben Adresse kam in 15 von 600 Faellen (zwei Laeufe) aus dem
  // HTTP-Cache des Wirts (gleicher `Date`-Header, altes Etag); mit `Cache-Control: no-cache` 0 von 600. Der Resync nach einem Kommando
  // speicherte dann das alte Etag (P11/P12-Flake).
  describe("GET geht am HTTP-Cache des Wirts vorbei", () => {
    async function sent(req: { method: string; headers?: Record<string, string> }): Promise<Record<string, string> | undefined> {
      let captured: RequestUrlParam | undefined;
      const request = fakeRequestUrl(async (opts) => {
        captured = opts;
        return { status: 200, headers: {}, text: "", json: {}, arrayBuffer: new ArrayBuffer(0) };
      });
      await obsidianTransport({ timeoutMs: 1000, request })({ url: "https://d/a.ics", ...req });
      return captured?.headers;
    }

    it("GET bekommt Cache-Control: no-cache", async () => {
      expect(await sent({ method: "GET" })).toEqual({ "Cache-Control": "no-cache" });
    });

    it("bestehende Kopfzeilen bleiben erhalten", async () => {
      expect(await sent({ method: "GET", headers: { Accept: "text/calendar" } })).toEqual({ Accept: "text/calendar", "Cache-Control": "no-cache" });
    });

    it("eine vom Aufrufer gesetzte Cache-Control-Zeile (auch klein geschrieben) bleibt unveraendert", async () => {
      expect(await sent({ method: "GET", headers: { "cache-control": "max-age=0" } })).toEqual({ "cache-control": "max-age=0" });
    });

    it.each(["PUT", "DELETE", "PROPFIND", "REPORT"])("%s bleibt unveraendert (nur GET wird gecacht)", async (method) => {
      expect(await sent({ method, headers: { Depth: "0" } })).toEqual({ Depth: "0" });
    });
  });
});
