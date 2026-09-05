import ICAL from "ical.js";
import { timeOfProp } from "./time";

export interface TodoData {
  uid: string; summary: string; description?: string;
  start?: string; due?: string; allDay: boolean; tzid?: string;
  status?: string; percentComplete?: number; priority?: number;
  completed?: string; rrule?: string; categories: string[];
  lastModified?: string; sequence: number;
}

/** Offen heisst: der SERVER sagt nicht, dass es fertig ist. Fehlendes STATUS gilt als offen
 *  (RFC 5545 kennt keinen Default, und eine Aufgabe verschwinden zu lassen, weil ein Server das
 *  Feld nicht setzt, waere der teurere Fehler). */
export function isOpen(t: TodoData): boolean {
  const s = t.status?.toUpperCase();
  return s !== "COMPLETED" && s !== "CANCELLED";
}

function num(vt: ICAL.Component, name: string): number | undefined {
  const v = vt.getFirstPropertyValue(name);
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function todoFromComponent(vt: ICAL.Component): TodoData {
  const t: TodoData = {
    uid: String(vt.getFirstPropertyValue("uid") ?? ""),
    summary: String(vt.getFirstPropertyValue("summary") ?? ""),
    start: undefined, due: undefined,
    allDay: false, categories: [],
    sequence: Number(vt.getFirstPropertyValue("sequence") ?? 0),
  };
  // DTSTART und DUE sind bei VTODO BEIDE optional (RFC 5545 4.6.2) — anders als DTSTART bei VEVENT.
  const startProp = vt.getFirstProperty("dtstart");
  const dueProp = vt.getFirstProperty("due");
  const anchor = startProp ?? dueProp;
  if (anchor) {
    const a = timeOfProp(anchor);
    if (a.tzid) t.tzid = a.tzid;
    t.allDay = !a.iso.includes("T");
  }
  if (startProp) t.start = timeOfProp(startProp).iso;
  if (dueProp) t.due = timeOfProp(dueProp).iso;
  const str = (n: string): string | undefined => {
    const v = vt.getFirstPropertyValue(n);
    return v === null || v === undefined ? undefined : String(v);
  };
  const d = str("description");
  if (d) t.description = d;
  const s = str("status");
  if (s) t.status = s.toUpperCase();
  const pc = num(vt, "percent-complete");
  if (pc !== undefined) t.percentComplete = pc;
  const pr = num(vt, "priority");
  if (pr !== undefined) t.priority = pr;
  const compProp = vt.getFirstProperty("completed");
  if (compProp) t.completed = timeOfProp(compProp).iso;
  const rr = vt.getFirstProperty("rrule");
  if (rr) t.rrule = rr.toICALString().replace(/\r?\n[ \t]/g, "").replace(/^RRULE:/i, "");
  for (const p of vt.getAllProperties("categories")) for (const v of p.getValues()) t.categories.push(String(v));
  const lm = vt.getFirstProperty("last-modified");
  if (lm) t.lastModified = timeOfProp(lm).iso;
  return t;
}

/**
 * Das massgebliche VTODO einer Ressource — Pendant zu `primaryEvent`.
 *
 * Anders als dort gibt es hier keine RECURRENCE-ID-Auswahl: `TodoData` fuehrt kein solches
 * Feld, weil Instanz-Notizen fuer wiederkehrende Aufgaben ausdrueckliches Nicht-Ziel sind
 * (Spec M6a § 11). Eine CalDAV-Ressource traegt regulaer genau ein VTODO; mehrere waeren
 * Instanzen derselben Serie, und dann ist die erste die Serie selbst.
 */
export function primaryTodo(todos: TodoData[]): TodoData | undefined {
  return todos[0];
}

export function parseTodos(ics: string): TodoData[] {
  const jcal: unknown = ICAL.parse(ics);
  if (!Array.isArray(jcal)) throw new Error("kein VCALENDAR");
  const root = new ICAL.Component(jcal);
  if (root.name !== "vcalendar" && root.name !== "vtodo") throw new Error("kein VCALENDAR");
  const comps = root.name === "vtodo" ? [root] : root.getAllSubcomponents("vtodo");
  return comps.map(todoFromComponent);
}
