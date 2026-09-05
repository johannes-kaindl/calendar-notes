import type { TodoData } from "../ical/todo";
import { isOpen } from "../ical/todo";
import type { MappingProfile } from "./profile";
import type { ManagedValues } from "./fields";

/** RFC 5545 3.8.1.9: 1–4 hoch, 5 normal, 6–9 niedrig, 0 = undefiniert. */
export function priorityValue(p: MappingProfile, prio: number | undefined): string | undefined {
  if (prio === undefined || prio === 0) return undefined;
  const map = p.priorityMap;
  if (!map) return undefined;
  if (prio <= 4) return map.high;
  if (prio === 5) return map.normal;
  return map.low;
}

export function statusValue(p: MappingProfile, status: string | undefined): string | undefined {
  const map = p.statusMap;
  if (!map) return undefined; // lieber nichts schreiben als eine geratene Vokabel
  switch (status?.toUpperCase()) {
    case "COMPLETED": return map.completed;
    case "CANCELLED": return map.cancelled;
    case "IN-PROCESS": return map.inProcess;
    default: return map.needsAction; // fehlendes STATUS gilt als offen (RFC kennt keinen Default)
  }
}

export function todoValues(t: TodoData, profile: MappingProfile): ManagedValues {
  const v: ManagedValues = {};
  const put = (serverField: string, value: string | number | boolean | string[] | undefined): void => {
    if (value !== undefined) v[serverField] = value;
  };
  put("title", t.summary);
  put("due", t.due);
  put("start", t.start);
  put("allday", t.allDay);
  put("tzid", t.tzid);
  put("description", t.description);
  put("status", statusValue(profile, t.status));
  put("priority", priorityValue(profile, t.priority));
  put("percent", t.percentComplete);
  put("completed", t.completed);
  put("rrule", t.rrule);
  put("last_modified", t.lastModified);
  if (t.categories.length) v["categories"] = t.categories;
  return v;
}

export function renderTodoBlock(t: TodoData): string {
  const zeilen: string[] = [];
  if (t.due) zeilen.push(`- Fällig: ${t.due}`);
  if (t.percentComplete !== undefined) zeilen.push(`- Fortschritt: ${t.percentComplete} %`);
  if (t.description) zeilen.push("", t.description);
  return zeilen.join("\n");
}

/**
 * Offene Aufgaben liegen IMMER im Fenster — eine Aufgabe ohne Datum liegt sonst in keinem, und
 * das Zeitfenster der Termine traegt hier nicht (Spec § 7). Erledigte und abgebrochene nur,
 * solange ihr Abschluss im Fenster liegt; fehlt COMPLETED, entscheidet LAST-MODIFIED, und fehlt
 * auch das, wird gespiegelt statt archiviert (nichts annehmen).
 */
export function todoInWindow(t: TodoData, w: { start: Date; end: Date }): boolean {
  if (isOpen(t)) return true;
  const stamp = t.completed ?? t.lastModified;
  if (!stamp) return true;
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return true;
  return d >= w.start && d <= w.end;
}
