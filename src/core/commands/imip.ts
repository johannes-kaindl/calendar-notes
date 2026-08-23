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

/** Sprach-Text fuer `buildImip` — `src/core/**` bleibt i18n-frei (kein `t()`-Import, `check:pure`
 *  scannt zwar nur obsidian/node/DOM, aber deutschsprachige Literale gehoeren trotzdem nicht in
 *  den Kern): der Aufrufer (`invite.ts`) reicht die uebersetzten Labels durch. */
export interface ImipLabels {
  invitation: string;
  cancellation: string;
  title: string;
  time: string;
  location: string;
  description: string;
}

/** Setzt `METHOD:<method>` im VCALENDAR — ersetzt eine bereits vorhandene METHOD-Zeile
 *  (z. B. wenn `plan.newRaw` schon einmal durch `insertMethod` lief) statt sie zu duplizieren,
 *  sonst wird sie direkt nach `PRODID` eingefuegt. Reine Zeilen-Operation (kein
 *  ical.js-Re-Serialize noetig), robust gegen CRLF/LF. Wirft, wenn weder eine METHOD- noch
 *  eine PRODID-Zeile gefunden wird (kein gueltiges VCALENDAR fuer diesen Zweck). */
export function insertMethod(ics: string, method: string): string {
  const eol = ics.includes("\r\n") ? "\r\n" : "\n";
  const lines = ics.split(/\r\n|\n/);
  const methodIdx = lines.findIndex((l) => l.startsWith("METHOD:"));
  if (methodIdx !== -1) {
    lines[methodIdx] = `METHOD:${method}`;
    return lines.join(eol);
  }
  const prodidIdx = lines.findIndex((l) => l.startsWith("PRODID"));
  if (prodidIdx === -1) throw new Error("iMIP: VCALENDAR ohne PRODID-Zeile");
  lines.splice(prodidIdx + 1, 0, `METHOD:${method}`);
  return lines.join(eol);
}

function displayTime(start: string, end?: string): string {
  return end ? `${start} – ${end}` : start;
}

/** Baut die iMIP-Nachricht (Betreff/Klartext/ics mit METHOD) aus einem `CommandPlan` mit
 *  `invite` (event-commands.ts fuellt das bei Kommandos, die eine Zu-/Absage ausloesen).
 *  Pure — kein Obsidian-/Node-/DOM-Zugriff (`src/core/**`, `check:pure`); `opts.labels`
 *  liefert die deutsch/englisch uebersetzten Beschriftungen (der Aufrufer liest sie aus
 *  `t("invite.label.*")`, s. `src/obsidian/invite.ts`). */
export function buildImip(plan: CommandPlan, method: "REQUEST" | "CANCEL", from: string, opts: { now: Date; labels: ImipLabels }): ImipMessage {
  if (!plan.invite) throw new Error("buildImip: Plan enthaelt keine invite-Angaben");
  const ics = insertMethod(plan.newRaw, method);
  const ev = primaryEvent(parseEvents(ics));
  if (!ev) throw new Error("buildImip: kein VEVENT im Plan");

  const { labels } = opts;
  const title = ev.summary;
  const time = displayTime(ev.start, ev.end);
  const verb = method === "CANCEL" ? labels.cancellation : labels.invitation;
  const subject = `${verb}: ${title}, ${time}`;

  const lines = [`${labels.title}: ${title}`, `${labels.time}: ${time}`];
  if (ev.location) lines.push(`${labels.location}: ${ev.location}`);
  if (ev.description) lines.push(`${labels.description}: ${ev.description}`);
  const text = lines.join("\n");

  return { method, from, to: plan.invite.attendees, subject, text, ics };
}
