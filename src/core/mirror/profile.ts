export type ProfileKind = "contact" | "event";
export type FmScalar = string | number | boolean;
export type FmVal = FmScalar | string[];

export interface MappingProfile {
  id: string; name: string; kind: ProfileKind;
  folder: string; filename: string;
  uidField: string; sourceField: string; etagField: string; stateField: string; recurrenceIdField: string;
  fields: Record<string, string | null>;
  onCreate: Record<string, FmVal>;
  body: "block" | "none";
  attendeeLinks: boolean;
}

export const CONTACT_SERVER_FIELDS = ["fn", "given", "family", "nickname", "email", "email_home", "email_work", "tel_cell", "tel_home", "tel_work", "org", "title", "role", "url", "adr", "bday", "note", "categories", "photo"] as const;
export const EVENT_SERVER_FIELDS = ["title", "start", "end", "allday", "tzid", "location", "url", "online", "description", "status", "rrule", "attendees", "organizer", "categories", "last_modified"] as const;

const IDENTITY = { uidField: "dav_uid", sourceField: "dav_source", etagField: "dav_etag", stateField: "dav_state", recurrenceIdField: "dav_recurrence_id" };

export function defaultContactProfile(): MappingProfile {
  return {
    id: "default-contact", name: "Contacts (default)", kind: "contact", folder: "Contacts", filename: "{fn}", ...IDENTITY,
    fields: {
      fn: "title", given: null, family: null, nickname: null,
      email: "email", email_home: null, email_work: null,
      tel_cell: "phone_mobile", tel_home: "phone", tel_work: "phone_work",
      org: "organization", title: "job_title", role: "role", url: "website", adr: "address", bday: "birthday",
      note: null, categories: "categories", photo: null,
    },
    onCreate: { type: "contact" }, body: "block", attendeeLinks: false,
  };
}

export function defaultEventProfile(): MappingProfile {
  return {
    id: "default-event", name: "Events (default)", kind: "event", folder: "Events", filename: "{start_date} {title}", ...IDENTITY,
    fields: {
      title: "title", start: "start", end: "end", allday: "all_day", tzid: null, location: "location", url: "url", online: "online",
      description: null, status: "event_status", rrule: "rrule", attendees: "attendees", organizer: "organizer", categories: "categories", last_modified: null,
    },
    onCreate: { type: "event" }, body: "block", attendeeLinks: true,
  };
}

export function fmKeyFor(p: MappingProfile, serverField: string): string | null {
  const v = Object.hasOwn(p.fields, serverField) ? p.fields[serverField] : null;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function identityKeys(p: MappingProfile): string[] {
  return [p.uidField, p.sourceField, p.etagField, p.stateField, p.recurrenceIdField];
}

export function managedKeys(p: MappingProfile): string[] {
  const out = [...identityKeys(p)];
  for (const v of Object.values(p.fields)) if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  return out;
}

function normFolder(f: string): string {
  return f.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function validateProfile(p: unknown): { ok: true; profile: MappingProfile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!p || typeof p !== "object") return { ok: false, errors: ["Profil ist kein Objekt"] };
  const o = p as Record<string, unknown>;
  const str = (k: string, required = true): string => {
    const v = o[k];
    if (typeof v !== "string" || (required && v.length === 0)) { errors.push(`${k} fehlt oder ist leer`); return ""; }
    return v;
  };
  const id = str("id"), name = str("name"), filename = str("filename"), folderRaw = str("folder", false);
  const kind = o["kind"];
  if (kind !== "contact" && kind !== "event") errors.push("kind muss contact oder event sein");
  const ids = { uidField: str("uidField"), sourceField: str("sourceField"), etagField: str("etagField"), stateField: str("stateField"), recurrenceIdField: str("recurrenceIdField") };
  const idVals = Object.values(ids);
  if (new Set(idVals).size !== idVals.length) errors.push("Identitäts-Felder müssen verschieden sein");
  const fields: Record<string, string | null> = {};
  const rawFields = o["fields"];
  const seenTargets = new Set<string>();
  if (!rawFields || typeof rawFields !== "object") errors.push("fields fehlt");
  else for (const [k, v] of Object.entries(rawFields as Record<string, unknown>)) {
    if (v === null || v === "") { fields[k] = null; continue; }
    if (typeof v !== "string") { errors.push(`fields.${k} muss String oder null sein`); continue; }
    if (idVals.includes(v)) errors.push(`fields.${k} kollidiert mit Identitäts-Feld ${v}`);
    if (seenTargets.has(v)) errors.push(`fields: Frontmatter-Key "${v}" ist mehrfach zugeordnet`);
    seenTargets.add(v);
    fields[k] = v;
  }
  const onCreate: Record<string, FmVal> = {};
  const rawOn = o["onCreate"];
  if (rawOn && typeof rawOn === "object") for (const [k, v] of Object.entries(rawOn as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") onCreate[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) onCreate[k] = v;
    else errors.push(`onCreate.${k} hat unzulässigen Typ`);
  }
  const rawBody = o["body"];
  if (rawBody !== undefined && rawBody !== "block" && rawBody !== "none") errors.push("body muss block oder none sein");
  const body: "block" | "none" = rawBody === "none" ? "none" : "block";
  const rawAttendeeLinks = o["attendeeLinks"];
  if (rawAttendeeLinks !== undefined && typeof rawAttendeeLinks !== "boolean") errors.push("attendeeLinks muss ein boolean sein");
  const attendeeLinks = rawAttendeeLinks === undefined ? true : rawAttendeeLinks === true;
  if (errors.length) return { ok: false, errors };
  return { ok: true, profile: { id, name, kind: kind as ProfileKind, folder: normFolder(folderRaw), filename, ...ids, fields, onCreate, body, attendeeLinks } };
}
