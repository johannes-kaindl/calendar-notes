import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planUndoLast } from "../../../src/core/commands/undo";
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

describe("planUndoLast", () => {
  it("liefert null bei leerem Verlauf", () => {
    const ctx: CommandContext = {
      now: NOW, profile: defaultEventProfile(), collection: EVENT_COL, account: ACCOUNT,
      target: eventTarget(), raw: read("ical/simple.ics"), etag: "\"e2\"", rand: () => 0.42,
    };
    expect(planUndoLast(ctx, [])).toBeNull();
  });

  it("Event: newRaw = history[0].raw, diff gegen aktuelles raw, summary mit Datum", () => {
    const currentRaw = read("ical/simple.ics");
    const priorRaw = currentRaw.replace("Zahnärztin Dr. Müller", "Alter Titel");
    const ctx: CommandContext = {
      now: NOW, profile: defaultEventProfile(), collection: EVENT_COL, account: ACCOUNT,
      target: eventTarget(), raw: currentRaw, etag: "\"e2\"", rand: () => 0.42,
    };
    const plan = planUndoLast(ctx, [{ etag: "\"e1\"", raw: priorRaw, at: "2026-08-20T09:00:00Z" }]);
    expect(plan).not.toBeNull();
    expect(plan!.newRaw).toBe(priorRaw);
    const afterEv = primaryEvent(parseEvents(plan!.newRaw))!;
    expect(afterEv.summary).toBe("Alter Titel");
    expect(plan!.diff.some((d) => d.field === "title" && d.before === "Zahnärztin Dr. Müller" && d.after === "Alter Titel")).toBe(true);
    expect(plan!.summary).toBe("Letzte Änderung zurücknehmen (Stand von 2026-08-20T09:00:00Z)");
    expect(plan!.hrefForPut).toBe("https://dav.example/cal/simple.ics");
    expect(plan!.contentType).toBe("text/calendar");
    expect(plan!.createsNew).toBe(false);
  });

  it("Contact: newRaw = history[0].raw, diff gegen aktuelles raw", () => {
    const currentRaw = read("vcard/v3-full.vcf");
    const priorRaw = currentRaw.replace("Dr. Florian Brandes", "Florian Brandes");
    const ctx: CommandContext = {
      now: NOW, profile: defaultContactProfile(), collection: CONTACT_COL, account: ACCOUNT,
      target: contactTarget(), raw: currentRaw, etag: "\"e2\"", rand: () => 0.42,
    };
    const plan = planUndoLast(ctx, [{ etag: "\"e1\"", raw: priorRaw, at: "2026-08-20T09:00:00Z" }]);
    const after = parseContact(plan!.newRaw);
    expect(after.fn).toBe("Florian Brandes");
    expect(plan!.contentType).toBe("text/vcard");
  });

  it("nutzt nur history[0], auch wenn mehrere Eintraege vorhanden sind", () => {
    const currentRaw = read("ical/simple.ics");
    const first = currentRaw.replace("Zahnärztin Dr. Müller", "Erster");
    const second = currentRaw.replace("Zahnärztin Dr. Müller", "Zweiter");
    const ctx: CommandContext = {
      now: NOW, profile: defaultEventProfile(), collection: EVENT_COL, account: ACCOUNT,
      target: eventTarget(), raw: currentRaw, etag: "\"e2\"", rand: () => 0.42,
    };
    const plan = planUndoLast(ctx, [{ etag: "\"e1\"", raw: first, at: "2026-08-20T09:00:00Z" }, { etag: "\"e0\"", raw: second, at: "2026-08-19T09:00:00Z" }]);
    expect(plan!.newRaw).toBe(first);
  });
});
