# calendar-notes M2a — Mirror-Kern (pure) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der obsidian-freie Mirror-Kern: aus Server-Objekten (EventData/ContactData), einem Mapping-Profil und dem Ist-Zustand einer Notiz den **Notiz-Plan** berechnen (create/update/skip/archive/delete mit Keys-setzen/-löschen und Body-Block), dazu Zustand je Sammlung (Snapshot + geschriebene Werte + Verlauf), Zeitfenster inkl. Wiederholungen, Dateinamen und Hand-Änderungs-Erkennung. Alles pure, vitest-getestet; die Obsidian-Schicht (M2b) führt Pläne nur aus.

**Architecture:** `src/core/mirror/` arbeitet auf Frontmatter-**Objekten** (wie sie der Metadata-Cache liefert) und Body-Text, nie auf YAML-Text. Ergebnis sind Pläne, keine Dateischreibvorgänge. `src/core/state/` hält den Sammlungs-Zustand als reine Datenstruktur mit reinen Update-Funktionen. `src/core/ical/recur.ts` beantwortet „kommt der Termin im Fenster vor?" über ical.js. Alles injiziert: `now`, Notiz-Lookup, Attendee-Auflösung.

**Tech Stack:** TypeScript strict, vitest, ical.js (RecurExpansion), vendored `code-kit` `filename-template` + `sha256`.

**Spec:** `docs/superpowers/specs/2026-08-22-calendar-notes-design.md` §2 (Datenmodell), §3 (Snapshot, Hand-Änderung, Trockenlauf-Grundlage), §4 (Profile). Vorgänger: M1-Plan (`2026-08-22-m1-dav-core.md`) liefert `EventData`, `ContactData`, `SyncDelta`, `SyncSnapshot`.

## Global Constraints

- `src/core/**` importiert nie `obsidian`/`electron`/Node/DOM (`npm run check:pure`). Keine neuen Runtime-Dependencies.
- Pure: keine Uhr (`now` wird übergeben), kein Zufall, kein I/O. Funktionen geben neue Objekte zurück, mutieren Eingaben nicht.
- Frontmatter-Werte (`FmVal`) sind `string | number | boolean | string[]`; `null` im Plan heißt „Key entfernen".
- Identitäts-Keys (`uidField`, `sourceField`, `etagField`, `stateField`, bei Overrides `recurrenceIdField`) sind **immer** verwaltet, unabhängig vom `fields`-Mapping.
- Verwaltete Keys überschreiben; `onCreate`-Keys nur bei Neuanlage; alle anderen Keys werden nie angefasst (Spec §2). Body außerhalb `%% dav:begin %%`/`%% dav:end %%` bleibt unberührt.
- Dateiname-Template in Kit-Syntax (`{title}`, `{start_date}`, `{start_time}`, `{uid}`, `{fn}`, `{family}`, `{given}`, `{org}`); `buildFilename` aus `src/vendor/code-kit/filename-template.ts` mit `fallbacks: ["{uid}"]`, `lastResort: "dav-object"`.
- Commits auf einem Branch `m2a-mirror-core`, deutsche Messages (`feat(mirror): …`), Trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01QEMoJXBVx5UdQhH3fp3rNA`.
- TDD.

---

### Task 1: Mapping-Profile (Typ, Defaults, Validierung, Key-Auflösung)

**Files:**
- Create: `src/core/mirror/profile.ts`
- Test: `tests/core/mirror/profile.test.ts`

**Interfaces:**
```ts
export type ProfileKind = "contact" | "event";
export type FmScalar = string | number | boolean;
export type FmVal = FmScalar | string[];
export interface MappingProfile {
  id: string; name: string; kind: ProfileKind;
  folder: string;            // vault-relativ, ohne führenden/abschließenden Slash; "" = Vault-Wurzel
  filename: string;          // Kit-Template
  uidField: string; sourceField: string; etagField: string; stateField: string; recurrenceIdField: string;
  fields: Record<string, string | null>;      // serverField → fmKey | null
  onCreate: Record<string, FmVal>;
  body: "block" | "none";
  attendeeLinks: boolean;    // nur event: Attendees als Wikilinks auflösen
}
export const CONTACT_SERVER_FIELDS: readonly string[]  // ["fn","given","family","nickname","email","email_home","email_work","tel_cell","tel_home","tel_work","org","title","role","url","adr","bday","note","categories","photo"]
export const EVENT_SERVER_FIELDS: readonly string[]    // ["title","start","end","allday","tzid","location","url","online","description","status","rrule","attendees","organizer","categories","last_modified"]
export function defaultContactProfile(): MappingProfile
export function defaultEventProfile(): MappingProfile
export function validateProfile(p: unknown): { ok: true; profile: MappingProfile } | { ok: false; errors: string[] }
export function fmKeyFor(p: MappingProfile, serverField: string): string | null
export function identityKeys(p: MappingProfile): string[]     // [uidField, sourceField, etagField, stateField, recurrenceIdField]
export function managedKeys(p: MappingProfile): string[]      // identityKeys ∪ alle nicht-null fields-Werte (dedupliziert, Reihenfolge: identity zuerst)
```

- [ ] **Step 1: Tests**

`tests/core/mirror/profile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defaultContactProfile, defaultEventProfile, validateProfile, fmKeyFor, managedKeys, identityKeys, CONTACT_SERVER_FIELDS, EVENT_SERVER_FIELDS } from "../../../src/core/mirror/profile";

describe("defaults", () => {
  it("contact default maps the core fields and keeps note/photo out of frontmatter", () => {
    const p = defaultContactProfile();
    expect(p.kind).toBe("contact");
    expect(fmKeyFor(p, "fn")).toBe("title");
    expect(fmKeyFor(p, "email")).toBe("email");
    expect(fmKeyFor(p, "tel_cell")).toBe("phone_mobile");
    expect(fmKeyFor(p, "title")).toBe("job_title");
    expect(fmKeyFor(p, "note")).toBeNull();
    expect(fmKeyFor(p, "photo")).toBeNull();
    expect(p.filename).toBe("{fn}");
    expect(p.onCreate).toEqual({ type: "contact" });
    expect(identityKeys(p)).toEqual(["dav_uid", "dav_source", "dav_etag", "dav_state", "dav_recurrence_id"]);
  });
  it("event default", () => {
    const p = defaultEventProfile();
    expect(fmKeyFor(p, "title")).toBe("title");
    expect(fmKeyFor(p, "start")).toBe("start");
    expect(fmKeyFor(p, "allday")).toBe("all_day");
    expect(fmKeyFor(p, "description")).toBeNull();
    expect(p.filename).toBe("{start_date} {title}");
    expect(p.attendeeLinks).toBe(true);
  });
  it("every server field of the kind has a mapping entry (null allowed)", () => {
    const c = defaultContactProfile(); const e = defaultEventProfile();
    for (const f of CONTACT_SERVER_FIELDS) expect(Object.hasOwn(c.fields, f)).toBe(true);
    for (const f of EVENT_SERVER_FIELDS) expect(Object.hasOwn(e.fields, f)).toBe(true);
  });
});
describe("fmKeyFor / managedKeys", () => {
  it("unknown server field → null; managedKeys = identity ∪ mapped, deduped", () => {
    const p = { ...defaultContactProfile(), fields: { fn: "title", email: "email", tel_cell: "email" } };
    expect(fmKeyFor(p, "nope")).toBeNull();
    expect(managedKeys(p)).toEqual(["dav_uid", "dav_source", "dav_etag", "dav_state", "dav_recurrence_id", "title", "email"]);
  });
});
describe("validateProfile", () => {
  it("accepts a default and a Pallas-like profile", () => {
    expect(validateProfile(defaultEventProfile()).ok).toBe(true);
    const pallas = { ...defaultContactProfile(), id: "pallas-kontakte", name: "Pallas Kontakte", folder: "50_Ressourcen/10_Reference/10_Kontakte", uidField: "vcard_uid",
      fields: { ...defaultContactProfile().fields, tel_cell: "mobil", tel_home: "telefon", org: "organisation", title: "rolle", adr: "adresse", url: "website" },
      onCreate: { type: "👤 Kontakt", status: "3-evergreen 🌿", up: "[[10_Kontakte]]" } };
    const r = validateProfile(pallas);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.folder).toBe("50_Ressourcen/10_Reference/10_Kontakte");
  });
  it("normalizes folder slashes", () => {
    const r = validateProfile({ ...defaultContactProfile(), folder: "/Kontakte/" });
    expect(r.ok && r.profile.folder).toBe("Kontakte");
  });
  it("rejects missing id/kind, bad kind, non-string mapping, duplicate identity key, fm key colliding with identity", () => {
    const base = defaultContactProfile();
    expect(validateProfile({ ...base, id: "" }).ok).toBe(false);
    expect(validateProfile({ ...base, kind: "task" }).ok).toBe(false);
    expect(validateProfile({ ...base, fields: { fn: 3 } }).ok).toBe(false);
    expect(validateProfile({ ...base, etagField: "dav_uid" }).ok).toBe(false);
    const r = validateProfile({ ...base, fields: { ...base.fields, fn: "dav_uid" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/dav_uid/);
  });
  it("rejects non-object and missing template", () => {
    expect(validateProfile(null).ok).toBe(false);
    expect(validateProfile({ ...defaultEventProfile(), filename: "" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rot sehen** — `npx vitest run tests/core/mirror/profile.test.ts` → FAIL.

- [ ] **Step 3: Implementieren**

`src/core/mirror/profile.ts`:
```ts
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
  if (!rawFields || typeof rawFields !== "object") errors.push("fields fehlt");
  else for (const [k, v] of Object.entries(rawFields as Record<string, unknown>)) {
    if (v === null || v === "") { fields[k] = null; continue; }
    if (typeof v !== "string") { errors.push(`fields.${k} muss String oder null sein`); continue; }
    if (idVals.includes(v)) errors.push(`fields.${k} kollidiert mit Identitäts-Feld ${v}`);
    fields[k] = v;
  }
  const onCreate: Record<string, FmVal> = {};
  const rawOn = o["onCreate"];
  if (rawOn && typeof rawOn === "object") for (const [k, v] of Object.entries(rawOn as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || (Array.isArray(v) && v.every((x) => typeof x === "string"))) onCreate[k] = v as FmVal;
    else errors.push(`onCreate.${k} hat unzulässigen Typ`);
  }
  const body = o["body"] === "none" ? "none" : "block";
  const attendeeLinks = o["attendeeLinks"] !== false;
  if (errors.length) return { ok: false, errors };
  return { ok: true, profile: { id, name, kind: kind as ProfileKind, folder: normFolder(folderRaw), filename, ...ids, fields, onCreate, body, attendeeLinks } };
}
```

- [ ] **Step 4: Grün + Commit** — `npx vitest run tests/core/mirror && npm run check:pure`; `git commit -m "feat(mirror): Mapping-Profile — Typ, Defaults, Validierung, Key-Auflösung"`.

---

### Task 2: Verwaltete Werte aus Server-Objekten ableiten (+ Attendee-Links)

**Files:**
- Create: `src/core/mirror/fields.ts`
- Test: `tests/core/mirror/fields.test.ts`

**Interfaces:**
```ts
export type ManagedValues = Record<string, FmVal | null>;   // serverField → Wert; null = leer
export function contactValues(c: ContactData): ManagedValues
export interface AttendeeResolver { (email: string): { path: string; display?: string } | undefined }
export function eventValues(e: EventData, opts?: { resolveAttendee?: AttendeeResolver; attendeeLinks?: boolean }): ManagedValues
export function toFrontmatter(values: ManagedValues, p: MappingProfile): { set: Record<string, FmVal>; unset: string[] }
  // set = gemappte nicht-null Werte; unset = gemappte Keys mit null-Wert; ungemappte (null im Profil) ignoriert
export function formatAddress(a: Address): string           // "Straße, PLZ Ort, Region, Land" — leere Teile weggelassen, Komma-getrennt
export function isOnline(e: Pick<EventData,"location"|"url">): boolean
```
Regeln: `contactValues`: `fn`, `given`/`family` aus `n`, `nickname`, `email` = primaryEmail, `email_home`/`email_work` = erste mit Typ, `tel_cell`/`tel_home`/`tel_work` = primaryTel(kind), `org` = org.join(" / "), `title`, `role`, `url` = erste URL, `adr` = formatAddress(pref ?? erste), `bday`, `note`, `categories` (Array oder null wenn leer), `photo` = `"vorhanden"` wenn data/uri, sonst null. `eventValues`: `title`=summary, `start`, `end`, `allday`, `tzid`, `location`, `url`, `online`=isOnline, `description`, `status`, `rrule`, `attendees` = Array aus `"[[path|Name]]"` (aufgelöst) bzw. `"Name <email>"`/`"email"`, `organizer` analog (String), `categories`, `last_modified`. `isOnline`: location oder url enthält `https?://` **oder** eines von `zoom|meet\.|teams|jitsi|webex|bbb` (case-insensitiv).

- [ ] **Step 1: Tests**

`tests/core/mirror/fields.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contactValues, eventValues, toFrontmatter, formatAddress, isOnline } from "../../../src/core/mirror/fields";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";

const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");

describe("contactValues", () => {
  it("v3-full", () => {
    const v = contactValues(parseContact(fx("vcard", "v3-full.vcf")));
    expect(v).toMatchObject({ fn: "Dr. Florian Brandes", given: "Florian", family: "Brandes", nickname: "Flo", email: "praxis@example.test", email_home: "flo@example.test", email_work: "praxis@example.test",
      tel_cell: "+49 171 1234567", tel_work: "+49 821 555 0", org: "MVZ am Marktplatz / Allgemeinmedizin", title: "Hausarzt", url: "https://mvz.example.test",
      adr: "Marktplatz 1, 86150 Augsburg, Deutschland", bday: "1975-04-12", note: "Blutbild nur vormittags, Karte mitbringen", categories: ["arzt", "gesundheit"], photo: "vorhanden" });
    expect(v["tel_home"]).toBeNull();
    expect(v["role"]).toBeNull();
  });
  it("v4-min: missing fields are null, not undefined", () => {
    const v = contactValues(parseContact(fx("vcard", "v4-min.vcf")));
    expect(v["org"]).toBeNull(); expect(v["adr"]).toBeNull(); expect(v["categories"]).toBeNull();
    expect(v["tel_cell"]).toBe("+34696386907");
  });
});
describe("formatAddress / isOnline", () => {
  it("formats sparse address", () => {
    expect(formatAddress({ types: [], pref: false, city: "Augsburg", country: "DE" })).toBe("Augsburg, DE");
  });
  it("online heuristics", () => {
    expect(isOnline({ location: "https://meet.jit.si/x" })).toBe(true);
    expect(isOnline({ location: "Zoom-Meeting", url: undefined })).toBe(true);
    expect(isOnline({ location: "Praxis am Markt" })).toBe(false);
  });
});
describe("eventValues", () => {
  it("simple.ics", () => {
    const [e] = parseEvents(fx("ical", "simple.ics"));
    const v = eventValues(e!);
    expect(v).toMatchObject({ title: "Zahnärztin Dr. Müller", start: "2026-09-01T10:00:00", end: "2026-09-01T11:30:00", allday: false, tzid: "Europe/Berlin", location: "Praxis am Markt, Hauptstraße 1", url: "https://example.test/termin", online: true, status: "CONFIRMED", categories: ["arzt", "privat"], last_modified: "2026-08-02T09:00:00Z" });
    expect(v["rrule"]).toBeNull(); expect(v["attendees"]).toBeNull(); expect(v["organizer"]).toBeNull();
  });
  it("attendees resolved to wikilinks when resolver knows the email, else Name <email>", () => {
    const [e] = parseEvents(fx("ical", "attendees.ics"));
    const v = eventValues(e!, { resolveAttendee: (m) => (m === "alex@example.test" ? { path: "Kontakte/Alex Aguado", display: "Alex Aguado" } : undefined) });
    expect(v["attendees"]).toEqual(["[[Kontakte/Alex Aguado|Alex Aguado]]", "sam@example.test"]);
    expect(v["organizer"]).toBe("Jay Kaindl <mail@jkaindl.de>");
    const plain = eventValues(e!, { attendeeLinks: false, resolveAttendee: () => ({ path: "x" }) });
    expect(plain["attendees"]).toEqual(["Alex Aguado <alex@example.test>", "sam@example.test"]);
  });
  it("allday + rrule", () => {
    const [a] = parseEvents(fx("ical", "allday.ics")); const [r] = parseEvents(fx("ical", "recurring-exdate.ics"));
    expect(eventValues(a!)).toMatchObject({ allday: true, start: "2026-12-24", end: "2026-12-27" });
    expect(eventValues(r!)["rrule"]).toBe("FREQ=WEEKLY;BYDAY=MO;COUNT=10");
  });
});
describe("toFrontmatter", () => {
  it("maps via profile; null → unset; unmapped ignored", () => {
    const p = defaultContactProfile();
    const { set, unset } = toFrontmatter({ fn: "A", email: null, note: "x", tel_cell: "1" }, p);
    expect(set).toEqual({ title: "A", phone_mobile: "1" });
    expect(unset).toEqual(["email"]);
  });
  it("event default maps allday→all_day", () => {
    const { set } = toFrontmatter({ allday: true, title: "T" }, defaultEventProfile());
    expect(set).toEqual({ all_day: true, title: "T" });
  });
});
```

- [ ] **Step 2: Rot sehen**, **Step 3: Implementieren**

`src/core/mirror/fields.ts`:
```ts
import type { ContactData, Address } from "../vcard/contact";
import { primaryEmail, primaryTel } from "../vcard/contact";
import type { EventData, Attendee } from "../ical/event";
import { fmKeyFor, type FmVal, type MappingProfile } from "./profile";

export type ManagedValues = Record<string, FmVal | null>;
export interface AttendeeResolver { (email: string): { path: string; display?: string } | undefined }

const nz = (s: string | undefined): string | null => (s && s.length > 0 ? s : null);
const list = (a: string[] | undefined): string[] | null => (a && a.length > 0 ? a : null);

export function formatAddress(a: Address): string {
  const cityLine = [a.zip, a.city].filter((x) => x && x.length).join(" ");
  return [a.street, cityLine, a.region, a.country].filter((x): x is string => !!x && x.length > 0).join(", ");
}

export function contactValues(c: ContactData): ManagedValues {
  const typed = (kind: string) => c.emails.find((e) => e.types.includes(kind))?.value;
  const adr = c.adrs.find((a) => a.pref) ?? c.adrs[0];
  return {
    fn: nz(c.fn), given: nz(c.n?.given), family: nz(c.n?.family), nickname: nz(c.nickname),
    email: nz(primaryEmail(c)), email_home: nz(typed("home")), email_work: nz(typed("work")),
    tel_cell: nz(primaryTel(c, "cell")), tel_home: nz(primaryTel(c, "home")), tel_work: nz(primaryTel(c, "work")),
    org: c.org && c.org.length ? c.org.join(" / ") : null, title: nz(c.title), role: nz(c.role),
    url: nz(c.urls[0]?.value), adr: adr ? nz(formatAddress(adr)) : null, bday: nz(c.bday), note: nz(c.note),
    categories: list(c.categories), photo: c.photo && (c.photo.data || c.photo.uri) ? "vorhanden" : null,
  };
}

const ONLINE_RE = /https?:\/\/|zoom|meet\.|teams|jitsi|webex|\bbbb\b/i;
export function isOnline(e: Pick<EventData, "location" | "url">): boolean {
  return ONLINE_RE.test(e.location ?? "") || ONLINE_RE.test(e.url ?? "");
}

function attendeeText(a: Attendee, opts: { resolveAttendee?: AttendeeResolver; attendeeLinks?: boolean }): string {
  if (opts.attendeeLinks !== false && opts.resolveAttendee) {
    const hit = opts.resolveAttendee(a.email);
    if (hit) return `[[${hit.path}|${hit.display ?? a.name ?? a.email}]]`;
  }
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function eventValues(e: EventData, opts: { resolveAttendee?: AttendeeResolver; attendeeLinks?: boolean } = {}): ManagedValues {
  return {
    title: nz(e.summary), start: e.start, end: nz(e.end), allday: e.allDay, tzid: nz(e.tzid),
    location: nz(e.location), url: nz(e.url), online: isOnline(e), description: nz(e.description), status: nz(e.status),
    rrule: nz(e.rrule), attendees: e.attendees.length ? e.attendees.map((a) => attendeeText(a, opts)) : null,
    organizer: e.organizer ? attendeeText(e.organizer, opts) : null, categories: list(e.categories), last_modified: nz(e.lastModified),
  };
}

export function toFrontmatter(values: ManagedValues, p: MappingProfile): { set: Record<string, FmVal>; unset: string[] } {
  const set: Record<string, FmVal> = {}; const unset: string[] = [];
  for (const [field, val] of Object.entries(values)) {
    const key = fmKeyFor(p, field);
    if (!key) continue;
    if (val === null) unset.push(key); else set[key] = val;
  }
  return { set, unset };
}
```

- [ ] **Step 4: Grün + Commit** — `feat(mirror): verwaltete Werte aus Kontakt/Termin + Attendee-Wikilinks + Profil-Mapping`.

---

### Task 3: Body-Block (rendern, splitten, mergen)

**Files:**
- Create: `src/core/mirror/body.ts`
- Test: `tests/core/mirror/body.test.ts`

**Interfaces:**
```ts
export const BLOCK_BEGIN = "%% dav:begin %%"; export const BLOCK_END = "%% dav:end %%";
export function renderContactBlock(c: ContactData): string   // "" wenn nichts zu zeigen
export function renderEventBlock(e: EventData): string
export function splitBody(body: string): { before: string; block: string | null; after: string }  // block = Inhalt OHNE Marker; null wenn keine Marker
export function mergeBody(existing: string, block: string, mode: "block" | "none"): string
export function userContent(body: string): string            // before + after, getrimmt — "" = Notiz hat keinen freien Inhalt
```
Regeln `mergeBody`: `mode:"none"` → `existing` unverändert. Marker vorhanden → Inhalt ersetzen; leerer `block` → Marker + Inhalt komplett entfernen (inkl. genau einer umgebenden Leerzeile, wenn vorhanden). Keine Marker und `block` nicht leer → an das Ende anhängen: `existing.trimEnd() + "\n\n" + BLOCK_BEGIN + "\n" + block + "\n" + BLOCK_END + "\n"` (bei leerem `existing` ohne führende Leerzeilen). Keine Marker und leerer `block` → `existing` unverändert. Mehrere Marker-Paare: nur das erste wird verwaltet.
`renderContactBlock`: Zeilen „**Notiz:** …" (note), weitere E-Mails/Telefone (alle außer den in fields gespiegelten — einfach: **alle** typisiert auflisten: `- 📧 work: praxis@…`), Adressen (`- 📍 work: …`), URLs, „📷 Foto vorhanden". `renderEventBlock`: description (roh, Zeilen erhalten), dann `**Teilnehmer:innen:**` Liste `- Name <email> · ACCEPTED`, `**Organisator:in:** …`, `**Link:** url`.

- [ ] **Step 1: Tests**

`tests/core/mirror/body.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BLOCK_BEGIN, BLOCK_END, renderContactBlock, renderEventBlock, splitBody, mergeBody, userContent } from "../../../src/core/mirror/body";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";
const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");
const wrap = (inner: string) => `${BLOCK_BEGIN}\n${inner}\n${BLOCK_END}`;

describe("splitBody", () => {
  it("no markers", () => { expect(splitBody("hallo\n")).toEqual({ before: "hallo\n", block: null, after: "" }); });
  it("markers in the middle", () => {
    const b = `# Titel\n\n${wrap("inhalt\nzeile2")}\n\nmeine notizen\n`;
    expect(splitBody(b)).toEqual({ before: "# Titel\n\n", block: "inhalt\nzeile2", after: "\n\nmeine notizen\n" });
  });
  it("only first pair is managed", () => {
    const b = `${wrap("a")}\n${wrap("b")}`;
    expect(splitBody(b).block).toBe("a");
    expect(splitBody(b).after).toBe(`\n${wrap("b")}`);
  });
});
describe("mergeBody", () => {
  it("none → unchanged", () => { expect(mergeBody("x", "neu", "none")).toBe("x"); });
  it("append when missing", () => {
    expect(mergeBody("Meine Notiz\n", "B", "block")).toBe(`Meine Notiz\n\n${wrap("B")}\n`);
    expect(mergeBody("", "B", "block")).toBe(`${wrap("B")}\n`);
  });
  it("replace when present, preserving outside", () => {
    const before = `# T\n\n${wrap("alt")}\n\nfrei\n`;
    expect(mergeBody(before, "neu", "block")).toBe(`# T\n\n${wrap("neu")}\n\nfrei\n`);
  });
  it("empty block removes existing block, keeps user text", () => {
    expect(mergeBody(`# T\n\n${wrap("alt")}\n\nfrei\n`, "", "block")).toBe("# T\n\nfrei\n");
    expect(mergeBody("nur text\n", "", "block")).toBe("nur text\n");
  });
  it("idempotent", () => {
    const once = mergeBody("x\n", "B", "block");
    expect(mergeBody(once, "B", "block")).toBe(once);
  });
});
describe("userContent", () => {
  it("ignores the block", () => {
    expect(userContent(`\n${wrap("x")}\n`)).toBe("");
    expect(userContent(`hallo\n${wrap("x")}\n`)).toBe("hallo");
  });
});
describe("render", () => {
  it("contact block lists note, typed channels, address, url, photo", () => {
    const b = renderContactBlock(parseContact(fx("vcard", "v3-full.vcf")));
    expect(b).toContain("Blutbild nur vormittags, Karte mitbringen");
    expect(b).toContain("praxis@example.test");
    expect(b).toContain("+49 821 555 0");
    expect(b).toContain("Marktplatz 1");
    expect(b).toContain("https://mvz.example.test");
    expect(b).toContain("Foto");
    expect(b).not.toContain("/9j/");              // nie Base64 in die Notiz
  });
  it("empty contact → empty block", () => {
    expect(renderContactBlock({ uid: "u", version: "3.0", fn: "X", emails: [], tels: [], urls: [], adrs: [], categories: [] })).toBe("");
  });
  it("event block: description, attendees with partstat, organizer, link", () => {
    const [e] = parseEvents(fx("ical", "attendees.ics"));
    const b = renderEventBlock(e!);
    expect(b).toContain("Alex Aguado <alex@example.test> · ACCEPTED");
    expect(b).toContain("sam@example.test · NEEDS-ACTION");
    expect(b).toContain("Jay Kaindl <mail@jkaindl.de>");
    const [s] = parseEvents(fx("ical", "simple.ics"));
    expect(renderEventBlock(s!)).toContain("Kontrolle\nBitte Karte mitbringen");
    expect(renderEventBlock(s!)).toContain("https://example.test/termin");
  });
});
```

- [ ] **Step 2: Rot sehen**, **Step 3: Implementieren**

`src/core/mirror/body.ts`:
```ts
import type { ContactData } from "../vcard/contact";
import type { EventData, Attendee } from "../ical/event";
import { formatAddress } from "./fields";

export const BLOCK_BEGIN = "%% dav:begin %%";
export const BLOCK_END = "%% dav:end %%";

export function splitBody(body: string): { before: string; block: string | null; after: string } {
  const i = body.indexOf(BLOCK_BEGIN);
  if (i < 0) return { before: body, block: null, after: "" };
  const j = body.indexOf(BLOCK_END, i + BLOCK_BEGIN.length);
  if (j < 0) return { before: body, block: null, after: "" };
  const inner = body.slice(i + BLOCK_BEGIN.length, j);
  const block = inner.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { before: body.slice(0, i), block, after: body.slice(j + BLOCK_END.length) };
}

export function userContent(body: string): string {
  const { before, after } = splitBody(body);
  return `${before}${after}`.trim();
}

export function mergeBody(existing: string, block: string, mode: "block" | "none"): string {
  if (mode === "none") return existing;
  const wrapped = `${BLOCK_BEGIN}\n${block}\n${BLOCK_END}`;
  const parts = splitBody(existing);
  if (parts.block === null) {
    if (block === "") return existing;
    const head = existing.trimEnd();
    return head.length ? `${head}\n\n${wrapped}\n` : `${wrapped}\n`;
  }
  if (block === "") {
    // Block samt genau einer umgebenden Leerzeile entfernen
    const before = parts.before.replace(/\n\n$/, "\n");
    const after = parts.after.replace(/^\n\n/, "\n");
    const joined = `${before}${after}`;
    return joined.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
  }
  return `${parts.before}${wrapped}${parts.after}`;
}

function att(a: Attendee): string {
  const who = a.name ? `${a.name} <${a.email}>` : a.email;
  return a.partstat ? `${who} · ${a.partstat}` : who;
}

export function renderEventBlock(e: EventData): string {
  const lines: string[] = [];
  if (e.description) lines.push(e.description.trim());
  if (e.attendees.length) { lines.push("", "**Teilnehmer:innen:**", ...e.attendees.map((a) => `- ${att(a)}`)); }
  if (e.organizer) lines.push("", `**Organisator:in:** ${att({ ...e.organizer })}`);
  if (e.url) lines.push("", `**Link:** ${e.url}`);
  return lines.join("\n").replace(/^\n+/, "").trim();
}

export function renderContactBlock(c: ContactData): string {
  const lines: string[] = [];
  if (c.note) lines.push(`**Notiz:** ${c.note}`);
  const typed = (icon: string, xs: { value: string; types: string[]; pref: boolean }[]) =>
    xs.map((x) => `- ${icon} ${x.types.length ? x.types.join("/") : "—"}${x.pref ? " ★" : ""}: ${x.value}`);
  const channels = [...typed("📧", c.emails), ...typed("📞", c.tels), ...typed("🔗", c.urls)];
  if (channels.length) lines.push(...(lines.length ? [""] : []), ...channels);
  const adrs = c.adrs.map((a) => `- 📍 ${a.types.length ? a.types.join("/") : "—"}: ${formatAddress(a)}`);
  if (adrs.length) lines.push(...(lines.length ? [""] : []), ...adrs);
  if (c.photo && (c.photo.data || c.photo.uri)) lines.push(...(lines.length ? [""] : []), "📷 Foto vorhanden (auf dem Server)");
  return lines.join("\n").trim();
}
```

- [ ] **Step 4: Grün + Commit** — `feat(mirror): verwalteter Body-Block — rendern, splitten, mergen (Nutzerinhalt bleibt)`.

---

### Task 4: Dateiname und Hash

**Files:**
- Create: `src/core/mirror/filename.ts`, `src/core/mirror/hash.ts`
- Test: `tests/core/mirror/filename.test.ts`, `tests/core/mirror/hash.test.ts`

**Interfaces:**
```ts
// filename.ts
export function filenameSubs(kind: "contact"|"event", data: ContactData | EventData): Record<string, string>
  // contact: fn, family, given, org (erstes), uid · event: title, start_date (YYYY-MM-DD), start_time (HH-mm oder "" bei allday), uid
export function noteBasename(profile: MappingProfile, data: ContactData | EventData): string   // ohne ".md", via buildFilename(template, subs, { fallbacks: ["{uid}"], lastResort: "dav-object" }), max 120 Zeichen
export function notePath(profile: MappingProfile, basename: string, suffix?: number): string   // `${folder}/${basename}${suffix ? ` (${suffix})` : ""}.md` (folder "" → ohne Slash)
// hash.ts
export function managedHash(set: Record<string, FmVal>, unset: string[], block: string | null): string   // sha256HexUtf8(JSON kanonisch: {set: sortierte Keys, unset: sortiert, block})
export function fmEquals(a: unknown, b: unknown): boolean   // normalisiert: Zahlen/Bools vs. Strings ("true"=="true"), Arrays elementweise, sonst String(v)
```

- [ ] **Step 1: Tests**

`tests/core/mirror/filename.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { filenameSubs, noteBasename, notePath } from "../../../src/core/mirror/filename";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";
const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");

describe("filename", () => {
  it("contact default {fn}", () => {
    const c = parseContact(fx("vcard", "v3-full.vcf"));
    expect(filenameSubs("contact", c)).toMatchObject({ fn: "Dr. Florian Brandes", family: "Brandes", given: "Florian", org: "MVZ am Marktplatz", uid: "c3-1@test" });
    expect(noteBasename(defaultContactProfile(), c)).toBe("Dr. Florian Brandes");
  });
  it("event default {start_date} {title}; invalid chars replaced; allday has empty start_time", () => {
    const [e] = parseEvents(fx("ical", "simple.ics"));
    expect(noteBasename(defaultEventProfile(), e!)).toBe("2026-09-01 Zahnärztin Dr. Müller");
    const [a] = parseEvents(fx("ical", "allday.ics"));
    expect(filenameSubs("event", a!)).toMatchObject({ start_date: "2026-12-24", start_time: "" });
    const weird = { ...e!, summary: "A/B: C?" };
    expect(noteBasename(defaultEventProfile(), weird)).not.toMatch(/[/:?]/);
  });
  it("falls back to uid when template renders empty; last resort", () => {
    const c = parseContact("BEGIN:VCARD\nVERSION:3.0\nUID:u-1\nFN:\nEND:VCARD");
    expect(noteBasename(defaultContactProfile(), c)).toBe("u-1");
  });
  it("notePath", () => {
    const p = { ...defaultContactProfile(), folder: "A/B" };
    expect(notePath(p, "X")).toBe("A/B/X.md");
    expect(notePath(p, "X", 2)).toBe("A/B/X (2).md");
    expect(notePath({ ...p, folder: "" }, "X")).toBe("X.md");
  });
});
```
`tests/core/mirror/hash.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { managedHash, fmEquals } from "../../../src/core/mirror/hash";
describe("managedHash", () => {
  it("order-independent and block-sensitive", () => {
    expect(managedHash({ a: 1, b: "x" }, ["c"], "blk")).toBe(managedHash({ b: "x", a: 1 }, ["c"], "blk"));
    expect(managedHash({ a: 1 }, [], "blk")).not.toBe(managedHash({ a: 1 }, [], "other"));
    expect(managedHash({ a: 1 }, [], null)).toMatch(/^[0-9a-f]{64}$/);
  });
});
describe("fmEquals", () => {
  it("normalizes scalars and arrays", () => {
    expect(fmEquals(true, "true")).toBe(true);
    expect(fmEquals(1, "1")).toBe(true);
    expect(fmEquals(["a", "b"], ["a", "b"])).toBe(true);
    expect(fmEquals(["a"], "a")).toBe(false);
    expect(fmEquals(undefined, null)).toBe(true);
    expect(fmEquals("x", undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Rot sehen**, **Step 3: Implementieren**

`src/core/mirror/filename.ts`:
```ts
import { buildFilename } from "../../vendor/code-kit/filename-template";
import type { ContactData } from "../vcard/contact";
import type { EventData } from "../ical/event";
import type { MappingProfile } from "./profile";

export function filenameSubs(kind: "contact" | "event", data: ContactData | EventData): Record<string, string> {
  if (kind === "contact") {
    const c = data as ContactData;
    return { fn: c.fn ?? "", family: c.n?.family ?? "", given: c.n?.given ?? "", org: c.org?.[0] ?? "", uid: c.uid };
  }
  const e = data as EventData;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(e.start);
  return { title: e.summary ?? "", start_date: m?.[1] ?? "", start_time: m?.[2] ? `${m[2]}-${m[3]}` : "", uid: e.uid };
}

export function noteBasename(profile: MappingProfile, data: ContactData | EventData): string {
  const name = buildFilename(profile.filename, filenameSubs(profile.kind, data), { fallbacks: ["{uid}"], lastResort: "dav-object" });
  return name.length > 120 ? name.slice(0, 120).trim() : name;
}

export function notePath(profile: MappingProfile, basename: string, suffix?: number): string {
  const file = `${basename}${suffix ? ` (${suffix})` : ""}.md`;
  return profile.folder ? `${profile.folder}/${file}` : file;
}
```
Prüfe die tatsächliche `buildFilename`-Signatur/Optionen in `src/vendor/code-kit/filename-template.ts` (Platzhalter-Syntax `{key}`, `fallbacks`, `lastResort`) und ob sie `/`, `:`, `?` ersetzt — der Test „not.toMatch(/[/:?]/)" ist Maßstab; wenn das Kit `:` nicht als ungültig führt, zusätzlich lokal `.replace(/[:?]/g, "_")` vor dem Rückgabewert anwenden und im Report erwähnen.

`src/core/mirror/hash.ts`:
```ts
import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";
import type { FmVal } from "./profile";

export function managedHash(set: Record<string, FmVal>, unset: string[], block: string | null): string {
  const sortedSet: Record<string, FmVal> = {};
  for (const k of Object.keys(set).sort()) sortedSet[k] = set[k] as FmVal;
  return sha256HexUtf8(JSON.stringify({ set: sortedSet, unset: [...unset].sort(), block }));
}

function norm(v: unknown): string | string[] | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map((x) => String(x));
  return String(v);
}
export function fmEquals(a: unknown, b: unknown): boolean {
  const x = norm(a), y = norm(b);
  if (Array.isArray(x) || Array.isArray(y)) return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i]);
  return x === y;
}
```

- [ ] **Step 4: Grün + Commit** — `feat(mirror): Dateiname (Kit-Template) und Hash/Vergleich verwalteter Werte`.

---

### Task 5: Zeitfenster und Wiederholungs-Prüfung

**Files:**
- Create: `src/core/ical/recur.ts`, `src/core/mirror/window.ts`
- Test: `tests/core/ical/recur.test.ts`, `tests/core/mirror/window.test.ts`

**Interfaces:**
```ts
// recur.ts
export function eventOccursWithin(ics: string, rangeStart: Date, rangeEnd: Date, opts?: { maxIterations?: number }): boolean
  // nicht wiederkehrend: Intervall [DTSTART, DTEND||DTSTART] schneidet [rangeStart, rangeEnd]; allday: DTEND exklusiv
  // wiederkehrend: ICAL.Event.iterator() ab DTSTART; jede Occurrence (mit Dauer) gegen Range prüfen; Abbruch bei Occurrence-Start > rangeEnd oder maxIterations (Default 2000); EXDATE von ical.js berücksichtigt
  // Overrides (RECURRENCE-ID im selben VCALENDAR) zählen mit ihrem eigenen DTSTART
// window.ts
export interface Window { start: Date; end: Date }
export function windowFor(now: Date, pastDays: number, futureDays: number): Window   // start = now - past (00:00 UTC des Tages), end = now + future (23:59:59 UTC)
export function toDavTimeRange(w: Window): { start: string; end: string }            // "YYYYMMDDTHHMMSSZ"
```

- [ ] **Step 1: Tests**

`tests/core/ical/recur.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { eventOccursWithin } from "../../../src/core/ical/recur";
const fx = (n: string) => readFileSync(new URL(`../../fixtures/ical/${n}`, import.meta.url), "utf8");
const d = (s: string) => new Date(s);

describe("eventOccursWithin", () => {
  it("single event inside/outside", () => {
    const ics = fx("simple.ics");   // 2026-09-01 10:00 Europe/Berlin
    expect(eventOccursWithin(ics, d("2026-08-01T00:00:00Z"), d("2026-09-30T00:00:00Z"))).toBe(true);
    expect(eventOccursWithin(ics, d("2026-10-01T00:00:00Z"), d("2026-12-31T00:00:00Z"))).toBe(false);
  });
  it("allday: DTEND exclusive", () => {
    const ics = fx("allday.ics");   // 24.–26.12.
    expect(eventOccursWithin(ics, d("2026-12-26T00:00:00Z"), d("2026-12-26T23:59:59Z"))).toBe(true);
    expect(eventOccursWithin(ics, d("2026-12-27T00:00:00Z"), d("2026-12-31T00:00:00Z"))).toBe(false);
  });
  it("recurring weekly COUNT=10 from 2026-09-07, EXDATE 09-21", () => {
    const ics = fx("recurring-exdate.ics");
    expect(eventOccursWithin(ics, d("2026-10-10T00:00:00Z"), d("2026-10-13T00:00:00Z"))).toBe(true);   // 12.10.
    expect(eventOccursWithin(ics, d("2026-09-20T00:00:00Z"), d("2026-09-22T00:00:00Z"))).toBe(false);  // EXDATE
    expect(eventOccursWithin(ics, d("2027-01-01T00:00:00Z"), d("2027-12-31T00:00:00Z"))).toBe(false);  // nach COUNT
  });
  it("infinite rrule terminates via range", () => {
    const ics = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:inf\nDTSTART:20260101T080000Z\nDTEND:20260101T090000Z\nRRULE:FREQ=DAILY\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR";
    expect(eventOccursWithin(ics, d("2030-05-05T00:00:00Z"), d("2030-05-06T00:00:00Z"))).toBe(true);
    expect(eventOccursWithin(ics, d("2025-01-01T00:00:00Z"), d("2025-12-31T00:00:00Z"))).toBe(false);
  });
  it("override counts with its own start", () => {
    const ics = fx("override.ics");   // master daily 09-01..05 07:00Z; override 09-03 moved to 09:00Z
    expect(eventOccursWithin(ics, d("2026-09-03T08:30:00Z"), d("2026-09-03T10:00:00Z"))).toBe(true);
  });
});
```
`tests/core/mirror/window.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { windowFor, toDavTimeRange } from "../../../src/core/mirror/window";
describe("window", () => {
  it("computes start/end at day bounds (UTC)", () => {
    const w = windowFor(new Date("2026-08-22T15:30:00Z"), 90, 365);
    expect(w.start.toISOString()).toBe("2026-05-24T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-08-22T23:59:59.000Z");
  });
  it("toDavTimeRange", () => {
    expect(toDavTimeRange({ start: new Date("2026-05-24T00:00:00Z"), end: new Date("2027-08-22T23:59:59Z") })).toEqual({ start: "20260524T000000Z", end: "20270822T235959Z" });
  });
});
```

- [ ] **Step 2: Rot sehen**, **Step 3: Implementieren**

`src/core/ical/recur.ts`:
```ts
import ICAL from "ical.js";

function toJs(t: ICAL.Time): Date { return t.toJSDate(); }

function intervalOverlaps(start: Date, end: Date, rs: Date, re: Date, exclusiveEnd: boolean): boolean {
  const e = exclusiveEnd ? end.getTime() - 1 : end.getTime();
  return start.getTime() <= re.getTime() && e >= rs.getTime();
}

export function eventOccursWithin(ics: string, rangeStart: Date, rangeEnd: Date, opts: { maxIterations?: number } = {}): boolean {
  const root = new ICAL.Component(ICAL.parse(ics));
  const vevents = root.name === "vevent" ? [root] : root.getAllSubcomponents("vevent");
  const max = opts.maxIterations ?? 2000;
  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    const durMs = Math.max(0, toJs(ev.endDate).getTime() - toJs(ev.startDate).getTime());
    const isDate = ev.startDate.isDate;
    if (!ev.isRecurring()) {
      const s = toJs(ev.startDate);
      if (intervalOverlaps(s, new Date(s.getTime() + durMs), rangeStart, rangeEnd, isDate && durMs > 0)) return true;
      continue;
    }
    const it = ev.iterator();
    let n = 0; let next: ICAL.Time | null;
    while ((next = it.next()) && n++ < max) {
      const s = toJs(next);
      if (s.getTime() > rangeEnd.getTime()) break;
      if (intervalOverlaps(s, new Date(s.getTime() + durMs), rangeStart, rangeEnd, isDate && durMs > 0)) return true;
    }
  }
  return false;
}
```
Hinweise: `ICAL.Event.isRecurring()`, `iterator()` (RecurExpansion, berücksichtigt EXDATE) und `endDate` (aus DTEND oder DURATION, sonst = start) stehen in `node_modules/ical.js/dist/types/event.d.ts`. Eine Override-Komponente (RECURRENCE-ID) ist selbst nicht „recurring" → Einzelfall-Zweig. Falls `ev.endDate` bei einem Override ohne DTEND wirft, auf `startDate` zurückfallen (try/catch lokal). Die Zeitzonen-Umrechnung `toJSDate()` nutzt die Zone des `ICAL.Time`; für TZID-Zeiten ohne registrierte VTIMEZONE behandelt ical.js die Zeit als floating (lokal) — für die Fensterprüfung ist eine Stunde Unschärfe unerheblich (Fenster ist tagesbasiert).

`src/core/mirror/window.ts`:
```ts
export interface Window { start: Date; end: Date }
const DAY = 86_400_000;
export function windowFor(now: Date, pastDays: number, futureDays: number): Window {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(dayStart - pastDays * DAY), end: new Date(dayStart + futureDays * DAY + DAY - 1000) };
}
const pad = (n: number) => String(n).padStart(2, "0");
function fmt(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
export function toDavTimeRange(w: Window): { start: string; end: string } { return { start: fmt(w.start), end: fmt(w.end) }; }
```

- [ ] **Step 4: Grün + Commit** — `feat(mirror): Zeitfenster + Wiederholungsprüfung über ical.js`.

---

### Task 6: Notiz-Plan (upsert / removal / archive)

**Files:**
- Create: `src/core/mirror/plan.ts`
- Test: `tests/core/mirror/plan.test.ts`

**Interfaces:**
```ts
export interface ExistingNote { path: string; frontmatter: Record<string, unknown>; body: string }
export type NotePlan =
  | { op: "create"; path: string; uid: string; recurrenceId?: string; frontmatter: Record<string, FmVal>; body: string; written: Record<string, FmVal>; hash: string }
  | { op: "update"; path: string; uid: string; recurrenceId?: string; set: Record<string, FmVal>; unset: string[]; body?: string; written: Record<string, FmVal>; hash: string; handEdited: string[] }
  | { op: "skip"; path: string; uid: string; recurrenceId?: string; reason: "unchanged" | "already-archived" | "already-deleted" }
  | { op: "archive"; path: string; uid: string; set: Record<string, FmVal> }          // set = { [stateField]: "archived" }
  | { op: "delete"; path: string; uid: string; mode: "trash" | "mark"; set?: Record<string, FmVal> }  // mark: set = { [stateField]: "deleted" }
export interface UpsertInput {
  profile: MappingProfile; source: string; uid: string; recurrenceId?: string; etag: string;
  values: ManagedValues; block: string;           // aus fields.ts / body.ts (Aufrufer rechnet sie, damit plan.ts daten-agnostisch bleibt)
  path: string;                                   // Ziel-Pfad bei Neuanlage (Aufrufer hat Kollisionen aufgelöst)
  existing?: ExistingNote; prevWritten?: Record<string, FmVal>; state?: "live" | "archived";
}
export function planUpsert(i: UpsertInput): NotePlan
export function planRemoval(profile: MappingProfile, existing: ExistingNote, opts: { hasBacklinks: boolean }): NotePlan
export function planArchive(profile: MappingProfile, existing: ExistingNote): NotePlan
```
Regeln `planUpsert`:
- Identitäts-Keys immer in `set`: uidField=uid, sourceField=source, etagField=etag, stateField=state??"live"; recurrenceIdField=recurrenceId wenn vorhanden, sonst in `unset`.
- Gemappte Werte via `toFrontmatter(values, profile)` → `set`/`unset` dazu.
- `written` = `set` (die geschriebenen verwalteten Werte), `hash` = managedHash(set, unset, profile.body==="block" ? block : null).
- Kein `existing` → `create` mit `frontmatter = { ...profile.onCreate, ...set }` (verwaltete gewinnen), `body = mergeBody("", block, profile.body)`.
- Mit `existing`: `handEdited` = Keys aus `prevWritten`, deren Wert in `existing.frontmatter` nicht `fmEquals` zum `prevWritten`-Wert ist (nur wenn `prevWritten` gegeben). Dann: effektives `set` = nur Keys, deren Wert in `existing.frontmatter` abweicht (fmEquals) — reines Rauschen vermeiden; effektives `unset` = nur Keys, die in `existing.frontmatter` vorhanden sind. Neuer Body = `mergeBody(existing.body, block, profile.body)`; `body` nur, wenn ≠ existing.body. Wenn effektives set leer, unset leer und body unverändert → `skip/unchanged`. Sonst `update` (mit vollem `written`/`hash`).
- Notiz existiert, aber `existing.frontmatter[stateField] === "deleted"` und Server liefert das Objekt wieder → normal `update` (state wird `live`).
`planRemoval`: `stateField === "deleted"` schon → `skip/already-deleted`; `hasBacklinks || userContent(existing.body) !== ""` → `delete/mark` mit `set`; sonst `delete/trash`.
`planArchive`: schon `archived` → `skip/already-archived`; sonst `archive`.

- [ ] **Step 1: Tests**

`tests/core/mirror/plan.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { planUpsert, planRemoval, planArchive } from "../../../src/core/mirror/plan";
import { defaultContactProfile } from "../../../src/core/mirror/profile";
import { BLOCK_BEGIN, BLOCK_END } from "../../../src/core/mirror/body";

const p = defaultContactProfile();
const base = { profile: p, source: "acc/kontakte", uid: "u1", etag: '"e1"', values: { fn: "Kim Test", email: "kim@example.test", tel_cell: null }, block: "- 📧 —: kim@example.test", path: "Contacts/Kim Test.md" };
const wrap = (s: string) => `${BLOCK_BEGIN}\n${s}\n${BLOCK_END}\n`;

describe("planUpsert", () => {
  it("create: onCreate + identity + mapped; body block", () => {
    const pl = planUpsert(base);
    expect(pl.op).toBe("create");
    if (pl.op !== "create") return;
    expect(pl.path).toBe("Contacts/Kim Test.md");
    expect(pl.frontmatter).toEqual({ type: "contact", dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e1"', dav_state: "live", title: "Kim Test", email: "kim@example.test" });
    expect(pl.body).toBe(wrap("- 📧 —: kim@example.test"));
    expect(pl.written).toEqual({ dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e1"', dav_state: "live", title: "Kim Test", email: "kim@example.test" });
    expect(pl.hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("create: managed wins over onCreate on collision; body none", () => {
    const pl = planUpsert({ ...base, profile: { ...p, body: "none", onCreate: { type: "x", title: "ignored" } } });
    if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["title"]).toBe("Kim Test");
    expect(pl.body).toBe("");
  });
  it("update: only differing keys, unset only present keys, free keys untouched, body merged", () => {
    const existing = { path: "Contacts/Kim Test.md", frontmatter: { type: "👤 Kontakt", bereich: "privat", dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e0"', dav_state: "live", title: "Kim Test", email: "alt@example.test", phone_mobile: "123" }, body: `Meine Notizen\n\n${wrap("alt")}` };
    const pl = planUpsert({ ...base, existing });
    if (pl.op !== "update") throw new Error(pl.op);
    expect(pl.set).toEqual({ dav_etag: '"e1"', email: "kim@example.test" });
    expect(pl.unset).toEqual(["phone_mobile"]);
    expect(pl.body).toBe(`Meine Notizen\n\n${wrap("- 📧 —: kim@example.test")}`);
    expect(pl.handEdited).toEqual([]);
    expect(Object.keys(pl.set)).not.toContain("bereich");
  });
  it("skip when nothing differs (same etag, same values, same block)", () => {
    const existing = { path: base.path, frontmatter: { dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e1"', dav_state: "live", title: "Kim Test", email: "kim@example.test" }, body: wrap("- 📧 —: kim@example.test") };
    expect(planUpsert({ ...base, existing }).op).toBe("skip");
  });
  it("handEdited lists managed keys the user changed since last write", () => {
    const existing = { path: base.path, frontmatter: { dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e0"', dav_state: "live", title: "Kim Test", email: "hand@example.test" }, body: "" };
    const pl = planUpsert({ ...base, existing, prevWritten: { dav_uid: "u1", dav_source: "acc/kontakte", dav_etag: '"e0"', dav_state: "live", title: "Kim Test", email: "server-old@example.test" } });
    if (pl.op !== "update") throw new Error();
    expect(pl.handEdited).toEqual(["email"]);
    expect(pl.set["email"]).toBe("kim@example.test");   // Server gewinnt (Spec §3), Hinweis via handEdited
  });
  it("recurrenceId sets the field; without it the field is unset", () => {
    const pl = planUpsert({ ...base, recurrenceId: "2026-09-03T07:00:00Z" });
    if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["dav_recurrence_id"]).toBe("2026-09-03T07:00:00Z");
    const ex = { path: base.path, frontmatter: { dav_uid: "u1", dav_recurrence_id: "x" }, body: "" };
    const up = planUpsert({ ...base, existing: ex });
    if (up.op !== "update") throw new Error();
    expect(up.unset).toContain("dav_recurrence_id");
  });
  it("state archived is written when requested", () => {
    const pl = planUpsert({ ...base, state: "archived" });
    if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["dav_state"]).toBe("archived");
  });
});
describe("planRemoval / planArchive", () => {
  const note = (fm: Record<string, unknown>, body = "") => ({ path: "Contacts/X.md", frontmatter: fm, body });
  it("trash when no backlinks and no user content", () => {
    expect(planRemoval(p, note({ dav_uid: "u" }, wrap("srv")), { hasBacklinks: false })).toEqual({ op: "delete", path: "Contacts/X.md", uid: "u", mode: "trash" });
  });
  it("mark when backlinks or user content", () => {
    expect(planRemoval(p, note({ dav_uid: "u" }, "mein text"), { hasBacklinks: false })).toMatchObject({ op: "delete", mode: "mark", set: { dav_state: "deleted" } });
    expect(planRemoval(p, note({ dav_uid: "u" }), { hasBacklinks: true })).toMatchObject({ op: "delete", mode: "mark" });
  });
  it("already deleted/archived → skip", () => {
    expect(planRemoval(p, note({ dav_uid: "u", dav_state: "deleted" }), { hasBacklinks: false })).toMatchObject({ op: "skip", reason: "already-deleted" });
    expect(planArchive(p, note({ dav_uid: "u", dav_state: "archived" }))).toMatchObject({ op: "skip", reason: "already-archived" });
    expect(planArchive(p, note({ dav_uid: "u" }))).toEqual({ op: "archive", path: "Contacts/X.md", uid: "u", set: { dav_state: "archived" } });
  });
});
```

- [ ] **Step 2: Rot sehen**, **Step 3: Implementieren**

`src/core/mirror/plan.ts`:
```ts
import type { FmVal, MappingProfile } from "./profile";
import { toFrontmatter, type ManagedValues } from "./fields";
import { mergeBody, userContent } from "./body";
import { managedHash, fmEquals } from "./hash";

export interface ExistingNote { path: string; frontmatter: Record<string, unknown>; body: string }
export type NotePlan =
  | { op: "create"; path: string; uid: string; recurrenceId?: string; frontmatter: Record<string, FmVal>; body: string; written: Record<string, FmVal>; hash: string }
  | { op: "update"; path: string; uid: string; recurrenceId?: string; set: Record<string, FmVal>; unset: string[]; body?: string; written: Record<string, FmVal>; hash: string; handEdited: string[] }
  | { op: "skip"; path: string; uid: string; recurrenceId?: string; reason: "unchanged" | "already-archived" | "already-deleted" }
  | { op: "archive"; path: string; uid: string; set: Record<string, FmVal> }
  | { op: "delete"; path: string; uid: string; mode: "trash" | "mark"; set?: Record<string, FmVal> };

export interface UpsertInput {
  profile: MappingProfile; source: string; uid: string; recurrenceId?: string; etag: string;
  values: ManagedValues; block: string; path: string;
  existing?: ExistingNote; prevWritten?: Record<string, FmVal>; state?: "live" | "archived";
}

export function planUpsert(i: UpsertInput): NotePlan {
  const p = i.profile;
  const mapped = toFrontmatter(i.values, p);
  const set: Record<string, FmVal> = { [p.uidField]: i.uid, [p.sourceField]: i.source, [p.etagField]: i.etag, [p.stateField]: i.state ?? "live", ...mapped.set };
  const unset = [...mapped.unset];
  if (i.recurrenceId) set[p.recurrenceIdField] = i.recurrenceId; else unset.push(p.recurrenceIdField);
  const written = { ...set };
  const hash = managedHash(set, unset, p.body === "block" ? i.block : null);
  const rid = i.recurrenceId ? { recurrenceId: i.recurrenceId } : {};
  if (!i.existing) {
    return { op: "create", path: i.path, uid: i.uid, ...rid, frontmatter: { ...p.onCreate, ...set }, body: mergeBody("", i.block, p.body), written, hash };
  }
  const fm = i.existing.frontmatter;
  const effSet: Record<string, FmVal> = {};
  for (const [k, v] of Object.entries(set)) if (!fmEquals(fm[k], v)) effSet[k] = v;
  const effUnset = unset.filter((k) => Object.hasOwn(fm, k) && fm[k] !== undefined);
  const newBody = mergeBody(i.existing.body, i.block, p.body);
  const bodyChanged = newBody !== i.existing.body;
  const handEdited: string[] = [];
  if (i.prevWritten) for (const [k, v] of Object.entries(i.prevWritten)) if (!fmEquals(fm[k], v)) handEdited.push(k);
  if (Object.keys(effSet).length === 0 && effUnset.length === 0 && !bodyChanged) return { op: "skip", path: i.existing.path, uid: i.uid, ...rid, reason: "unchanged" };
  return { op: "update", path: i.existing.path, uid: i.uid, ...rid, set: effSet, unset: effUnset, ...(bodyChanged ? { body: newBody } : {}), written, hash, handEdited };
}

function uidOf(p: MappingProfile, n: ExistingNote): string { return String(n.frontmatter[p.uidField] ?? ""); }

export function planRemoval(profile: MappingProfile, existing: ExistingNote, opts: { hasBacklinks: boolean }): NotePlan {
  const uid = uidOf(profile, existing);
  if (existing.frontmatter[profile.stateField] === "deleted") return { op: "skip", path: existing.path, uid, reason: "already-deleted" };
  if (opts.hasBacklinks || userContent(existing.body) !== "") return { op: "delete", path: existing.path, uid, mode: "mark", set: { [profile.stateField]: "deleted" } };
  return { op: "delete", path: existing.path, uid, mode: "trash" };
}

export function planArchive(profile: MappingProfile, existing: ExistingNote): NotePlan {
  const uid = uidOf(profile, existing);
  if (existing.frontmatter[profile.stateField] === "archived") return { op: "skip", path: existing.path, uid, reason: "already-archived" };
  return { op: "archive", path: existing.path, uid, set: { [profile.stateField]: "archived" } };
}
```

- [ ] **Step 4: Grün + Commit** — `feat(mirror): Notiz-Plan — create/update/skip mit Feldklassen, Hand-Änderung, Archiv/Löschen`.

---

### Task 7: Sammlungs-Zustand und Delta-Orchestrierung (pure)

**Files:**
- Create: `src/core/state/collection-state.ts`, `src/core/mirror/apply.ts`
- Test: `tests/core/state/collection-state.test.ts`, `tests/core/mirror/apply.test.ts`

**Interfaces:**
```ts
// collection-state.ts
export interface ObjectState { uid: string; etag: string; raw: string; written: Record<string, FmVal>; hash: string; notePaths: Record<string, string>; history: { etag: string; raw: string; at: string }[] }
  // notePaths: key "" = Master/Kontakt, key <recurrenceId> = Override-Notiz
export interface RunInfo { at: string; ok: boolean; error?: string; counts: { created: number; updated: number; skipped: number; archived: number; deleted: number; errors: number } }
export interface CollectionState { version: 1; source: string; snapshot: SyncSnapshot; objects: Record<string, ObjectState>; lastRun?: RunInfo }   // objects: hrefPath → state
export const HISTORY_MAX = 10;
export function emptyState(source: string): CollectionState
export function upsertObject(s: CollectionState, hrefPath: string, o: { uid: string; etag: string; raw: string; written: Record<string, FmVal>; hash: string; notePath: string; recurrenceId?: string; at: string }): CollectionState   // pure; history nur pushen, wenn etag sich ändert; Kappung HISTORY_MAX
export function removeObject(s: CollectionState, hrefPath: string): CollectionState
export function withSnapshot(s: CollectionState, snap: SyncSnapshot): CollectionState
export function withRun(s: CollectionState, run: RunInfo): CollectionState
export function parseState(json: unknown, source: string): CollectionState   // tolerant: ungültig → emptyState
// apply.ts
export interface NoteLookup {
  byUid(uid: string, source: string, recurrenceId?: string): ExistingNote | undefined;
  byPath(path: string): ExistingNote | undefined;
  exists(path: string): boolean;
  hasBacklinks(path: string): boolean;
}
export interface ApplyInput {
  kind: ProfileKind; profile: MappingProfile; source: string; delta: SyncDelta; state: CollectionState; lookup: NoteLookup; now: Date;
  window?: Window; resolveAttendee?: AttendeeResolver;
}
export interface ApplyResult { plans: NotePlan[]; state: CollectionState; errors: { href: string; message: string }[]; counts: RunInfo["counts"] }
export function applyDelta(i: ApplyInput): ApplyResult
```
Regeln `applyDelta`:
1. `changed`: je `DavObject` parsen (`parseContact` bzw. `parseEvents`); Fehler → `errors` + weiter. Events: **jede** EventData (Master + Overrides) wird eine eigene Notiz (Override: `recurrenceId`). Wenn `window` gegeben und Kind=event: `eventOccursWithin(raw, window.start, window.end)` false → für vorhandene Notizen `planArchive`, für nicht vorhandene **nichts** (kein create); sonst `planUpsert` mit `state:"live"`.
2. Werte/Block aus `fields.ts`/`body.ts`; `existing = lookup.byUid(uid, source, recurrenceId)`; `prevWritten = state.objects[hrefPath]?.written`; Pfad bei Neuanlage: `notePath(profile, noteBasename(...))`, bei `lookup.exists(path)` Suffix 2,3,… (max 99; Pfade, die in **diesem Lauf** schon vergeben wurden, zählen ebenfalls als belegt).
3. `deleted`: `state.objects[hrefPath]` → für jeden `notePaths`-Eintrag `lookup.byPath` → `planRemoval`; Objekt aus State entfernen. Unbekannter href → ignorieren.
4. `outOfWindow`: wie deleted, aber `planArchive`; Objekt bleibt im State (nicht entfernen — es kann zurückkommen? nein, Fenster wandert vorwärts; trotzdem **behalten**, damit `raw`/Verlauf für spätere Kommandos da sind).
5. State: `upsertObject` für jede create/update/skip-Notiz (bei skip bleibt written/hash vom letzten Lauf, etag aktualisieren), `withSnapshot(delta.snapshot)`, `withRun`.
6. `counts` aus den Plänen; `errors` zählen in `counts.errors`.

- [ ] **Step 1: Tests**

`tests/core/state/collection-state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { emptyState, upsertObject, removeObject, withSnapshot, parseState, HISTORY_MAX } from "../../../src/core/state/collection-state";
describe("collection-state", () => {
  const base = { uid: "u", etag: '"1"', raw: "RAW1", written: { a: 1 }, hash: "h1", notePath: "N.md", at: "2026-08-22T10:00:00Z" };
  it("upsert creates entry with empty history and notePaths[''] for master", () => {
    const s = upsertObject(emptyState("src"), "/k/a.ics", base);
    expect(s.objects["/k/a.ics"]).toMatchObject({ uid: "u", etag: '"1"', raw: "RAW1", notePaths: { "": "N.md" }, history: [] });
    expect(emptyState("src").objects).toEqual({});   // pure
  });
  it("etag change pushes previous raw to history (capped), override notePath keyed by recurrenceId", () => {
    let s = upsertObject(emptyState("src"), "/k/a.ics", base);
    for (let i = 2; i <= HISTORY_MAX + 3; i++) s = upsertObject(s, "/k/a.ics", { ...base, etag: `"${i}"`, raw: `RAW${i}`, at: `2026-08-22T10:0${i % 10}:00Z` });
    const o = s.objects["/k/a.ics"]!;
    expect(o.history).toHaveLength(HISTORY_MAX);
    expect(o.history[0]!.raw).toBe(`RAW${HISTORY_MAX + 2}`);   // neueste zuerst
    expect(o.raw).toBe(`RAW${HISTORY_MAX + 3}`);
    s = upsertObject(s, "/k/a.ics", { ...base, etag: o.etag, raw: o.raw, notePath: "N (ov).md", recurrenceId: "2026-09-03T07:00:00Z" });
    expect(s.objects["/k/a.ics"]!.notePaths).toEqual({ "": "N.md", "2026-09-03T07:00:00Z": "N (ov).md" });
    expect(s.objects["/k/a.ics"]!.history).toHaveLength(HISTORY_MAX);   // same etag → no push
  });
  it("remove, snapshot, parse tolerant", () => {
    let s = upsertObject(emptyState("src"), "/k/a.ics", base);
    s = removeObject(s, "/k/a.ics"); expect(s.objects).toEqual({});
    s = withSnapshot(s, { etags: { "/k/b.ics": '"x"' }, syncToken: "t" }); expect(s.snapshot.syncToken).toBe("t");
    expect(parseState(JSON.parse(JSON.stringify(s)), "src")).toEqual(s);
    expect(parseState("garbage", "src")).toEqual(emptyState("src"));
    expect(parseState({ version: 99 }, "src")).toEqual(emptyState("src"));
  });
});
```
`tests/core/mirror/apply.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyDelta, type NoteLookup } from "../../../src/core/mirror/apply";
import { emptyState, upsertObject } from "../../../src/core/state/collection-state";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import type { ExistingNote } from "../../../src/core/mirror/plan";
import type { SyncDelta } from "../../../src/core/dav/sync";
const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");
const NOW = new Date("2026-08-22T12:00:00Z");

function lookupOf(notes: ExistingNote[], backlinks: string[] = []): NoteLookup {
  return {
    byUid: (uid, source, rid) => notes.find((n) => n.frontmatter["dav_uid"] === uid && n.frontmatter["dav_source"] === source && (rid ? n.frontmatter["dav_recurrence_id"] === rid : !n.frontmatter["dav_recurrence_id"])),
    byPath: (p) => notes.find((n) => n.path === p), exists: (p) => notes.some((n) => n.path === p), hasBacklinks: (p) => backlinks.includes(p),
  };
}
const delta = (o: Partial<SyncDelta>): SyncDelta => ({ changed: [], deleted: [], outOfWindow: [], snapshot: { etags: {} }, strategy: "etag-diff", unchanged: false, ...o });

describe("applyDelta — contacts", () => {
  it("creates notes for new objects, resolves collisions, updates state", () => {
    const r = applyDelta({ kind: "contact", profile: defaultContactProfile(), source: "acc/kon", now: NOW, state: emptyState("acc/kon"), lookup: lookupOf([{ path: "Contacts/Alex Aguado.md", frontmatter: {}, body: "" }]),
      delta: delta({ changed: [{ href: "https://s/k/c3.vcf", etag: '"1"', data: fx("vcard", "v3-full.vcf") }, { href: "https://s/k/c4.vcf", etag: '"2"', data: fx("vcard", "v4-min.vcf") }], snapshot: { etags: { "/k/c3.vcf": '"1"', "/k/c4.vcf": '"2"' } } }) });
    expect(r.errors).toEqual([]);
    expect(r.plans.map((p) => [p.op, p.path])).toEqual([["create", "Contacts/Dr. Florian Brandes.md"], ["create", "Contacts/Alex Aguado (2).md"]]);
    expect(r.state.objects["/k/c3.vcf"]).toMatchObject({ uid: "c3-1@test", etag: '"1"', notePaths: { "": "Contacts/Dr. Florian Brandes.md" } });
    expect(r.state.snapshot.etags["/k/c4.vcf"]).toBe('"2"');
    expect(r.counts).toEqual({ created: 2, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 });
  });
  it("unparsable object → error, others proceed", () => {
    const r = applyDelta({ kind: "contact", profile: defaultContactProfile(), source: "acc/kon", now: NOW, state: emptyState("acc/kon"), lookup: lookupOf([]),
      delta: delta({ changed: [{ href: "https://s/k/bad.vcf", etag: '"1"', data: "BEGIN:VCALENDAR\nEND:VCALENDAR" }, { href: "https://s/k/c4.vcf", etag: '"2"', data: fx("vcard", "v4-min.vcf") }] }) });
    expect(r.errors).toHaveLength(1); expect(r.errors[0]!.href).toContain("bad.vcf");
    expect(r.plans).toHaveLength(1); expect(r.counts.errors).toBe(1);
  });
  it("deleted: trash vs mark, object removed from state", () => {
    const st = upsertObject(emptyState("acc/kon"), "/k/c4.vcf", { uid: "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001", etag: '"2"', raw: "x", written: {}, hash: "h", notePath: "Contacts/Alex Aguado.md", at: "t" });
    const note = { path: "Contacts/Alex Aguado.md", frontmatter: { dav_uid: "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001", dav_source: "acc/kon" }, body: "" };
    const r = applyDelta({ kind: "contact", profile: defaultContactProfile(), source: "acc/kon", now: NOW, state: st, lookup: lookupOf([note], ["Contacts/Alex Aguado.md"]), delta: delta({ deleted: ["https://s/k/c4.vcf"] }) });
    expect(r.plans).toEqual([{ op: "delete", path: "Contacts/Alex Aguado.md", uid: note.frontmatter.dav_uid, mode: "mark", set: { dav_state: "deleted" } }]);
    expect(r.state.objects["/k/c4.vcf"]).toBeUndefined();
  });
});
describe("applyDelta — events", () => {
  const p = defaultEventProfile();
  it("master + override become two notes; out-of-window existing note is archived; out-of-window new is not created", () => {
    const win = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-09-30T00:00:00Z") };
    const r = applyDelta({ kind: "event", profile: p, source: "acc/kal", now: NOW, state: emptyState("acc/kal"), lookup: lookupOf([{ path: "Events/old.md", frontmatter: { dav_uid: "allday-1@test", dav_source: "acc/kal", dav_state: "live" }, body: "" }]), window: win,
      delta: delta({ changed: [{ href: "https://s/c/ov.ics", etag: '"1"', data: fx("ical", "override.ics") }, { href: "https://s/c/x.ics", etag: '"2"', data: fx("ical", "allday.ics") }, { href: "https://s/c/s.ics", etag: '"3"', data: fx("ical", "simple.ics") }] }) });
    const ops = r.plans.map((x) => [x.op, x.path]);
    expect(ops).toContainEqual(["create", "Events/2026-09-01 Standup.md"]);
    expect(ops).toContainEqual(["create", "Events/2026-09-03 Standup (verschoben).md"]);
    expect(ops).toContainEqual(["archive", "Events/old.md"]);           // Weihnachten außerhalb, Notiz existiert
    expect(ops).toContainEqual(["create", "Events/2026-09-01 Zahnärztin Dr. Müller.md"]);
    expect(r.state.objects["/c/ov.ics"]!.notePaths).toEqual({ "": "Events/2026-09-01 Standup.md", "2026-09-03T07:00:00Z": "Events/2026-09-03 Standup (verschoben).md" });
    const ovPlan = r.plans.find((x) => x.path.includes("verschoben"));
    expect(ovPlan && ovPlan.op === "create" ? ovPlan.frontmatter["dav_recurrence_id"] : null).toBe("2026-09-03T07:00:00Z");
  });
  it("outOfWindow hrefs archive their notes but stay in state", () => {
    const st = upsertObject(emptyState("acc/kal"), "/c/s.ics", { uid: "simple-1@test", etag: '"3"', raw: "x", written: {}, hash: "h", notePath: "Events/S.md", at: "t" });
    const r = applyDelta({ kind: "event", profile: p, source: "acc/kal", now: NOW, state: st, lookup: lookupOf([{ path: "Events/S.md", frontmatter: { dav_uid: "simple-1@test", dav_source: "acc/kal" }, body: "" }]), delta: delta({ outOfWindow: ["https://s/c/s.ics"] }) });
    expect(r.plans).toEqual([{ op: "archive", path: "Events/S.md", uid: "simple-1@test", set: { dav_state: "archived" } }]);
    expect(r.state.objects["/c/s.ics"]).toBeDefined();
  });
  it("attendees resolved through resolver", () => {
    const r = applyDelta({ kind: "event", profile: p, source: "acc/kal", now: NOW, state: emptyState("acc/kal"), lookup: lookupOf([]), resolveAttendee: (m) => (m === "alex@example.test" ? { path: "Contacts/Alex Aguado", display: "Alex Aguado" } : undefined),
      delta: delta({ changed: [{ href: "https://s/c/a.ics", etag: '"1"', data: fx("ical", "attendees.ics") }] }) });
    const pl = r.plans[0]!; if (pl.op !== "create") throw new Error();
    expect(pl.frontmatter["attendees"]).toEqual(["[[Contacts/Alex Aguado|Alex Aguado]]", "sam@example.test"]);
  });
});
```

- [ ] **Step 2: Rot sehen**, **Step 3: Implementieren**

`src/core/state/collection-state.ts`:
```ts
import type { SyncSnapshot } from "../dav/sync";
import type { FmVal } from "../mirror/profile";

export interface ObjectState { uid: string; etag: string; raw: string; written: Record<string, FmVal>; hash: string; notePaths: Record<string, string>; history: { etag: string; raw: string; at: string }[] }
export interface RunInfo { at: string; ok: boolean; error?: string; counts: { created: number; updated: number; skipped: number; archived: number; deleted: number; errors: number } }
export interface CollectionState { version: 1; source: string; snapshot: SyncSnapshot; objects: Record<string, ObjectState>; lastRun?: RunInfo }
export const HISTORY_MAX = 10;

export function emptyState(source: string): CollectionState { return { version: 1, source, snapshot: { etags: {} }, objects: {} }; }

export function upsertObject(s: CollectionState, hrefPath: string, o: { uid: string; etag: string; raw: string; written: Record<string, FmVal>; hash: string; notePath: string; recurrenceId?: string; at: string }): CollectionState {
  const prev = s.objects[hrefPath];
  const history = prev && prev.etag !== o.etag ? [{ etag: prev.etag, raw: prev.raw, at: o.at }, ...prev.history].slice(0, HISTORY_MAX) : (prev?.history ?? []);
  const notePaths = { ...(prev?.notePaths ?? {}), [o.recurrenceId ?? ""]: o.notePath };
  const next: ObjectState = { uid: o.uid, etag: o.etag, raw: o.raw, written: { ...o.written }, hash: o.hash, notePaths, history };
  return { ...s, objects: { ...s.objects, [hrefPath]: next } };
}
export function removeObject(s: CollectionState, hrefPath: string): CollectionState {
  const objects = { ...s.objects }; delete objects[hrefPath]; return { ...s, objects };
}
export function withSnapshot(s: CollectionState, snap: SyncSnapshot): CollectionState { return { ...s, snapshot: { ...snap, etags: { ...snap.etags } } }; }
export function withRun(s: CollectionState, run: RunInfo): CollectionState { return { ...s, lastRun: run }; }
export function parseState(json: unknown, source: string): CollectionState {
  if (!json || typeof json !== "object") return emptyState(source);
  const j = json as Record<string, unknown>;
  if (j["version"] !== 1 || typeof j["source"] !== "string" || !j["objects"] || typeof j["objects"] !== "object" || !j["snapshot"] || typeof j["snapshot"] !== "object") return emptyState(source);
  return { version: 1, source, snapshot: j["snapshot"] as SyncSnapshot, objects: j["objects"] as Record<string, ObjectState>, ...(j["lastRun"] ? { lastRun: j["lastRun"] as RunInfo } : {}) };
}
```
`src/core/mirror/apply.ts`:
```ts
import type { SyncDelta } from "../dav/sync";
import { hrefPath } from "../dav/url";
import { parseContact, type ContactData } from "../vcard/contact";
import { parseEvents, type EventData } from "../ical/event";
import { eventOccursWithin } from "../ical/recur";
import { contactValues, eventValues, type AttendeeResolver } from "./fields";
import { renderContactBlock, renderEventBlock } from "./body";
import { noteBasename, notePath } from "./filename";
import { planUpsert, planRemoval, planArchive, type ExistingNote, type NotePlan } from "./plan";
import type { MappingProfile, ProfileKind } from "./profile";
import type { Window } from "./window";
import { upsertObject, removeObject, withSnapshot, type CollectionState, type RunInfo } from "../state/collection-state";

export interface NoteLookup {
  byUid(uid: string, source: string, recurrenceId?: string): ExistingNote | undefined;
  byPath(path: string): ExistingNote | undefined;
  exists(path: string): boolean;
  hasBacklinks(path: string): boolean;
}
export interface ApplyInput { kind: ProfileKind; profile: MappingProfile; source: string; delta: SyncDelta; state: CollectionState; lookup: NoteLookup; now: Date; window?: Window; resolveAttendee?: AttendeeResolver }
export interface ApplyResult { plans: NotePlan[]; state: CollectionState; errors: { href: string; message: string }[]; counts: RunInfo["counts"] }

function freePath(profile: MappingProfile, base: string, lookup: NoteLookup, taken: Set<string>): string {
  for (let n = 1; n < 100; n++) {
    const p = notePath(profile, base, n === 1 ? undefined : n);
    if (!lookup.exists(p) && !taken.has(p)) return p;
  }
  return notePath(profile, base, 99);
}

export function applyDelta(i: ApplyInput): ApplyResult {
  const plans: NotePlan[] = []; const errors: ApplyResult["errors"] = [];
  const counts: RunInfo["counts"] = { created: 0, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 };
  let state = i.state; const taken = new Set<string>(); const at = i.now.toISOString();
  const push = (pl: NotePlan) => { plans.push(pl); if (pl.op === "create") counts.created++; else if (pl.op === "update") counts.updated++; else if (pl.op === "skip") counts.skipped++; else if (pl.op === "archive") counts.archived++; else counts.deleted++; };

  for (const obj of i.delta.changed) {
    const hp = hrefPath(obj.href);
    try {
      const items: { data: ContactData | EventData; uid: string; recurrenceId?: string; values: ReturnType<typeof contactValues>; block: string }[] = [];
      if (i.kind === "contact") { const c = parseContact(obj.data); items.push({ data: c, uid: c.uid, values: contactValues(c), block: renderContactBlock(c) }); }
      else for (const e of parseEvents(obj.data)) items.push({ data: e, uid: e.uid, ...(e.recurrenceId ? { recurrenceId: e.recurrenceId } : {}), values: eventValues(e, { resolveAttendee: i.resolveAttendee, attendeeLinks: i.profile.attendeeLinks }), block: renderEventBlock(e) });
      const inWindow = i.kind === "event" && i.window ? eventOccursWithin(obj.data, i.window.start, i.window.end) : true;
      for (const it of items) {
        const existing = i.lookup.byUid(it.uid, i.source, it.recurrenceId);
        if (!inWindow) { if (existing) push(planArchive(i.profile, existing)); continue; }
        const path = existing?.path ?? freePath(i.profile, noteBasename(i.profile, it.data), i.lookup, taken);
        taken.add(path);
        const pl = planUpsert({ profile: i.profile, source: i.source, uid: it.uid, ...(it.recurrenceId ? { recurrenceId: it.recurrenceId } : {}), etag: obj.etag, values: it.values, block: it.block, path, ...(existing ? { existing } : {}), ...(state.objects[hp]?.written ? { prevWritten: state.objects[hp]!.written } : {}), state: "live" });
        push(pl);
        const written = pl.op === "create" || pl.op === "update" ? pl.written : (state.objects[hp]?.written ?? {});
        const hash = pl.op === "create" || pl.op === "update" ? pl.hash : (state.objects[hp]?.hash ?? "");
        state = upsertObject(state, hp, { uid: it.uid, etag: obj.etag, raw: obj.data, written, hash, notePath: pl.path, ...(it.recurrenceId ? { recurrenceId: it.recurrenceId } : {}), at });
      }
    } catch (e) { errors.push({ href: obj.href, message: e instanceof Error ? e.message : String(e) }); counts.errors++; }
  }
  for (const href of i.delta.deleted) {
    const hp = hrefPath(href); const os = state.objects[hp]; if (!os) continue;
    for (const path of Object.values(os.notePaths)) { const n = i.lookup.byPath(path); if (n) push(planRemoval(i.profile, n, { hasBacklinks: i.lookup.hasBacklinks(path) })); }
    state = removeObject(state, hp);
  }
  for (const href of i.delta.outOfWindow) {
    const os = state.objects[hrefPath(href)]; if (!os) continue;
    for (const path of Object.values(os.notePaths)) { const n = i.lookup.byPath(path); if (n) push(planArchive(i.profile, n)); }
  }
  state = withSnapshot(state, i.delta.snapshot);
  return { plans, state, errors, counts };
}
```
Hinweis: `counts.skipped` zählt `skip`-Pläne jeder Art. `withRun` ruft der Orchestrator in M2b nach dem Ausführen (er kennt `ok`/`error`).

- [ ] **Step 4: Grün + Commit** — `feat(mirror): Sammlungs-Zustand + Delta → Notiz-Pläne (Fenster, Overrides, Löschen/Archiv, Kollisionen)`.

---

### Task 8: Abschluss M2a — Gate, Doku

**Files:**
- Modify: `CHANGELOG.md`, `AGENTS.md` (Abschnitt „Was M2a liefert": Mirror-Kern-Module, Plan-Typen, wie M2b sie konsumiert), `docs/registry-kandidaten.md` (+ „Notiz-Plan mit Feldklassen (verwaltet/einmalig/frei) + verwalteter Body-Block" und „Wiederholungs-Fensterprüfung über ical.js RecurExpansion")

- [ ] **Step 1:** `npm run gate` grün (0 Warnings), `npm run test:integration` unverändert grün.
- [ ] **Step 2:** Doku schreiben, Plan-Checkboxen abhaken, Commit `docs: M2a abgeschlossen — Mirror-Kern`.

---

## Self-Review (beim Schreiben ausgeführt)

- **Spec-Abdeckung:** §2 Identität/Feldklassen/Body/Wiederholungen/Zeitfenster/Dateiname → Tasks 1–6 ✓; §3 Snapshot mit `raw`+Verlauf ≤10, `writtenHash`/Hand-Änderung, Drift-Guard → Tasks 4, 6, 7 ✓; §4 Profile mit Defaults → Task 1 ✓ (Adoption = M3, Import/Export + „aus Notiz erzeugen" = M2b/M3 UI). Attendee-Wikilinks → Task 2 ✓.
- **Typkonsistenz:** `FmVal`/`MappingProfile` (T1) in T2, T4, T6, T7; `ManagedValues`/`AttendeeResolver` (T2) in T6, T7; `ExistingNote`/`NotePlan` (T6) in T7; `SyncDelta.outOfWindow` aus M1-Fix-Welle in T7; `Window` (T5) in T7.
- **Platzhalter:** keine; `buildFilename`-Optionen sind mit Prüfhinweis versehen (Kit-Signatur vor Ort lesen).
