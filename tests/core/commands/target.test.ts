import { describe, it, expect } from "vitest";
import { targetFromFrontmatter } from "../../../src/core/commands/target";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { normalizeSettings, type PluginSettings } from "../../../src/core/settings";

function settingsWith(overrides: Partial<PluginSettings>): PluginSettings {
  const base = normalizeSettings(null);
  return { ...base, ...overrides };
}

const EVENT_COLLECTION = {
  id: "c1", accountId: "a1", href: "https://dav.example/cal/", kind: "calendar" as const,
  displayName: "Cal", enabled: true, profileId: "default-event", readOnly: false,
};

const CONTACT_COLLECTION = {
  id: "c2", accountId: "a1", href: "https://dav.example/ab/", kind: "addressbook" as const,
  displayName: "AB", enabled: true, profileId: "default-contact", readOnly: false,
};

describe("targetFromFrontmatter", () => {
  it("erkennt ein gespiegeltes Event ueber source-/uid-Feld des wirksamen Profils", () => {
    const settings = settingsWith({ collections: [EVENT_COLLECTION], profiles: [defaultEventProfile()] });
    const fm = { dav_source: "a1/c1", dav_uid: "ev-1@test" };
    expect(targetFromFrontmatter(settings, fm)).toEqual({ kind: "event", source: "a1/c1", uid: "ev-1@test", collectionId: "c1" });
  });

  it("erkennt einen gespiegelten Kontakt", () => {
    const settings = settingsWith({ collections: [CONTACT_COLLECTION], profiles: [defaultContactProfile()] });
    const fm = { dav_source: "a1/c2", dav_uid: "ct-1@test" };
    expect(targetFromFrontmatter(settings, fm)).toEqual({ kind: "contact", source: "a1/c2", uid: "ct-1@test", collectionId: "c2" });
  });

  it("liefert die recurrenceId mit, wenn das Feld gesetzt ist", () => {
    const settings = settingsWith({ collections: [EVENT_COLLECTION], profiles: [defaultEventProfile()] });
    const fm = { dav_source: "a1/c1", dav_uid: "ev-1@test", dav_recurrence_id: "20260101T100000Z" };
    expect(targetFromFrontmatter(settings, fm)).toEqual({
      kind: "event", source: "a1/c1", uid: "ev-1@test", collectionId: "c1", recurrenceId: "20260101T100000Z",
    });
  });

  it("ignoriert deaktivierte Sammlungen", () => {
    const settings = settingsWith({ collections: [{ ...EVENT_COLLECTION, enabled: false }], profiles: [defaultEventProfile()] });
    const fm = { dav_source: "a1/c1", dav_uid: "ev-1@test" };
    expect(targetFromFrontmatter(settings, fm)).toBeUndefined();
  });

  it("liefert undefined, wenn sourceField nicht passt", () => {
    const settings = settingsWith({ collections: [EVENT_COLLECTION], profiles: [defaultEventProfile()] });
    expect(targetFromFrontmatter(settings, { dav_source: "andere", dav_uid: "ev-1@test" })).toBeUndefined();
  });

  it("liefert undefined, wenn uidField fehlt oder kein String ist", () => {
    const settings = settingsWith({ collections: [EVENT_COLLECTION], profiles: [defaultEventProfile()] });
    expect(targetFromFrontmatter(settings, { dav_source: "a1/c1" })).toBeUndefined();
    expect(targetFromFrontmatter(settings, { dav_source: "a1/c1", dav_uid: 42 })).toBeUndefined();
    expect(targetFromFrontmatter(settings, { dav_source: "a1/c1", dav_uid: "" })).toBeUndefined();
  });

  it("liefert undefined fuer voellig fremdes Frontmatter", () => {
    const settings = settingsWith({ collections: [EVENT_COLLECTION, CONTACT_COLLECTION], profiles: [defaultEventProfile(), defaultContactProfile()] });
    expect(targetFromFrontmatter(settings, { title: "Ganz normale Notiz" })).toBeUndefined();
  });
});
