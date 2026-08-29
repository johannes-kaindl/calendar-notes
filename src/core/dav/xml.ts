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
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (typeof v === "object") {
    const t = (v as Record<string, unknown>)["#text"];
    return t === undefined ? "" : (textOf(t) ?? "");
  }
  return undefined;
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
  return Object.keys(v).some((k) => k.toLowerCase() === name.toLowerCase());
}

/** Beschreibt einen Antwortkoerper so, dass man ihn wiedererkennt, ohne ihn zu drucken:
 *  Laenge plus der Anfang mit zusammengefalteten Leerraeumen. Ein leerer Koerper und eine
 *  HTML-Fehlerseite sehen in der Meldung dann verschieden aus — vorher sahen beide gleich aus. */
function beschreibeKoerper(xml: string): string {
  if (xml === "") return "der Koerper ist leer";
  const anfang = xml.replace(/\s+/g, " ").trim().slice(0, 160);
  return `${xml.length} Zeichen, beginnt mit: ${anfang}`;
}

/** `quelle` nennt die Anfrage, deren Antwort geparst wird (Methode + URL). Ohne sie ist die
 *  Meldung nicht diagnostizierbar: `parseMultistatus` wird an sieben Stellen gerufen, und
 *  welche davon gescheitert ist, stand nirgends. Gemessen 2026-08-29 an mailbox.org — der
 *  Fehler trat auf, und weder Anfrage noch Antwort waren aus der Meldung ableitbar. */
export function parseMultistatus(xml: string, quelle?: string): Multistatus {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const roh = doc["multistatus"];
  // NUR ein fehlender Wurzelknoten ist ein Fehler. Ein LEERER ist die regulaere Antwort auf
  // eine leere Sammlung, und ein selbstschliessendes `<D:multistatus …/>` kommt aus
  // fast-xml-parser als leerer STRING zurueck, nicht als Objekt — die alte Pruefung `!ms`
  // hielt genau das fuer "kein Multistatus". Wirkung: jeder leere Kalender und jedes frisch
  // angelegte Adressbuch brach den Abgleich mit einer Protokoll-Fehlermeldung ab.
  // Gemessen 2026-08-29 an mailbox.org (dessen Kalender vor dem Datenumzug leer waren).
  if (roh === undefined) {
    const wo = quelle === undefined ? "" : ` auf ${quelle}`;
    throw new Error(`Antwort${wo} ist kein DAV:multistatus (${beschreibeKoerper(xml)})`);
  }
  const ms: Record<string, unknown> = roh !== null && typeof roh === "object" ? (roh as Record<string, unknown>) : {};
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
