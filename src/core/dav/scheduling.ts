import { DavError, type Transport } from "./types";
import { parseMultistatus, hrefsOf } from "./xml";
import { propfindBody } from "./requests";
import { resolveHref } from "./url";

const XML = { "Content-Type": "application/xml; charset=utf-8" };

export interface SchedulingInfo {
  outbox?: string;
  inbox?: string;
  addresses: string[];
}

const SCHEDULING_PROPS = ["c:schedule-outbox-URL", "c:schedule-inbox-URL", "c:calendar-user-address-set"];

const MAILTO = /^mailto:/i;

export async function discoverScheduling(t: Transport, principalUrl: string): Promise<SchedulingInfo> {
  const res = await t({ method: "PROPFIND", url: principalUrl, headers: { Depth: "0", ...XML }, body: propfindBody(SCHEDULING_PROPS) });
  if (res.status !== 207) throw new DavError(res.status, `PROPFIND ${principalUrl} → ${res.status}`, principalUrl);
  const { responses } = parseMultistatus(res.text, `PROPFIND ${principalUrl}`);
  const r0 = responses[0];
  const props = r0?.props ?? {};

  const outboxHref = hrefsOf(props["schedule-outbox-url"])[0];
  const inboxHref = hrefsOf(props["schedule-inbox-url"])[0];
  const addressHrefs = hrefsOf(props["calendar-user-address-set"]);
  const addresses = addressHrefs
    .filter((h) => MAILTO.test(h))
    .map((h) => h.replace(MAILTO, "").toLowerCase());

  const out: SchedulingInfo = { addresses };
  if (outboxHref) out.outbox = resolveHref(principalUrl, outboxHref);
  if (inboxHref) out.inbox = resolveHref(principalUrl, inboxHref);
  return out;
}
