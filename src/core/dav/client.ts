import { DavError, type DavObject, type Transport } from "./types";
import { headerValue } from "./transport";

export type PutResult =
  | { ok: true; etag: string | null }
  | { ok: false; conflict: true; status: 412 }
  | { ok: false; conflict: false; status: number; message: string };

export async function getObject(t: Transport, href: string): Promise<DavObject> {
  const res = await t({ method: "GET", url: href });
  if (res.status !== 200) throw new DavError(res.status, `GET ${href} → ${res.status}`, href);
  return { href, etag: headerValue(res.headers, "etag") ?? "", data: res.text };
}

export async function headEtag(t: Transport, href: string): Promise<string | undefined> {
  const res = await t({ method: "GET", url: href });
  return res.status === 200 ? headerValue(res.headers, "etag") : undefined;
}

function toResult(status: number, headers: Record<string, string>, text: string, okStatuses: number[]): PutResult {
  if (okStatuses.includes(status)) return { ok: true, etag: headerValue(headers, "etag") ?? null };
  if (status === 412) return { ok: false, conflict: true, status: 412 };
  return { ok: false, conflict: false, status, message: text.slice(0, 200) || `HTTP ${status}` };
}

export async function putObject(
  t: Transport, href: string, data: string,
  opts: { ifMatch: string } | { ifNoneMatch: true },
  contentType: "text/calendar" | "text/vcard",
): Promise<PutResult> {
  const headers: Record<string, string> = { "Content-Type": `${contentType}; charset=utf-8` };
  if ("ifMatch" in opts) headers["If-Match"] = opts.ifMatch; else headers["If-None-Match"] = "*";
  const res = await t({ method: "PUT", url: href, headers, body: data });
  return toResult(res.status, res.headers, res.text, [200, 201, 204]);
}

export async function deleteObject(t: Transport, href: string, ifMatch: string): Promise<PutResult> {
  const res = await t({ method: "DELETE", url: href, headers: { "If-Match": ifMatch } });
  return toResult(res.status, res.headers, res.text, [200, 204, 404]);
}
