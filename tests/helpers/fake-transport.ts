import type { DavRequest, DavResponse, Transport } from "../../src/core/dav/types";

export interface Route {
  method?: string;
  url: string | RegExp;
  status: number;
  headers?: Record<string, string>;
  text?: string;
  capture?: (req: DavRequest) => void;
}

export function fakeTransport(routes: Route[]): Transport & { calls: DavRequest[] } {
  const calls: DavRequest[] = [];
  const t = (async (req: DavRequest): Promise<DavResponse> => {
    calls.push(req);
    for (const r of routes) {
      const urlOk = typeof r.url === "string" ? r.url === req.url : r.url.test(req.url);
      const methodOk = !r.method || r.method === req.method;
      if (urlOk && methodOk) {
        r.capture?.(req);
        return { status: r.status, headers: r.headers ?? {}, text: r.text ?? "" };
      }
    }
    return { status: 404, headers: {}, text: "" };
  }) as Transport & { calls: DavRequest[] };
  t.calls = calls;
  return t;
}
