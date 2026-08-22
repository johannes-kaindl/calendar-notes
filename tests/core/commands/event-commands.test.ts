import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_COMMANDS } from "../../../src/core/commands/event-commands";
import { parseEvents, primaryEvent } from "../../../src/core/ical/event";
import { defaultEventProfile } from "../../../src/core/mirror/profile";
import type { Account, CollectionConfig } from "../../../src/core/settings";
import type { CommandContext, CommandTarget } from "../../../src/core/commands/types";

const FIXTURES = join(__dirname, "../../fixtures/ical");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const ACCOUNT: Account = { id: "a1", name: "Acc", baseUrl: "https://dav.example/", username: "jay@example.test", secretId: "s1" };
const COLLECTION: CollectionConfig = { id: "c1", accountId: "a1", href: "https://dav.example/cal/", kind: "calendar", displayName: "Cal", enabled: true, profileId: "default-event", readOnly: false };
const NOW = new Date("2026-08-22T10:00:00Z");

function existingTarget(uid: string, filename: string): CommandTarget {
  return { kind: "event", source: "a1/c1", href: `https://dav.example/cal/${filename}`, uid };
}

function ctx(raw: string, target: CommandTarget, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile: defaultEventProfile(), collection: COLLECTION, account: ACCOUNT,
    target, raw, etag: "\"e1\"", rand: () => 0.42, ...overrides,
  };
}

function find(id: string) {
  const d = EVENT_COMMANDS.find((c) => c.id === id);
  if (!d) throw new Error(`Kommando ${id} nicht gefunden`);
  return d;
}

describe("event-commands: appliesTo", () => {
  it("Kommandos fuer bestehende Termine gelten nur bei event-Target mit href + raw", () => {
    const c = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    expect(find("event.move").appliesTo(c)).toBe(true);
    expect(find("event.set-title").appliesTo(c)).toBe(true);
    expect(find("event.create").appliesTo(c)).toBe(false);

    const contactLikeCtx = { ...c, target: { kind: "event" as const, source: "a1/c1", new: true as const } };
    expect(find("event.move").appliesTo(contactLikeCtx)).toBe(false);

    const noRawCtx = { ...c, raw: undefined };
    expect(find("event.move").appliesTo(noRawCtx)).toBe(false);
  });

  it("event.create gilt nur fuer neue Targets", () => {
    const c = ctx(undefined as unknown as string, { kind: "event", source: "a1/c1", new: true });
    expect(find("event.create").appliesTo(c)).toBe(true);
    const existing = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    expect(find("event.create").appliesTo(existing)).toBe(false);
  });
});

describe("event.move", () => {
  it("verschiebt Start/Ende, uebernimmt tzid aus dem Bestand, diff nur start/end, bumpt sequence", () => {
    const raw = read("simple.ics");
    const c = ctx(raw, existingTarget("simple-1@test", "simple.ics"));
    const plan = find("event.move").plan({ start: "2026-09-02T14:00:00", end: "2026-09-02T15:30:00" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.start).toBe("2026-09-02T14:00:00");
    expect(afterEv.tzid).toBe("Europe/Berlin");
    expect(afterEv.sequence).toBe(3);
    expect(plan.diff.map((d) => d.field).sort()).toEqual(["end", "start"]);
    expect(plan.summary).toBe("Termin verschoben: 2026-09-02 14:00–15:30");
    expect(plan.hrefForPut).toBe("https://dav.example/cal/simple.ics");
    expect(plan.etag).toBe("\"e1\"");
    expect(plan.createsNew).toBe(false);
    expect(plan.contentType).toBe("text/calendar");
  });

  it("respektiert explizit uebergebenes tzid und allDay", () => {
    const raw = read("allday.ics");
    const c = ctx(raw, existingTarget("allday-1@test", "allday.ics"));
    const plan = find("event.move").plan({ start: "2026-12-25", allDay: true }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.allDay).toBe(true);
    expect(afterEv.start).toBe("2026-12-25");
  });
});

describe("event.set-title / set-location / set-url / set-description", () => {
  it("set-title aendert SUMMARY und bumpt sequence", () => {
    const c = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    const plan = find("event.set-title").plan({ title: "Zahnarzt (neu)" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.summary).toBe("Zahnarzt (neu)");
    expect(afterEv.sequence).toBe(3);
    expect(plan.diff).toEqual([{ field: "title", before: "Zahnärztin Dr. Müller", after: "Zahnarzt (neu)" }]);
    expect(plan.summary).toContain("Zahnarzt (neu)");
  });

  it("set-location mit leerem String entfernt LOCATION", () => {
    const c = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    const plan = find("event.set-location").plan({ location: "" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.location).toBeUndefined();
    expect(plan.diff).toEqual([{ field: "location", before: "Praxis am Markt, Hauptstraße 1" }]);
    expect(plan.summary).toBe("Ort entfernt");
  });

  it("set-url setzt URL", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"));
    const plan = find("event.set-url").plan({ url: "https://example.test/join" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.url).toBe("https://example.test/join");
  });

  it("set-description setzt DESCRIPTION", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"));
    const plan = find("event.set-description").plan({ description: "Agenda folgt" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.description).toBe("Agenda folgt");
  });
});

describe("event.add-attendee / event.remove-attendee", () => {
  it("add-attendee fuegt Teilnehmer hinzu und erzeugt invite REQUEST (rsvp default true)", () => {
    const c = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    const plan = find("event.add-attendee").plan({ email: "neu@example.test", name: "Neu" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.attendees.map((a) => a.email)).toEqual(["neu@example.test"]);
    expect(plan.invite).toEqual({ attendees: ["neu@example.test"], method: "REQUEST" });
  });

  it("add-attendee ohne invite bei rsvp:false", () => {
    const c = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    const plan = find("event.add-attendee").plan({ email: "neu@example.test", rsvp: false }, c);
    expect(plan.invite).toBeUndefined();
  });

  it("remove-attendee entfernt Teilnehmer, invite CANCEL nur mit Scheduling", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"));
    const planNoScheduling = find("event.remove-attendee").plan({ email: "sam@example.test" }, c);
    expect(planNoScheduling.invite).toBeUndefined();
    const afterEv = primaryEvent(parseEvents(planNoScheduling.newRaw))!;
    expect(afterEv.attendees.map((a) => a.email)).toEqual(["alex@example.test"]);

    const withScheduling = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"), { scheduling: { addresses: ["jay@example.test"], outbox: "https://dav.example/outbox/" } });
    const planScheduled = find("event.remove-attendee").plan({ email: "sam@example.test" }, withScheduling);
    expect(planScheduled.invite).toEqual({ attendees: ["sam@example.test"], method: "CANCEL" });
  });
});

describe("event.set-partstat", () => {
  it("verwendet ctx.scheduling.addresses[0] wenn vorhanden", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"), { scheduling: { addresses: ["sam@example.test"] } });
    const plan = find("event.set-partstat").plan({ partstat: "ACCEPTED" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.attendees.find((a) => a.email === "sam@example.test")?.partstat).toBe("ACCEPTED");
    // partstat bumpt laut mutate.ts die sequence NICHT
    expect(afterEv.sequence).toBe(primaryEvent(parseEvents(read("attendees.ics")))!.sequence);
  });

  it("faellt auf account.username zurueck, wenn dieser eine E-Mail ist", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"), { account: { ...ACCOUNT, username: "alex@example.test" } });
    const plan = find("event.set-partstat").plan({ partstat: "DECLINED" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.attendees.find((a) => a.email === "alex@example.test")?.partstat).toBe("DECLINED");
  });

  it("wirft, wenn keine eigene Adresse bekannt ist", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"), { account: { ...ACCOUNT, username: "nicht-email" } });
    expect(() => find("event.set-partstat").plan({ partstat: "ACCEPTED" }, c)).toThrow("Eigene Adresse unbekannt");
  });

  it("wirft, wenn die eigene Adresse kein Teilnehmer des Termins ist", () => {
    // ACCOUNT.username = jay@example.test, aber attendees.ics kennt nur alex@ und sam@example.test
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"));
    expect(() => find("event.set-partstat").plan({ partstat: "ACCEPTED" }, c)).toThrow("Eigene Adresse ist kein Teilnehmer dieses Termins");
  });
});

describe("event.delete", () => {
  it("liefert delete:true mit leerem newRaw", () => {
    const c = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    const plan = find("event.delete").plan({}, c);
    expect(plan.delete).toBe(true);
    expect(plan.newRaw).toBe("");
    expect(plan.hrefForPut).toBe("https://dav.example/cal/simple.ics");
    expect(plan.createsNew).toBe(false);
  });
});

describe("event.create", () => {
  it("baut einen neuen Termin mit generierter uid und hrefForPut", () => {
    const c = ctx(undefined as unknown as string, { kind: "event", source: "a1/c1", new: true });
    const plan = find("event.create").plan({ title: "Kickoff", start: "2026-09-10T09:00:00Z", end: "2026-09-10T10:00:00Z", location: "Büro" }, c);
    expect(plan.createsNew).toBe(true);
    expect(plan.hrefForPut).toMatch(/^https:\/\/dav\.example\/cal\/ev-[a-z0-9]{8}@calendar-notes\.ics$/);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.summary).toBe("Kickoff");
    expect(afterEv.location).toBe("Büro");
    expect(afterEv.start).toBe("2026-09-10T09:00:00Z");
    expect(plan.diff.every((d) => d.before === undefined)).toBe(true);
    expect(plan.diff.some((d) => d.field === "title" && d.after === "Kickoff")).toBe(true);
    expect(plan.summary).toContain("Termin angelegt");
  });
});
