import ICAL from "ical.js";

export interface Attendee { email: string; name?: string; partstat?: string; role?: string; rsvp?: boolean }

/** ICAL.Time → ISO-Konvention dieses Plugins (s. Plan Task 8 der M1-Planung). tzid kommt notfalls aus dem übergebenen Property-Parameter. */
export function timeToIso(t: ICAL.Time, tzidFromProp?: string): { iso: string; tzid?: string } {
  if (t.isDate) return { iso: t.toString() }; // "2026-12-24"
  const base = t.toString(); // "2026-09-01T10:00:00"
  const zoneTzid = (t.zone as unknown as { tzid?: string } | undefined)?.tzid;
  if (zoneTzid === "UTC" || t.zone === ICAL.Timezone.utcTimezone) return { iso: base.endsWith("Z") ? base : `${base}Z` };
  const tzid = tzidFromProp ?? (zoneTzid && zoneTzid !== "floating" ? zoneTzid : undefined);
  if (tzid) return { iso: base, tzid };
  return { iso: base };
}

export function timeOfProp(p: ICAL.Property): { iso: string; tzid?: string } {
  const val = p.getFirstValue();
  const tzidParam = p.getParameter("tzid");
  const tzid = typeof tzidParam === "string" ? tzidParam : undefined;
  return timeToIso(val as ICAL.Time, tzid);
}

export function calAddress(p: ICAL.Property): Attendee {
  const raw = String(p.getFirstValue() ?? "");
  const email = raw.replace(/^mailto:/i, "").toLowerCase();
  const a: Attendee = { email };
  const cn = p.getParameter("cn");
  if (typeof cn === "string") a.name = cn;
  const ps = p.getParameter("partstat");
  if (typeof ps === "string") a.partstat = ps.toUpperCase();
  const role = p.getParameter("role");
  if (typeof role === "string") a.role = role.toUpperCase();
  const rsvp = p.getParameter("rsvp");
  if (typeof rsvp === "string") a.rsvp = rsvp.toUpperCase() === "TRUE";
  return a;
}
