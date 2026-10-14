import { parseEvents, primaryEvent } from "../ical/event";
import type { CollectionState } from "./collection-state";

/** Wie sich die Termine einer Sammlung zusammensetzen: ganztaegig (Geburtstage, Feiertage) gegen
 *  mit Uhrzeit. Wird nach dem Abgleich AUSGEZAEHLT statt geraten (Anlass: der Geburtstagskalender
 *  bei mailbox.org) und in den Einstellungen gezeigt, damit die Profil-Wahl eine Grundlage hat. */
export function countEventComposition(state: CollectionState): { allDay: number; timed: number } {
  let allDay = 0;
  let timed = 0;
  for (const o of Object.values(state.objects)) {
    let ev;
    try {
      ev = primaryEvent(parseEvents(o.raw));
    } catch {
      continue; // unlesbare Rohdaten zaehlen weder so noch so
    }
    if (!ev) continue;
    if (ev.allDay) allDay++;
    else timed++;
  }
  return { allDay, timed };
}
