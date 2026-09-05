import { DavError, type DavCollection, type DavObject, type Transport } from "./types";
import { parseMultistatus, textOf, hasChild, type MsResponse } from "./xml";
import { syncCollectionBody, calendarMultigetBody, addressbookMultigetBody, propfindBody, calendarQueryBody } from "./requests";
import { resolveHref, hrefPath } from "./url";

export interface SyncSnapshot { syncToken?: string; ctag?: string; etags: Record<string, string> }
export interface SyncDelta { changed: DavObject[]; deleted: string[]; outOfWindow: string[]; snapshot: SyncSnapshot; strategy: "sync-collection" | "etag-diff"; unchanged: boolean }
export interface SyncOptions { timeRange?: { start: string; end: string }; batchSize?: number }

const XML = { "Content-Type": "application/xml; charset=utf-8" };

function etagOf(r: MsResponse): string | undefined { return textOf(r.props["getetag"]); }
function isCollectionResponse(r: MsResponse): boolean { return hasChild(r.props["resourcetype"], "collection"); }

export async function multiget(t: Transport, col: DavCollection, hrefs: string[], batchSize = 50): Promise<DavObject[]> {
  const out: DavObject[] = [];
  for (let i = 0; i < hrefs.length; i += batchSize) {
    const batch = hrefs.slice(i, i + batchSize).map((h) => hrefPath(h));
    const body = col.kind === "calendar" ? calendarMultigetBody(batch) : addressbookMultigetBody(batch);
    const res = await t({ method: "REPORT", url: col.href, headers: { Depth: "0", ...XML }, body });
    if (res.status !== 207) throw new DavError(res.status, `multiget ${col.href} → ${res.status}`, col.href);
    for (const r of parseMultistatus(res.text, `REPORT multiget ${col.href}`).responses) {
      const data = textOf(r.props["calendar-data"]) ?? textOf(r.props["address-data"]);
      const etag = etagOf(r);
      if (data && etag) out.push({ href: resolveHref(col.href, r.href), etag, data });
    }
  }
  return out;
}

/**
 * Die ETags einer Sammlung, verschluesselt auf **href-Pfade** (nicht volle URLs).
 *
 * Exportiert seit M6b: der Aufgaben-Abgleich braucht den Serverstand, ohne die Rohdaten zu
 * holen — ein Request je Sammlung statt einer je Notiz. Wer die Karte benutzt, muss seine
 * eigenen href-Werte durch dieselbe Normalisierung schicken (`hrefPath(resolveHref(...))`),
 * sonst trifft kein Schluessel und alles sieht nach Konflikt aus.
 */
export async function listEtags(t: Transport, col: DavCollection, opts: SyncOptions): Promise<Record<string, string>> {
  let res;
  if (col.kind === "calendar" && opts.timeRange) {
    res = await t({ method: "REPORT", url: col.href, headers: { Depth: "1", ...XML }, body: calendarQueryBody(opts.timeRange) });
  } else {
    res = await t({ method: "PROPFIND", url: col.href, headers: { Depth: "1", ...XML }, body: propfindBody(["d:getetag", "d:resourcetype"]) });
  }
  if (res.status !== 207) throw new DavError(res.status, `Listing ${col.href} → ${res.status}`, col.href);
  const etags: Record<string, string> = {};
  for (const r of parseMultistatus(res.text, `PROPFIND Listing ${col.href}`).responses) {
    if (isCollectionResponse(r)) continue;
    const e = etagOf(r);
    if (e) etags[hrefPath(resolveHref(col.href, r.href))] = e;
  }
  return etags;
}

async function viaSyncCollection(t: Transport, col: DavCollection, prev: SyncSnapshot | undefined, opts: SyncOptions): Promise<SyncDelta | undefined> {
  const res = await t({ method: "REPORT", url: col.href, headers: { Depth: "0", ...XML }, body: syncCollectionBody(prev?.syncToken) });
  if (res.status === 403 || res.status === 507 || res.status === 400) return undefined;    // Token ungültig/abgelaufen → Fallback
  if (res.status !== 207) throw new DavError(res.status, `sync-collection ${col.href} → ${res.status}`, col.href);
  const ms = parseMultistatus(res.text, `REPORT sync-collection ${col.href}`);
  const etags: Record<string, string> = { ...(prev?.etags ?? {}) };
  const toFetch: string[] = [];
  const deleted: string[] = [];
  for (const r of ms.responses) {
    const abs = resolveHref(col.href, r.href);
    const path = hrefPath(abs);
    if (r.status === 404) { if (path in etags) { delete etags[path]; deleted.push(abs); } continue; }
    if (isCollectionResponse(r) || path === hrefPath(col.href)) continue;
    const e = etagOf(r);
    if (!e) continue;
    if (etags[path] !== e) { etags[path] = e; toFetch.push(abs); }
  }
  const changed = toFetch.length ? await multiget(t, col, toFetch, opts.batchSize) : [];
  const snapshot: SyncSnapshot = { etags };
  if (ms.syncToken) snapshot.syncToken = ms.syncToken; else if (prev?.syncToken) snapshot.syncToken = prev.syncToken;
  if (col.ctag) snapshot.ctag = col.ctag;
  return { changed, deleted, outOfWindow: [], snapshot, strategy: "sync-collection", unchanged: changed.length === 0 && deleted.length === 0 };
}

async function viaEtagDiff(t: Transport, col: DavCollection, prev: SyncSnapshot | undefined, opts: SyncOptions): Promise<SyncDelta> {
  if (col.ctag && prev?.ctag === col.ctag) {
    return { changed: [], deleted: [], outOfWindow: [], snapshot: { ...prev, etags: { ...prev.etags } }, strategy: "etag-diff", unchanged: true };
  }
  const current = await listEtags(t, col, opts);
  const prevEtags = prev?.etags ?? {};
  const toFetch = Object.entries(current).filter(([p, e]) => prevEtags[p] !== e).map(([p]) => resolveHref(col.href, p));
  const missing = Object.keys(prevEtags).filter((p) => !(p in current)).map((p) => resolveHref(col.href, p));
  // Bei aktivem timeRange listet listEtags nur das Fenster: Objekte, die dadurch fehlen, sind nicht
  // zwangsläufig gelöscht — sie können außerhalb des Fensters liegen. Ohne timeRange ist die Listung
  // vollständig, "fehlt" bedeutet dort wirklich "gelöscht".
  const deleted = opts.timeRange ? [] : missing;
  const outOfWindow = opts.timeRange ? missing : [];
  const changed = toFetch.length ? await multiget(t, col, toFetch, opts.batchSize) : [];
  const snapshot: SyncSnapshot = { etags: current };
  if (col.ctag) snapshot.ctag = col.ctag;
  return { changed, deleted, outOfWindow, snapshot, strategy: "etag-diff", unchanged: changed.length === 0 && deleted.length === 0 };
}

/**
 * Synct eine Collection gegen den Server.
 *
 * (a) Die sync-collection-Strategie ignoriert `opts.timeRange` — sync-collection listet immer
 *     vollständig (RFC 6578 kennt kein Zeitfenster). Ein Fenster wendet der Aufrufer (M2s Mirror)
 *     selbst auf die geparsten Daten an; `outOfWindow` ist in diesem Zweig deshalb immer leer.
 * (b) PRECONDITION: `col.ctag`/`col.syncToken` müssen frisch gelesen sein (PROPFIND Depth 0),
 *     bevor diese Funktion aufgerufen wird — sonst meldet der ctag-Kurzschluss dauerhaft
 *     `unchanged`, weil der Vergleich gegen einen veralteten Stand läuft.
 * (c) `outOfWindow` (etag-diff mit `timeRange`) meldet JEDEN href, der aus der gefensterten
 *     Listing-Antwort fehlt — das deckt sowohl "aus dem Fenster gewandert" als auch "vom Server
 *     geloescht" ab; die Unterscheidung anhand des gespeicherten `raw`-Stands trifft erst
 *     `applyDelta` in `src/core/mirror/apply.ts`.
 */
export async function syncCollection(t: Transport, col: DavCollection, prev: SyncSnapshot | undefined, opts: SyncOptions = {}): Promise<SyncDelta> {
  if (col.syncToken) {
    const d = await viaSyncCollection(t, col, prev, opts);
    if (d) return d;
    return viaEtagDiff(t, col, { etags: {} }, opts);      // Token kaputt: Vollabgleich, prev verwerfen
  }
  return viaEtagDiff(t, col, prev, opts);
}
