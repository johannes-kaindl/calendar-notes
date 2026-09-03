import ICAL from "ical.js";
import { calAddress, timeOfProp, timeToIso, type Attendee } from "./time";

export { timeToIso, type Attendee };
export interface EventData {
  uid: string; summary: string; description?: string; location?: string; url?: string;
  start: string; end?: string; allDay: boolean; tzid?: string;
  rrule?: string; exdates: string[]; recurrenceId?: string;
  attendees: Attendee[]; organizer?: Attendee;
  status?: string; categories: string[]; lastModified?: string; sequence: number;
}

function eventFromComponent(ve: ICAL.Component): EventData {
  const ev = new ICAL.Event(ve);
  const startProp = ve.getFirstProperty("dtstart");
  const startT = ev.startDate;
  const { iso: start, tzid } = startProp ? timeOfProp(startProp) : timeToIso(startT);
  const e: EventData = {
    uid: ev.uid ?? "", summary: ev.summary ?? "", start, end: undefined, allDay: startT.isDate,
    exdates: [], attendees: [], categories: [], sequence: Number(ve.getFirstPropertyValue("sequence") ?? 0),
  };
  if (tzid) e.tzid = tzid;
  const endProp = ve.getFirstProperty("dtend");
  if (endProp) e.end = timeOfProp(endProp).iso;
  else if (ve.getFirstProperty("duration")) e.end = timeToIso(ev.endDate).iso;
  const str = (n: string): string | undefined => {
    const v = ve.getFirstPropertyValue(n);
    return v === null || v === undefined ? undefined : String(v);
  };
  const d = str("description");
  if (d) e.description = d;
  const l = str("location");
  if (l) e.location = l;
  const u = str("url");
  if (u) e.url = u;
  const s = str("status");
  if (s) e.status = s.toUpperCase();
  const rr = ve.getFirstProperty("rrule");
  if (rr) e.rrule = rr.toICALString().replace(/\r?\n[ \t]/g, "").replace(/^RRULE:/i, "");
  for (const p of ve.getAllProperties("exdate")) {
    const tzidParam = p.getParameter("tzid");
    const ptzid = typeof tzidParam === "string" ? tzidParam : undefined;
    for (const v of p.getValues() as ICAL.Time[]) e.exdates.push(timeToIso(v, ptzid).iso);
  }
  const rid = ve.getFirstProperty("recurrence-id");
  if (rid) e.recurrenceId = timeOfProp(rid).iso;
  for (const p of ve.getAllProperties("categories")) for (const v of p.getValues()) e.categories.push(String(v));
  for (const p of ve.getAllProperties("attendee")) e.attendees.push(calAddress(p));
  const org = ve.getFirstProperty("organizer");
  if (org) e.organizer = calAddress(org);
  const lm = ve.getFirstProperty("last-modified");
  if (lm) e.lastModified = timeOfProp(lm).iso;
  return e;
}

export function parseEvents(ics: string): EventData[] {
  const jcal: unknown = ICAL.parse(ics);
  if (!Array.isArray(jcal)) throw new Error("kein VCALENDAR");
  const root = new ICAL.Component(jcal);
  if (root.name !== "vcalendar" && root.name !== "vevent") throw new Error("kein VCALENDAR");
  const comps = root.name === "vevent" ? [root] : root.getAllSubcomponents("vevent");
  return comps.map(eventFromComponent);
}

export function primaryEvent(events: EventData[]): EventData | undefined {
  return events.find((e) => !e.recurrenceId) ?? events[0];
}
