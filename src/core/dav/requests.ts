export const NS = {
  dav: "DAV:",
  caldav: "urn:ietf:params:xml:ns:caldav",
  carddav: "urn:ietf:params:xml:ns:carddav",
  cs: "http://calendarserver.org/ns/",
  ical: "http://apple.com/ns/ical/",
} as const;

const XMLNS = `xmlns:d="${NS.dav}" xmlns:c="${NS.caldav}" xmlns:cr="${NS.carddav}" xmlns:cs="${NS.cs}" xmlns:ical="${NS.ical}"`;
const HEAD = `<?xml version="1.0" encoding="utf-8"?>`;

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const propTags = (props: string[]) => props.map((p) => `<${p}/>`).join("");

export function propfindBody(props: string[]): string {
  return `${HEAD}<d:propfind ${XMLNS}><d:prop>${propTags(props)}</d:prop></d:propfind>`;
}

export function syncCollectionBody(syncToken: string | undefined, props: string[] = ["d:getetag"]): string {
  return `${HEAD}<d:sync-collection ${XMLNS}><d:sync-token>${syncToken ? xmlEscape(syncToken) : ""}</d:sync-token><d:sync-level>1</d:sync-level><d:prop>${propTags(props)}</d:prop></d:sync-collection>`;
}

const hrefTags = (hrefs: string[]) => hrefs.map((h) => `<d:href>${xmlEscape(h)}</d:href>`).join("");

export function calendarMultigetBody(hrefs: string[]): string {
  return `${HEAD}<c:calendar-multiget ${XMLNS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefTags(hrefs)}</c:calendar-multiget>`;
}

export function addressbookMultigetBody(hrefs: string[]): string {
  return `${HEAD}<cr:addressbook-multiget ${XMLNS}><d:prop><d:getetag/><cr:address-data/></d:prop>${hrefTags(hrefs)}</cr:addressbook-multiget>`;
}

const TIME_RANGE_TS = /^\d{8}T\d{6}Z$/;

export function calendarQueryBody(range?: { start: string; end: string }): string {
  if (range && (!TIME_RANGE_TS.test(range.start) || !TIME_RANGE_TS.test(range.end))) {
    throw new Error("time-range erwartet UTC-Zeitstempel YYYYMMDDTHHMMSSZ");
  }
  const tr = range ? `<c:time-range start="${range.start}" end="${range.end}"/>` : "";
  return `${HEAD}<c:calendar-query ${XMLNS}><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">${tr}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}
