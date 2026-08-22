import { XMLParser } from "fast-xml-parser";

export interface PropStat { status: number; props: Record<string, unknown> }
export interface MsResponse { href: string; status?: number; propstats: PropStat[]; props: Record<string, unknown> }
export interface Multistatus { responses: MsResponse[]; syncToken?: string }

const parser = new XMLParser({
  removeNSPrefix: true,          // "D:href" → "href" — Namespace-Toleranz über alle Server-Dialekte
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,          // Strings bleiben Strings ("42" ≠ 42, ETags mit Quotes bleiben)
  processEntities: true,
  htmlEntities: true,            // numerische Entities wie &#246; dekodieren (Nextcloud-Fixture)
  isArray: (name) => name === "response" || name === "propstat" || name === "href" || name === "privilege" || name === "comp",
});

function lowerKeys(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k.toLowerCase()] = v;
  return out;
}

export function statusCode(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /\b(\d{3})\b/.exec(s);
  return m ? Number(m[1]) : undefined;
}

export function textOf(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    return typeof t === "string" ? t : t === undefined ? "" : String(t);
  }
  return String(v);
}

export function hrefsOf(v: unknown): string[] {
  if (!v || typeof v !== "object") return [];
  const h = (v as Record<string, unknown>)["href"];
  if (h === undefined) return [];
  const arr = Array.isArray(h) ? h : [h];
  return arr.map((x) => textOf(x)).filter((x): x is string => typeof x === "string" && x.length > 0);
}

export function hasChild(v: unknown, name: string): boolean {
  if (!v || typeof v !== "object") return false;
  return Object.keys(v as Record<string, unknown>).some((k) => k.toLowerCase() === name.toLowerCase());
}

export function parseMultistatus(xml: string): Multistatus {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const ms = doc["multistatus"] as Record<string, unknown> | undefined;
  if (!ms || typeof ms !== "object") throw new Error("Antwort ist kein DAV:multistatus");
  const responses: MsResponse[] = [];
  const raw = (ms["response"] as unknown[] | undefined) ?? [];
  for (const r of raw) {
    const rr = r as Record<string, unknown>;
    const href = textOf(rr["href"]) ?? "";
    const propstats: PropStat[] = [];
    const merged: Record<string, unknown> = {};
    for (const ps of (rr["propstat"] as unknown[] | undefined) ?? []) {
      const p = ps as Record<string, unknown>;
      const status = statusCode(textOf(p["status"])) ?? 0;
      const props = lowerKeys((p["prop"] as Record<string, unknown> | undefined) ?? {});
      propstats.push({ status, props });
      if (status >= 200 && status < 300) Object.assign(merged, props);
    }
    responses.push({ href, status: statusCode(textOf(rr["status"])), propstats, props: merged });
  }
  const syncToken = textOf(ms["sync-token"]);
  return { responses, ...(syncToken ? { syncToken } : {}) };
}
