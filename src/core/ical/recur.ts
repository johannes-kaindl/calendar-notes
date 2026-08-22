import ICAL from "ical.js";

function toJs(t: ICAL.Time): Date {
  return t.toJSDate();
}

function intervalOverlaps(start: Date, end: Date, rs: Date, re: Date, exclusiveEnd: boolean): boolean {
  const e = exclusiveEnd ? end.getTime() - 1 : end.getTime();
  return start.getTime() <= re.getTime() && e >= rs.getTime();
}

export function eventOccursWithin(ics: string, rangeStart: Date, rangeEnd: Date, opts: { maxIterations?: number } = {}): boolean {
  const jcal: unknown = ICAL.parse(ics);
  if (!Array.isArray(jcal)) throw new Error("kein VCALENDAR");
  const root = new ICAL.Component(jcal);
  const vevents = root.name === "vevent" ? [root] : root.getAllSubcomponents("vevent");
  const max = opts.maxIterations ?? 2000;
  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    let end: ICAL.Time;
    try {
      end = ev.endDate;
    } catch {
      end = ev.startDate;
    }
    const durMs = Math.max(0, toJs(end).getTime() - toJs(ev.startDate).getTime());
    const isDate = ev.startDate.isDate;
    if (!ev.isRecurring()) {
      const s = toJs(ev.startDate);
      if (intervalOverlaps(s, new Date(s.getTime() + durMs), rangeStart, rangeEnd, isDate && durMs > 0)) return true;
      continue;
    }
    const it = ev.iterator();
    let n = 0;
    let next: ICAL.Time | null;
    while ((next = it.next()) && n++ < max) {
      const s = toJs(next);
      if (s.getTime() > rangeEnd.getTime()) break;
      if (intervalOverlaps(s, new Date(s.getTime() + durMs), rangeStart, rangeEnd, isDate && durMs > 0)) return true;
    }
  }
  return false;
}
