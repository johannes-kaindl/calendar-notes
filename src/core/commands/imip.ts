import { parseEvents, primaryEvent } from "../ical/event";
import type { CommandPlan } from "./types";

/** RFC 6047 iMIP — Vertrag mit `mailstone` (s. `../mailstone/docs/2026-08-22-anforderungen-aus-calendar-notes.md`).
 *  `from` ist eine Absender-Konto-ID aus `MailTransport.accounts()`, kein Adress-String. */
export interface ImipMessage {
  method: "REQUEST" | "CANCEL" | "REPLY";
  from: string;
  to: string[];
  subject: string;
  text: string;
  ics: string;
}

/** Fuegt `METHOD:<method>` direkt nach der `PRODID`-Zeile im VCALENDAR ein — reine
 *  Zeilen-Operation (kein ical.js-Re-Serialize noetig), robust gegen CRLF/LF. Wirft, wenn
 *  keine PRODID-Zeile gefunden wird (kein gueltiges VCALENDAR fuer diesen Zweck). */
export function insertMethod(ics: string, method: string): string {
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  const lines = ics.split(/\r\n|\n/);
  const idx = lines.findIndex((l) => l.startsWith("PRODID"));
  if (idx === -1) throw new Error("iMIP: VCALENDAR ohne PRODID-Zeile");
  lines.splice(idx + 1, 0, `METHOD:${method}`);
  return lines.join(eol);
}

function displayTime(start: string, end?: string): string {
  return end ? `${start} – ${end}` : start;
}

/** Baut die iMIP-Nachricht (Betreff/Klartext/ics mit METHOD) aus einem `CommandPlan` mit
 *  `invite` (event-commands.ts fuellt das bei Kommandos, die eine Zu-/Absage ausloesen).
 *  Pure — kein Obsidian-/Node-/DOM-Zugriff (`src/core/**`, `check:pure`). */
export function buildImip(plan: CommandPlan, method: "REQUEST" | "CANCEL", from: string, opts: { now: Date }): ImipMessage {
  if (!plan.invite) throw new Error("buildImip: Plan enthaelt keine invite-Angaben");
  const ics = insertMethod(plan.newRaw, method);
  const ev = primaryEvent(parseEvents(ics));
  if (!ev) throw new Error("buildImip: kein VEVENT im Plan");

  const title = ev.summary || "(ohne Titel)";
  const time = displayTime(ev.start, ev.end);
  const verb = method === "CANCEL" ? "Absage" : "Einladung";
  const subject = `${verb}: ${title}, ${time}`;

  const lines = [`Titel: ${title}`, `Zeit: ${time}`];
  if (ev.location) lines.push(`Ort: ${ev.location}`);
  if (ev.description) lines.push(`Beschreibung: ${ev.description}`);
  const text = lines.join("\n");

  return { method, from, to: plan.invite.attendees, subject, text, ics };
}
