import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planPushHandEdits } from "../../../src/core/commands/push-hand-edits";
import { parseEvents, primaryEvent } from "../../../src/core/ical/event";
import { parseContact } from "../../../src/core/vcard/contact";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import type { Account, CollectionConfig } from "../../../src/core/settings";
import type { CommandContext, CommandTarget } from "../../../src/core/commands/types";

const FIXTURES = join(__dirname, "../../fixtures");
const read = (rel: string): string => readFileSync(join(FIXTURES, rel), "utf8");

const ACCOUNT: Account = { id: "a1", name: "Acc", baseUrl: "https://dav.example/", username: "jay@example.test", secretId: "s1" };
const EVENT_COL: CollectionConfig = { id: "c1", accountId: "a1", href: "https://dav.example/cal/", kind: "calendar", displayName: "Cal", enabled: true, profileId: "default-event", readOnly: false };
const CONTACT_COL: CollectionConfig = { id: "ab1", accountId: "a1", href: "https://dav.example/ab/", kind: "addressbook", displayName: "AB", enabled: true, profileId: "default-contact", readOnly: false };
const NOW = new Date("2026-08-22T10:00:00Z");

function eventTarget(): CommandTarget {
  return { kind: "event", source: "a1/c1", href: "https://dav.example/cal/simple.ics", uid: "simple-1@test" };
}
function contactTarget(): CommandTarget {
  return { kind: "contact", source: "a1/ab1", href: "https://dav.example/ab/v3-full.vcf", uid: "c3-1@test" };
}

function eventCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile: defaultEventProfile(), collection: EVENT_COL, account: ACCOUNT,
    target: eventTarget(), raw: read("ical/simple.ics"), etag: "\"e1\"", rand: () => 0.42, ...overrides,
  };
}
function contactCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile: defaultContactProfile(), collection: CONTACT_COL, account: ACCOUNT,
    target: contactTarget(), raw: read("vcard/v3-full.vcf"), etag: "\"e1\"", rand: () => 0.42, ...overrides,
  };
}

describe("planPushHandEdits: event", () => {
  it("uebertraegt geaenderte, unterstuetzte Felder (title -> SUMMARY)", () => {
    const ctx = eventCtx();
    const prevWritten = { title: "Zahnärztin Dr. Müller", location: "Praxis am Markt, Hauptstraße 1" };
    const frontmatter = { title: "Zahnarzt (Handaenderung)", location: "Praxis am Markt, Hauptstraße 1" };
    const { plan, skipped } = planPushHandEdits(ctx, frontmatter, prevWritten);
    expect(skipped).toEqual([]);
    expect(plan).not.toBeNull();
    const afterEv = primaryEvent(parseEvents(plan!.newRaw))!;
    expect(afterEv.summary).toBe("Zahnarzt (Handaenderung)");
  });

  it("nicht unterstuetzte Felder landen in skipped, Plan bleibt null wenn nichts unterstuetzt", () => {
    const ctx = eventCtx();
    const prevWritten = { event_status: "CONFIRMED" };
    const frontmatter = { event_status: "TENTATIVE" };
    const { plan, skipped } = planPushHandEdits(ctx, frontmatter, prevWritten);
    expect(plan).toBeNull();
    expect(skipped).toEqual([{ key: "event_status", reason: expect.any(String) }]);
  });

  it("keine Aenderung -> plan null, skipped leer", () => {
    const ctx = eventCtx();
    const prevWritten = { title: "Zahnärztin Dr. Müller" };
    const frontmatter = { title: "Zahnärztin Dr. Müller" };
    const { plan, skipped } = planPushHandEdits(ctx, frontmatter, prevWritten);
    expect(plan).toBeNull();
    expect(skipped).toEqual([]);
  });

  it("start-Aenderung baut times-Mutation mit erhaltenem end/tzid", () => {
    const ctx = eventCtx();
    const prevWritten = { start: "2026-09-01T10:00:00" };
    const frontmatter = { start: "2026-09-01T11:00:00" };
    const { plan } = planPushHandEdits(ctx, frontmatter, prevWritten);
    const afterEv = primaryEvent(parseEvents(plan!.newRaw))!;
    expect(afterEv.start).toBe("2026-09-01T11:00:00");
    expect(afterEv.tzid).toBe("Europe/Berlin");
  });

  // Fix C1 (Review-Runde 3): Obsidians eigene datetime-Frontmatter-Properties liefern beim
  // Editieren ueber den nativen Picker `T14:00` OHNE Sekunden — genau die Form, die vorher
  // still auf 00:00 gerundet wurde, WEIL sie eine Hand-Aenderung ist (kommt direkt aus dem
  // Frontmatter, nicht ueber ein Formular mit erzwungenem Format).
  it.each([
    ["2026-09-01T11:00:00", "2026-09-01T11:00:00"],
    ["2026-09-01T11:00", "2026-09-01T11:00:00"],
    ["2026-09-01 11:00", "2026-09-01T11:00:00"],
    ["2026-09-01 11:00:00", "2026-09-01T11:00:00"],
  ])("start-Handaenderung mit Frontmatter-Wert %j -> DTSTART=%j", (fmValue, expected) => {
    const ctx = eventCtx();
    const prevWritten = { start: "2026-09-01T10:00:00" };
    const frontmatter = { start: fmValue };
    const { plan } = planPushHandEdits(ctx, frontmatter, prevWritten);
    const afterEv = primaryEvent(parseEvents(plan!.newRaw))!;
    expect(afterEv.start).toBe(expected);
  });
});

describe("planPushHandEdits: contact", () => {
  it("uebertraegt fn und org", () => {
    const ctx = contactCtx();
    const prevWritten = { title: "Dr. Florian Brandes", organization: "MVZ am Marktplatz / Allgemeinmedizin" };
    const frontmatter = { title: "Florian B. (Handaenderung)", organization: "MVZ am Marktplatz / Allgemeinmedizin" };
    const { plan, skipped } = planPushHandEdits(ctx, frontmatter, prevWritten);
    expect(skipped).toEqual([]);
    const after = parseContact(plan!.newRaw);
    expect(after.fn).toBe("Florian B. (Handaenderung)");
  });

  it("email-Aenderung schreibt auf den Primary-Eintrag (pref)", () => {
    const ctx = contactCtx();
    const prevWritten = { email: "praxis@example.test" };
    const frontmatter = { email: "neue-praxis@example.test" };
    const { plan } = planPushHandEdits(ctx, frontmatter, prevWritten);
    const after = parseContact(plan!.newRaw);
    expect(after.emails.find((e) => e.pref)?.value).toBe("neue-praxis@example.test");
  });

  it("unbekannter fm-Key -> skipped, kein Plan", () => {
    const ctx = contactCtx();
    const prevWritten = { unmapped_thing: "x" };
    const frontmatter = { unmapped_thing: "y" };
    const { plan, skipped } = planPushHandEdits(ctx, frontmatter, prevWritten);
    expect(plan).toBeNull();
    expect(skipped.length).toBe(1);
    expect(skipped[0]?.key).toBe("unmapped_thing");
  });
});
