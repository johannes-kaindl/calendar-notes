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
});
