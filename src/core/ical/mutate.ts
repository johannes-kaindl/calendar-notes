import ICAL from "ical.js";
import type { Attendee } from "./event";
import type { VtodoStatus } from "../mirror/todo-reverse";

export type EventMutation =
  | { kind: "times"; start: string; end?: string; allDay?: boolean; tzid?: string }
  | { kind: "summary"; summary: string }
  | { kind: "location"; location: string | null }
  | { kind: "description"; description: string | null }
  | { kind: "url"; url: string | null }
  | { kind: "addAttendee"; attendee: Attendee }
  | { kind: "removeAttendee"; email: string }
  | { kind: "partstat"; email: string; partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE" };

const PRODID = "-//Johannes Kaindl//calendar-notes//DE";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Akzeptiert `YYYY-MM-DD`, optional gefolgt von Zeit — `T` ODER Leerzeichen als Trenner
 *  (Fix C1, Review-Runde 3: das Formular-Placeholder-Format ist `YYYY-MM-DD HH:MM`, Obsidians
 *  eigene datetime-Frontmatter-Properties liefern `T14:00` OHNE Sekunden), Sekunden optional,
 *  ein trailing `Z` wird separat in `isoToTime` ausgewertet (nicht Teil dieser Regex). Vorher
 *  band die Regex Stunde/Minute/Sekunde an EIN gemeinsames optionales `(?:T..:..:..)?` —
 *  fehlten Sekunden oder stand ein Leerzeichen statt `T`, griff die Gruppe NICHT, und die Zeit
 *  wurde still auf 00:00 gerundet (schrieb die falsche Uhrzeit auf den Server). */
function parseIsoParts(iso: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) throw new Error(`ungueltiges ISO-Datum: ${iso}`);
  return {
    year: Number(m[1]), month: Number(m[2]), day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0, minute: m[5] ? Number(m[5]) : 0, second: m[6] ? Number(m[6]) : 0,
  };
}

function isoToTime(iso: string, allDay: boolean | undefined, tzid: string | undefined): ICAL.Time {
  if (allDay || DATE_ONLY.test(iso)) {
    const { year, month, day } = parseIsoParts(iso);
    return ICAL.Time.fromData({ year, month, day, isDate: true });
  }
  const { year, month, day, hour, minute, second } = parseIsoParts(iso);
  if (iso.endsWith("Z")) {
    return ICAL.Time.fromData({ year, month, day, hour, minute, second, isDate: false }, ICAL.Timezone.utcTimezone);
  }
  const t = ICAL.Time.fromData({ year, month, day, hour, minute, second, isDate: false });
  if (tzid) t.zone = new ICAL.Timezone({ tzid });
  return t;
}

function setTimeProp(ve: ICAL.Component, name: "dtstart" | "dtend" | "due", iso: string, allDay: boolean | undefined, tzid: string | undefined): void {
  ve.removeAllProperties(name);
  const t = isoToTime(iso, allDay, tzid);
  const p = new ICAL.Property(name, ve);
  p.setValue(t);
  if (t.isDate) p.setParameter("value", "DATE");
  else if (tzid && !iso.endsWith("Z")) p.setParameter("tzid", tzid);
  ve.addProperty(p);
}

function utcNow(now: Date): ICAL.Time {
  return ICAL.Time.fromJSDate(now, true);
}

function master(root: ICAL.Component): ICAL.Component {
  const all = root.getAllSubcomponents("vevent");
  const m = all.find((c) => !c.getFirstProperty("recurrence-id")) ?? all[0];
  if (!m) throw new Error("kein VEVENT");
  return m;
}

function setOrRemove(ve: ICAL.Component, name: string, value: string | number | null): void {
  ve.removeAllProperties(name);
  if (value !== null && value !== "") ve.addPropertyWithValue(name, value);
}

function findAttendee(ve: ICAL.Component, email: string): ICAL.Property | undefined {
  const want = `mailto:${email.toLowerCase()}`;
  return ve.getAllProperties("attendee").find((p) => String(p.getFirstValue()).toLowerCase() === want);
}

function parseComponent(ics: string): ICAL.Component {
  const jcal: unknown = ICAL.parse(ics);
  if (!Array.isArray(jcal)) throw new Error("kein VCALENDAR");
  return new ICAL.Component(jcal);
}

/** Pendant zu `master()` fuer Aufgaben. Eigene Funktion statt eines Parameters, weil die
 *  Fehlermeldung den gesuchten Komponententyp nennen soll — „kein VTODO" ist beim Debuggen
 *  einer falsch geleiteten Ressource die halbe Antwort. */
function masterTodo(root: ICAL.Component): ICAL.Component {
  const vt = root.getAllSubcomponents("vtodo")[0];
  if (!vt) throw new Error("kein VTODO");
  return vt;
}

export type TodoMutation =
  | { kind: "summary"; summary: string }
  | { kind: "description"; description: string | null }
  | { kind: "due"; due: string | null; allDay?: boolean; tzid?: string }
  | { kind: "start"; start: string | null; allDay?: boolean; tzid?: string }
  | { kind: "status"; status: VtodoStatus }
  | { kind: "priority"; priority: number | null }
  | { kind: "categories"; categories: string[] };

/**
 * Eine Aenderung an einem VTODO, als neues ICS zurueck.
 *
 * Geschwister zu `applyMutation` (VEVENT), mit einem Unterschied, der hier wichtig ist: der
 * Statuswechsel zieht **Nebenwirkungen** nach sich, und die gehoeren in die Mutation statt in
 * den Aufrufer. Ein `STATUS:COMPLETED` ohne `COMPLETED`-Zeitstempel ist ein widerspruechlicher
 * Zustand, den RFC 5545 zwar zulaesst, den aber jeder Klient anders auflegt; ein
 * `COMPLETED`-Zeitstempel, der nach dem Wiederoeffnen stehen bleibt, ist schlicht falsch.
 * Wer beides dem Aufrufer ueberliesse, haette drei Aufrufstellen mit derselben Pflicht.
 *
 * `SEQUENCE` wird immer erhoeht — anders als bei VEVENT gibt es hier keine Mutation, die den
 * Bump ueberspringen darf (dort ist es `partstat`, eine Teilnehmer-Antwort, die die Version
 * des Termins nicht aendert; ein Gegenstueck dazu kennt VTODO nicht).
 */
export function applyTodoMutation(ics: string, m: TodoMutation, opts: { now: Date } = { now: new Date() }): string {
  const root = parseComponent(ics);
  const vt = masterTodo(root);
  switch (m.kind) {
    case "summary": setOrRemove(vt, "summary", m.summary); break;
    case "description": setOrRemove(vt, "description", m.description); break;
    case "priority": setOrRemove(vt, "priority", m.priority); break;
    case "categories":
      vt.removeAllProperties("categories");
      if (m.categories.length) vt.addPropertyWithValue("categories", m.categories.join(","));
      break;
    case "due":
      vt.removeAllProperties("due");
      if (m.due !== null) setTimeProp(vt, "due", m.due, m.allDay ?? DATE_ONLY.test(m.due), m.tzid);
      break;
    case "start":
      vt.removeAllProperties("dtstart");
      if (m.start !== null) setTimeProp(vt, "dtstart", m.start, m.allDay ?? DATE_ONLY.test(m.start), m.tzid);
      break;
    case "status": {
      setOrRemove(vt, "status", m.status);
      vt.removeAllProperties("completed");
      vt.removeAllProperties("percent-complete");
      // CANCELLED ist KEIN Abschluss im Sinne von COMPLETED (RFC 5545 3.8.1.1) — eine
      // abgebrochene Aufgabe bekommt deshalb keinen Abschlusszeitpunkt.
      if (m.status === "COMPLETED") {
        vt.addPropertyWithValue("completed", utcNow(opts.now));
        vt.addPropertyWithValue("percent-complete", 100);
      }
      break;
    }
  }
  const seq = Number(vt.getFirstPropertyValue("sequence") ?? 0);
  vt.removeAllProperties("sequence");
  vt.addPropertyWithValue("sequence", seq + 1);
  vt.removeAllProperties("last-modified");
  vt.addPropertyWithValue("last-modified", utcNow(opts.now));
  vt.removeAllProperties("dtstamp");
  vt.addPropertyWithValue("dtstamp", utcNow(opts.now));
  return root.toString();
}

/** Eine im Vault entstandene Aufgabe als frisches VCALENDAR — Pendant zu `newEventIcs`.
 *  `STATUS` wird immer gesetzt (Default `NEEDS-ACTION`), damit die Ressource nicht mit einem
 *  Zustand entsteht, den erst der lesende Klient interpretieren muss. */
export function newTodoIcs(
  t: { uid: string; summary: string; due?: string; start?: string; allDay?: boolean; tzid?: string; description?: string; status?: VtodoStatus; priority?: number; categories?: string[] },
  opts: { now: Date; prodId?: string },
): string {
  const root = new ICAL.Component("vcalendar");
  root.addPropertyWithValue("version", "2.0");
  root.addPropertyWithValue("prodid", opts.prodId ?? PRODID);
  const vt = new ICAL.Component("vtodo");
  vt.addPropertyWithValue("uid", t.uid);
  vt.addPropertyWithValue("dtstamp", utcNow(opts.now));
  vt.addPropertyWithValue("sequence", 0);
  vt.addPropertyWithValue("summary", t.summary);
  vt.addPropertyWithValue("status", t.status ?? "NEEDS-ACTION");
  if (t.due) setTimeProp(vt, "due", t.due, t.allDay ?? DATE_ONLY.test(t.due), t.tzid);
  if (t.start) setTimeProp(vt, "dtstart", t.start, t.allDay ?? DATE_ONLY.test(t.start), t.tzid);
  if (t.description) vt.addPropertyWithValue("description", t.description);
  if (t.priority !== undefined) vt.addPropertyWithValue("priority", t.priority);
  if (t.categories?.length) vt.addPropertyWithValue("categories", t.categories.join(","));
  root.addSubcomponent(vt);
  return root.toString();
}

export function applyMutation(ics: string, m: EventMutation, opts: { now: Date } = { now: new Date() }): string {
  const root = parseComponent(ics);
  const ve = master(root);
  let bump = true;
  switch (m.kind) {
    case "times": {
      const allDay = m.allDay ?? DATE_ONLY.test(m.start);
      setTimeProp(ve, "dtstart", m.start, allDay, m.tzid);
      ve.removeAllProperties("duration");
      if (m.end) setTimeProp(ve, "dtend", m.end, allDay, m.tzid);
      else ve.removeAllProperties("dtend");
      break;
    }
    case "summary": setOrRemove(ve, "summary", m.summary); break;
    case "location": setOrRemove(ve, "location", m.location); break;
    case "description": setOrRemove(ve, "description", m.description); break;
    case "url": setOrRemove(ve, "url", m.url); break;
    case "addAttendee": {
      if (!findAttendee(ve, m.attendee.email)) {
        const p = new ICAL.Property("attendee", ve);
        p.setValue(`mailto:${m.attendee.email}`);
        if (m.attendee.name) p.setParameter("cn", m.attendee.name);
        p.setParameter("partstat", m.attendee.partstat ?? "NEEDS-ACTION");
        p.setParameter("role", m.attendee.role ?? "REQ-PARTICIPANT");
        if (m.attendee.rsvp) p.setParameter("rsvp", "TRUE");
        ve.addProperty(p);
      }
      break;
    }
    case "removeAttendee": {
      const p = findAttendee(ve, m.email);
      if (p) ve.removeProperty(p);
      break;
    }
    case "partstat": {
      const p = findAttendee(ve, m.email);
      if (p) p.setParameter("partstat", m.partstat);
      bump = false;
      break;
    }
  }
  if (bump) {
    const seq = Number(ve.getFirstPropertyValue("sequence") ?? 0);
    ve.removeAllProperties("sequence");
    ve.addPropertyWithValue("sequence", seq + 1);
  }
  ve.removeAllProperties("last-modified");
  ve.addPropertyWithValue("last-modified", utcNow(opts.now));
  ve.removeAllProperties("dtstamp");
  ve.addPropertyWithValue("dtstamp", utcNow(opts.now));
  return root.toString();
}

export function newEventIcs(
  e: { uid: string; summary: string; start: string; end?: string; allDay?: boolean; tzid?: string; location?: string; description?: string },
  opts: { now: Date; prodId?: string },
): string {
  const root = new ICAL.Component("vcalendar");
  root.addPropertyWithValue("version", "2.0");
  root.addPropertyWithValue("prodid", opts.prodId ?? PRODID);
  const ve = new ICAL.Component("vevent");
  ve.addPropertyWithValue("uid", e.uid);
  ve.addPropertyWithValue("dtstamp", utcNow(opts.now));
  ve.addPropertyWithValue("sequence", 0);
  ve.addPropertyWithValue("summary", e.summary);
  const allDay = e.allDay ?? DATE_ONLY.test(e.start);
  setTimeProp(ve, "dtstart", e.start, allDay, e.tzid);
  if (e.end) setTimeProp(ve, "dtend", e.end, allDay, e.tzid);
  if (e.location) ve.addPropertyWithValue("location", e.location);
  if (e.description) ve.addPropertyWithValue("description", e.description);
  root.addSubcomponent(ve);
  return root.toString();
}
