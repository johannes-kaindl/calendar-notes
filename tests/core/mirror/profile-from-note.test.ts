import { describe, it, expect } from "vitest";
import { validateProfile } from "../../../src/core/mirror/profile";
import { suggestProfileFromNote } from "../../../src/core/mirror/profile-from-note";

const rand = (): number => 0.5;

describe("suggestProfileFromNote — contact", () => {
  const frontmatter = {
    organisation: "MVZ am Marktplatz",
    rolle: "Hausarzt",
    email: "praxis@example.test",
    telefon: "0821 555 0",
    mobil: "0171 1234567",
    adresse: "Marktplatz 1, Augsburg",
    vcard_uid: "c3-1@test",
    type: "👤 Kontakt",
    status: "3-evergreen 🌿",
    up: "[[10_Kontakte]]",
  };

  it("maps the Pallas contact synonyms onto server fields", () => {
    const { profile, mapped, unmapped } = suggestProfileFromNote("contact", frontmatter, { folder: "50_Ressourcen/10_Reference/10_Kontakte", name: "Pallas Kontakte", rand });
    expect(mapped).toEqual({ org: "organisation", title: "rolle", email: "email", tel_home: "telefon", tel_cell: "mobil", adr: "adresse" });
    expect(unmapped).toEqual([]);
    expect(profile.fields.org).toBe("organisation");
    expect(profile.fields.title).toBe("rolle");
    expect(profile.fields.email).toBe("email");
    expect(profile.fields.tel_home).toBe("telefon");
    expect(profile.fields.tel_cell).toBe("mobil");
    expect(profile.fields.adr).toBe("adresse");
  });

  it("recognizes vcard_uid as uidField instead of the default", () => {
    const { profile } = suggestProfileFromNote("contact", frontmatter, { folder: "Kontakte", name: "Kontakte", rand });
    expect(profile.uidField).toBe("vcard_uid");
  });

  it("copies type/status/up verbatim into onCreate", () => {
    const { profile } = suggestProfileFromNote("contact", frontmatter, { folder: "Kontakte", name: "Kontakte", rand });
    expect(profile.onCreate).toEqual({ type: "👤 Kontakt", status: "3-evergreen 🌿", up: "[[10_Kontakte]]" });
  });

  it("sets id/name/folder from the given opts and kind", () => {
    const { profile } = suggestProfileFromNote("contact", frontmatter, { folder: "Kontakte", name: "Pallas Kontakte", rand });
    expect(profile.id.startsWith("profile-c-")).toBe(true);
    expect(profile.name).toBe("Pallas Kontakte");
    expect(profile.folder).toBe("Kontakte");
    expect(profile.kind).toBe("contact");
  });

  it("produces a profile that passes validateProfile", () => {
    const { profile } = suggestProfileFromNote("contact", frontmatter, { folder: "Kontakte", name: "Pallas Kontakte", rand });
    const r = validateProfile(profile);
    expect(r.ok).toBe(true);
  });

  it("puts unrecognized keys into unmapped", () => {
    const fm = { ...frontmatter, lieblingsfarbe: "blau", geheimcode: "42" };
    const { unmapped } = suggestProfileFromNote("contact", fm, { folder: "Kontakte", name: "Kontakte", rand });
    expect(unmapped.sort()).toEqual(["geheimcode", "lieblingsfarbe"]);
  });

  it("defaults uidField to dav_uid when no uid key is present", () => {
    const { profile } = suggestProfileFromNote("contact", { email: "a@b.test" }, { folder: "Kontakte", name: "Kontakte", rand });
    expect(profile.uidField).toBe("dav_uid");
  });
});

describe("suggestProfileFromNote — event", () => {
  const frontmatter = {
    termin_start: "2026-09-01 10:00",
    termin_ende: "2026-09-01 11:00",
    ort: "Marktplatz 1",
    online: false,
    teilnehmer: ["[[Florian Brandes]]"],
    type: "📅 Termin",
  };

  it("maps the Pallas event synonyms onto server fields", () => {
    const { profile, mapped, unmapped } = suggestProfileFromNote("event", frontmatter, { folder: "Termine", name: "Pallas Termine", rand });
    expect(mapped).toEqual({ start: "termin_start", end: "termin_ende", location: "ort", online: "online", attendees: "teilnehmer" });
    expect(unmapped).toEqual([]);
    expect(profile.fields.start).toBe("termin_start");
    expect(profile.fields.end).toBe("termin_ende");
    expect(profile.fields.location).toBe("ort");
    expect(profile.fields.online).toBe("online");
    expect(profile.fields.attendees).toBe("teilnehmer");
  });

  it("copies only type into onCreate when status/up are absent", () => {
    const { profile } = suggestProfileFromNote("event", frontmatter, { folder: "Termine", name: "Termine", rand });
    expect(profile.onCreate).toEqual({ type: "📅 Termin" });
  });

  it("produces a profile that passes validateProfile", () => {
    const { profile } = suggestProfileFromNote("event", frontmatter, { folder: "Termine", name: "Pallas Termine", rand });
    const r = validateProfile(profile);
    expect(r.ok).toBe(true);
  });

  it("kind and id prefix match the event branch", () => {
    const { profile } = suggestProfileFromNote("event", frontmatter, { folder: "Termine", name: "Termine", rand });
    expect(profile.kind).toBe("event");
    expect(profile.id.startsWith("profile-e-")).toBe(true);
  });

  it("keeps unrecognized event keys in unmapped", () => {
    const fm = { ...frontmatter, laenge_minuten: 60 };
    const { unmapped } = suggestProfileFromNote("event", fm, { folder: "Termine", name: "Termine", rand });
    expect(unmapped).toEqual(["laenge_minuten"]);
  });

  it("maps 'url' onto the url field (in addition to the existing 'link' synonym)", () => {
    const fm = { ...frontmatter, url: "https://example.test/meeting" };
    const { profile, mapped } = suggestProfileFromNote("event", fm, { folder: "Termine", name: "Termine", rand });
    expect(profile.fields.url).toBe("url");
    expect(mapped.url).toBe("url");
  });

  it("never maps 'status' into fields — it stays reserved for onCreate, even though it's a valid event synonym", () => {
    const fm = { ...frontmatter, status: "confirmed" };
    const { profile, mapped, unmapped } = suggestProfileFromNote("event", fm, { folder: "Termine", name: "Termine", rand });
    expect(profile.fields.status).toBeNull();
    expect(mapped.status).toBeUndefined();
    expect(profile.onCreate).toEqual({ type: "📅 Termin", status: "confirmed" });
    expect(unmapped).toEqual([]);
  });
});

describe("suggestProfileFromNote — onCreate edge cases", () => {
  it("copies a string[] value of type/status/up into onCreate verbatim", () => {
    const fm = { email: "a@b.test", up: ["[[10_Kontakte]]", "[[Praxis]]"] };
    const { profile, unmapped } = suggestProfileFromNote("contact", fm, { folder: "Kontakte", name: "Kontakte", rand });
    expect(profile.onCreate).toEqual({ up: ["[[10_Kontakte]]", "[[Praxis]]"] });
    expect(unmapped).toEqual([]);
  });

  it("puts a non-string/non-string[] onCreate-key value into unmapped instead of onCreate", () => {
    const fm = { email: "a@b.test", status: 3, up: { nested: true } };
    const { profile, unmapped } = suggestProfileFromNote("contact", fm, { folder: "Kontakte", name: "Kontakte", rand });
    expect(profile.onCreate).toEqual({});
    expect(profile.fields.email).toBe("email");
    expect(unmapped.sort()).toEqual(["status", "up"]);
  });

  it("validates when onCreate carries a string[] value", () => {
    const fm = { email: "a@b.test", up: ["[[10_Kontakte]]"] };
    const { profile } = suggestProfileFromNote("contact", fm, { folder: "Kontakte", name: "Kontakte", rand });
    const r = validateProfile(profile);
    expect(r.ok).toBe(true);
  });
});

describe("suggestProfileFromNote — datum/uhrzeit-Paare", () => {
  // `uhrzeit` hat kein Server-Gegenstück: VEVENT kennt nur volle Zeitstempel. Mappt man in so
  // einer Notiz `datum` auf `start`, schreibt der erste Sync "2026-09-01T10:00:00" in ein Feld,
  // das ein reines Datum trug — und `uhrzeit` widerspricht ihm ab da. Fürs Finden ist das
  // Mapping entbehrlich: noteEventMoment() setzt datum+uhrzeit selbst zusammen.
  it("leaves start unmapped when the note carries datum next to uhrzeit", () => {
    const fm = { datum: "2026-09-01", uhrzeit: "10:00", titel: "Zahnarzt" };
    const { profile, mapped, unmapped } = suggestProfileFromNote("event", fm, { folder: "Termine", name: "Termine", rand });
    expect(profile.fields.start).toBeNull();
    expect(mapped.start).toBeUndefined();
    expect(unmapped).toContain("datum");
  });

  it("still maps termin_start onto start when datum and uhrzeit are present too", () => {
    const fm = { datum: "2026-09-01", uhrzeit: "10:00", termin_start: "2026-09-01 10:00" };
    const { profile, mapped, unmapped } = suggestProfileFromNote("event", fm, { folder: "Termine", name: "Termine", rand });
    expect(profile.fields.start).toBe("termin_start");
    expect(mapped.start).toBe("termin_start");
    expect(unmapped).toContain("datum");
  });

  it("maps datum onto start when no uhrzeit key is present", () => {
    const fm = { datum: "2026-09-01", titel: "Zahnarzt" };
    const { profile, mapped } = suggestProfileFromNote("event", fm, { folder: "Termine", name: "Termine", rand });
    expect(profile.fields.start).toBe("datum");
    expect(mapped.start).toBe("datum");
  });
});
