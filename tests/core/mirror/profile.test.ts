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
  it("rejects invalid body / attendeeLinks instead of silently coercing", () => {
    const base = defaultContactProfile();
    const r1 = validateProfile({ ...base, body: "blck" });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join(" ")).toMatch(/body/);
    const r2 = validateProfile({ ...base, attendeeLinks: "false" });
    expect(r2.ok).toBe(false);
  });
});
