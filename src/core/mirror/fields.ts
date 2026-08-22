import type { ContactData, Address } from "../vcard/contact";
import { primaryEmail, primaryTel } from "../vcard/contact";
import type { EventData, Attendee } from "../ical/event";
import { fmKeyFor, type FmVal, type MappingProfile } from "./profile";

export type ManagedValues = Record<string, FmVal | null>;
export interface AttendeeResolver { (email: string): { path: string; display?: string } | undefined }

const nz = (s: string | undefined): string | null => (s && s.length > 0 ? s : null);
const list = (a: string[] | undefined): string[] | null => (a && a.length > 0 ? a : null);

export function formatAddress(a: Address): string {
  const cityLine = [a.zip, a.city].filter((x) => x && x.length).join(" ");
  return [a.street, cityLine, a.region, a.country].filter((x): x is string => !!x && x.length > 0).join(", ");
}

export function contactValues(c: ContactData): ManagedValues {
  const typed = (kind: string) => c.emails.find((e) => e.types.includes(kind))?.value;
  const adr = c.adrs.find((a) => a.pref) ?? c.adrs[0];
  return {
    fn: nz(c.fn), given: nz(c.n?.given), family: nz(c.n?.family), nickname: nz(c.nickname),
    email: nz(primaryEmail(c)), email_home: nz(typed("home")), email_work: nz(typed("work")),
    tel_cell: nz(primaryTel(c, "cell")), tel_home: nz(primaryTel(c, "home")), tel_work: nz(primaryTel(c, "work")),
    org: c.org && c.org.length ? c.org.join(" / ") : null, title: nz(c.title), role: nz(c.role),
    url: nz(c.urls[0]?.value), adr: adr ? nz(formatAddress(adr)) : null, bday: nz(c.bday), note: nz(c.note),
    categories: list(c.categories), photo: c.photo && (c.photo.data || c.photo.uri) ? "vorhanden" : null,
  };
}

const URL_RE = /https?:\/\//i;
const LOCATION_ONLINE_RE = /\b(zoom|webex|jitsi|microsoft teams|ms teams|teams-meeting|videokonferenz|online-?meeting|videocall)\b/i;
export function isOnline(e: Pick<EventData, "location" | "url">): boolean {
  return URL_RE.test(e.location ?? "") || URL_RE.test(e.url ?? "") || LOCATION_ONLINE_RE.test(e.location ?? "");
}

function attendeeText(a: Attendee, opts: { resolveAttendee?: AttendeeResolver; attendeeLinks?: boolean }): string {
  if (opts.attendeeLinks !== false && opts.resolveAttendee) {
    const hit = opts.resolveAttendee(a.email);
    if (hit) return `[[${hit.path}|${hit.display ?? a.name ?? a.email}]]`;
  }
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function eventValues(e: EventData, opts: { resolveAttendee?: AttendeeResolver; attendeeLinks?: boolean } = {}): ManagedValues {
  return {
    title: nz(e.summary), start: e.start, end: nz(e.end), allday: e.allDay, tzid: nz(e.tzid),
    location: nz(e.location), url: nz(e.url), online: isOnline(e), description: nz(e.description), status: nz(e.status),
    rrule: nz(e.rrule), attendees: e.attendees.length ? e.attendees.map((a) => attendeeText(a, opts)) : null,
    organizer: e.organizer ? attendeeText(e.organizer, opts) : null, categories: list(e.categories), last_modified: nz(e.lastModified),
  };
}

export function toFrontmatter(values: ManagedValues, p: MappingProfile): { set: Record<string, FmVal>; unset: string[] } {
  const set: Record<string, FmVal> = {}; const unset: string[] = [];
  for (const [field, val] of Object.entries(values)) {
    const key = fmKeyFor(p, field);
    if (!key) continue;
    if (val === null) unset.push(key); else set[key] = val;
  }
  return { set, unset };
}
