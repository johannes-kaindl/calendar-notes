import { DavError, type DavCollection, type Transport } from "./types";
import { parseMultistatus } from "./xml";
import { propfindBody } from "./requests";
import { collectionFromResponse, COLLECTION_PROPS } from "./discovery";

const XML = { "Content-Type": "application/xml; charset=utf-8" };

/** Fragt ctag/sync-token/readOnly/displayName einer bekannten Collection frisch ab
 *  (PROPFIND Depth 0 auf col.href) — vor jedem Sync, damit ein leerer sync-collection-Lauf
 *  nicht faelschlich "nichts geaendert" meldet, wenn der Server den ctag geaendert hat.
 *  Fehlende Props in der Antwort lassen die bisherigen Werte von `col` stehen. */
export async function refreshCollection(t: Transport, col: DavCollection): Promise<DavCollection> {
  const res = await t({ method: "PROPFIND", url: col.href, headers: { Depth: "0", ...XML }, body: propfindBody(COLLECTION_PROPS) });
  if (res.status === 404) throw new DavError(404, `PROPFIND ${col.href} → 404`, col.href);
  if (res.status !== 207) throw new DavError(res.status, `PROPFIND ${col.href} → ${res.status}`, col.href);
  const { responses } = parseMultistatus(res.text, `PROPFIND ${col.href}`);
  const fresh = responses[0] ? collectionFromResponse(responses[0], col.href) : undefined;
  if (!fresh) throw new DavError(res.status, `PROPFIND ${col.href}: keine Collection in der Antwort`, col.href);
  return { ...col, ...fresh };
}
