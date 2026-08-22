import { DavError, type DavCollection, type Transport } from "./types";
import { parseMultistatus, hrefsOf, hasChild, textOf, type MsResponse } from "./xml";
import { propfindBody } from "./requests";
import { resolveHref, ensureTrailingSlash, hrefPath } from "./url";
import { headerValue } from "./transport";

const XML = { "Content-Type": "application/xml; charset=utf-8" };

export interface DiscoveryResult {
  principal: string;
  calendarHome?: string;
  addressbookHome?: string;
  collections: DavCollection[];
  warnings: string[];
}

const PRINCIPAL_PROPS = ["d:current-user-principal", "c:calendar-home-set", "cr:addressbook-home-set"];
export const COLLECTION_PROPS = [
  "d:resourcetype", "d:displayname", "cs:getctag", "d:sync-token",
  "c:supported-calendar-component-set", "ical:calendar-color", "d:current-user-privilege-set",
];

async function propfind(t: Transport, url: string, depth: "0" | "1", props: string[]): Promise<MsResponse[]> {
  const res = await t({ method: "PROPFIND", url, headers: { Depth: depth, ...XML }, body: propfindBody(props) });
  if (res.status === 207) return parseMultistatus(res.text).responses;
  throw new DavError(res.status, `PROPFIND ${url} → ${res.status}`, url);
}

/** Folgt einem well-known-Redirect (301/302/307/308) und liefert das Ziel — oder undefined. */
async function wellKnown(t: Transport, baseUrl: string, kind: "caldav" | "carddav"): Promise<string | undefined> {
  const url = new URL(`/.well-known/${kind}`, baseUrl).toString();
  const res = await t({ method: "PROPFIND", url, headers: { Depth: "0", ...XML }, body: propfindBody(["d:current-user-principal"]) });
  if ([301, 302, 307, 308].includes(res.status)) {
    const loc = headerValue(res.headers, "location");
    return loc ? ensureTrailingSlash(resolveHref(url, loc)) : undefined;
  }
  if (res.status === 207) return ensureTrailingSlash(url);
  if (res.status === 401 || res.status === 403) throw new DavError(res.status, `Zugang verweigert (${res.status})`, url);
  return undefined;
}

function firstHref(r: MsResponse | undefined, prop: string, base: string): string | undefined {
  const h = hrefsOf(r?.props[prop])[0];
  return h ? ensureTrailingSlash(resolveHref(base, h)) : undefined;
}

export function collectionFromResponse(r: MsResponse, base: string): DavCollection | undefined {
  const rt = r.props["resourcetype"];
  if (hasChild(rt, "schedule-inbox") || hasChild(rt, "schedule-outbox")) return undefined;
  const kind: DavCollection["kind"] | undefined = hasChild(rt, "calendar") ? "calendar" : hasChild(rt, "addressbook") ? "addressbook" : undefined;
  if (!kind) return undefined;
  const href = ensureTrailingSlash(resolveHref(base, r.href));
  const priv = r.props["current-user-privilege-set"];
  const privs = JSON.stringify(priv ?? {}).toLowerCase();
  const readOnly = priv !== undefined && !/"(write|write-content|all|bind)"/.test(privs);
  const compSet = r.props["supported-calendar-component-set"] as Record<string, unknown> | undefined;
  const compsRaw = compSet?.["comp"];
  const comps = Array.isArray(compsRaw) ? compsRaw : compsRaw ? [compsRaw] : [];
  const components = comps.map((c) => (c as Record<string, unknown>)["@_name"]).filter((n): n is string => typeof n === "string");
  const col: DavCollection = {
    href, kind, readOnly,
    displayName: textOf(r.props["displayname"]) || decodeURIComponent(hrefPath(href).split("/").filter(Boolean).pop() ?? href),
  };
  const ctag = textOf(r.props["getctag"]); if (ctag) col.ctag = ctag;
  const tok = textOf(r.props["sync-token"]); if (tok) col.syncToken = tok;
  if (kind === "calendar" && components.length) col.components = components;
  const color = textOf(r.props["calendar-color"]); if (color) col.color = color;
  return col;
}

export async function listCollections(t: Transport, homeUrl: string, kind: "calendar" | "addressbook"): Promise<DavCollection[]> {
  const responses = await propfind(t, homeUrl, "1", COLLECTION_PROPS);
  const out: DavCollection[] = [];
  for (const r of responses) {
    const c = collectionFromResponse(r, homeUrl);
    if (c && c.kind === kind && hrefPath(c.href) !== hrefPath(ensureTrailingSlash(homeUrl))) out.push(c);
  }
  return out;
}

export async function discover(t: Transport, baseUrl: string): Promise<DiscoveryResult> {
  const base = ensureTrailingSlash(baseUrl);
  const warnings: string[] = [];
  const start = (await wellKnown(t, base, "caldav")) ?? (await wellKnown(t, base, "carddav")) ?? base;
  const r0 = await propfind(t, start, "0", PRINCIPAL_PROPS);
  let principal = firstHref(r0[0], "current-user-principal", start);
  if (!principal) { warnings.push("current-user-principal fehlt — nehme Startadresse als Principal"); principal = start; }
  let calendarHome = firstHref(r0[0], "calendar-home-set", start);
  let addressbookHome = firstHref(r0[0], "addressbook-home-set", start);
  if (!calendarHome || !addressbookHome) {
    const rp = principal === start ? r0 : await propfind(t, principal, "0", PRINCIPAL_PROPS);
    calendarHome ??= firstHref(rp[0], "calendar-home-set", principal);
    addressbookHome ??= firstHref(rp[0], "addressbook-home-set", principal);
  }
  if (!calendarHome) warnings.push("calendar-home-set nicht gefunden — keine Kalender");
  if (!addressbookHome) warnings.push("addressbook-home-set nicht gefunden — keine Adressbücher");
  const collections: DavCollection[] = [];
  if (calendarHome) collections.push(...(await listCollections(t, calendarHome, "calendar")));
  if (addressbookHome) collections.push(...(await listCollections(t, addressbookHome, "addressbook")));
  const out: DiscoveryResult = { principal, collections, warnings };
  if (calendarHome) out.calendarHome = calendarHome;
  if (addressbookHome) out.addressbookHome = addressbookHome;
  return out;
}
