import type { EventStatusMap } from "./profile";

/**
 * VEVENT-STATUS (RFC 5545 3.8.1.11: CONFIRMED | TENTATIVE | CANCELLED) -> Vokabel der Notiz.
 * Ein fehlendes STATUS gilt als bestaetigt (der RFC kennt keinen Default).
 */
export function eventStatusValue(map: EventStatusMap, server: string | null | undefined): string {
  switch (server?.toUpperCase()) {
    case "CANCELLED": return map.cancelled;
    case "TENTATIVE": return map.tentative;
    default: return map.confirmed;
  }
}

/**
 * Wert fuer eine BESTEHENDE Notiz, oder `undefined` = nicht anfassen. Der Status in der Notiz ist
 * ein Arbeitsstand des Nutzers (geplant -> in-arbeit -> abgeschlossen), den der Server nicht kennt;
 * ihn bei jedem Abgleich zu ueberschreiben, zerstoerte ihn. Der Server gewinnt deshalb nur an den
 * zwei Stellen, an denen er etwas Neues sagt: die Absage, und ihre Ruecknahme, solange die Notiz
 * noch das Absage-Wort traegt.
 */
export function nextEventStatus(map: EventStatusMap, server: string | null | undefined, current: unknown): string | undefined {
  const cancelled = server?.toUpperCase() === "CANCELLED";
  if (cancelled) return current === map.cancelled ? undefined : map.cancelled;
  if (current === map.cancelled) return eventStatusValue(map, server);
  return undefined;
}
