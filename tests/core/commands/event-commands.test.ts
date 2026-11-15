import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_COMMANDS } from "../../../src/core/commands/event-commands";
import { parseEvents, primaryEvent } from "../../../src/core/ical/event";
import { defaultEventProfile } from "../../../src/core/mirror/profile";
import type { Account, CollectionConfig } from "../../../src/core/settings";
import type { CommandContext, CommandTarget } from "../../../src/core/commands/types";
import { validateInput } from "../../../src/core/commands/schema";

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
    expect(plan.summary).toBe("Event moved: 2026-09-02 14:00–15:30");
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

  // Fix C1 (Review-Runde 3): alle vom Schema akzeptierten Zeit-Formen (`DATE_TIME_RE`,
  // src/core/commands/schema.ts) muessen dieselbe Uhrzeit im geplanten VEVENT ergeben —
  // vorher rundete `parseIsoParts` (core/ical/mutate.ts) manche Formen still auf 00:00.
  it.each([
    ["2026-09-02T14:00:00", "2026-09-02T14:00:00"],
    ["2026-09-02T14:00", "2026-09-02T14:00:00"],
    ["2026-09-02 14:00", "2026-09-02T14:00:00"],
    ["2026-09-02 14:00:00", "2026-09-02T14:00:00"],
  ])("event.move mit start=%j -> geplantes VEVENT DTSTART=%j", (input, expected) => {
    const raw = read("simple.ics");
    const c = ctx(raw, existingTarget("simple-1@test", "simple.ics"));
    const plan = find("event.move").plan({ start: input, end: "2026-09-02T15:30:00" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.start).toBe(expected);
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

  it("set-location verlangt einen Wert, das Entfernen ist event.clear-location", () => {
    const c = ctx(read("simple.ics"), existingTarget("simple-1@test", "simple.ics"));
    expect(() => find("event.set-location").plan({ location: "" }, c)).toThrow(expect.objectContaining({ code: "fieldMissing" }));
    const plan = find("event.clear-location").plan({}, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.location).toBeUndefined();
    expect(plan.diff).toEqual([{ field: "location", before: "Praxis am Markt, Hauptstraße 1" }]);
    expect(plan.summary).toBe("Location removed");
  });

  it("clear-url und clear-description entfernen URL und DESCRIPTION", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"));
    const withBoth = find("event.set-url").plan({ url: "https://example.test/join" }, c);
    const withDesc = find("event.set-description").plan({ description: "Agenda folgt" }, { ...c, raw: withBoth.newRaw });
    const c2 = { ...c, raw: withDesc.newRaw };
    const noUrl = find("event.clear-url").plan({}, c2);
    expect(primaryEvent(parseEvents(noUrl.newRaw))!.url).toBeUndefined();
    expect(primaryEvent(parseEvents(noUrl.newRaw))!.description).toBe("Agenda folgt");
    const noDesc = find("event.clear-description").plan({}, c2);
    expect(primaryEvent(parseEvents(noDesc.newRaw))!.description).toBeUndefined();
    expect(primaryEvent(parseEvents(noDesc.newRaw))!.url).toBe("https://example.test/join");
  });

  it("die set-Befehle weisen den leeren Wert schon an der Schema-Pruefung ab (Ursache des toten Loeschzweigs)", () => {
    for (const [id, key] of [["event.set-location", "location"], ["event.set-url", "url"], ["event.set-description", "description"]] as const) {
      const r = validateInput(find(id).schema, { [key]: "" });
      expect(r.ok, id).toBe(false);
    }
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
    expect(() => find("event.set-partstat").plan({ partstat: "ACCEPTED" }, c)).toThrow(expect.objectContaining({ code: "ownAddressUnknown" }));
  });

  it("wirft, wenn die eigene Adresse kein Teilnehmer des Termins ist", () => {
    // ACCOUNT.username = jay@example.test, aber attendees.ics kennt nur alex@ und sam@example.test
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"));
    expect(() => find("event.set-partstat").plan({ partstat: "ACCEPTED" }, c)).toThrow(expect.objectContaining({ code: "ownAddressNotAttendee" }));
  });

  // Fix M5 (Review-Runde 3): ALLE eigenen Adressen (scheduling.addresses ∪ username) werden
  // gegen die Attendee-Liste geprueft, nicht nur scheduling.addresses[0] — vorher warf das
  // Kommando faelschlich, wenn die eigene Teilnehmer-Adresse an einer ANDEREN Stelle stand.
  it("findet die eigene Adresse auch an zweiter Stelle in scheduling.addresses (nicht nur [0])", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"), {
      scheduling: { addresses: ["nicht-attendee@example.test", "sam@example.test"] },
    });
    const plan = find("event.set-partstat").plan({ partstat: "ACCEPTED" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.attendees.find((a) => a.email === "sam@example.test")?.partstat).toBe("ACCEPTED");
  });

  it("findet die eigene Adresse ueber username, wenn scheduling.addresses[0] ein ANDERER (nicht teilnehmender) Alias ist", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"), {
      account: { ...ACCOUNT, username: "sam@example.test" },
      scheduling: { addresses: ["nicht-attendee@example.test"] },
    });
    const plan = find("event.set-partstat").plan({ partstat: "TENTATIVE" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.attendees.find((a) => a.email === "sam@example.test")?.partstat).toBe("TENTATIVE");
  });

  it("vergleicht case-insensitiv", () => {
    const c = ctx(read("attendees.ics"), existingTarget("att-1@test", "attendees.ics"), {
      scheduling: { addresses: ["SAM@EXAMPLE.TEST"] },
    });
    const plan = find("event.set-partstat").plan({ partstat: "ACCEPTED" }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.attendees.find((a) => a.email === "sam@example.test")?.partstat).toBe("ACCEPTED");
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
    expect(plan.summary).toContain("Event created");
  });

  // Fix C1 (Review-Runde 3) — s. Kommentar bei event.move oben.
  it.each([
    ["2026-09-10T09:00:00", "2026-09-10T09:00:00"],
    ["2026-09-10T09:00", "2026-09-10T09:00:00"],
    ["2026-09-10 09:00", "2026-09-10T09:00:00"],
    ["2026-09-10 09:00:00", "2026-09-10T09:00:00"],
  ])("event.create mit start=%j -> geplantes VEVENT DTSTART=%j", (input, expected) => {
    const c = ctx(undefined as unknown as string, { kind: "event", source: "a1/c1", new: true });
    const plan = find("event.create").plan({ title: "Kickoff", start: input }, c);
    const afterEv = primaryEvent(parseEvents(plan.newRaw))!;
    expect(afterEv.start).toBe(expected);
  });

  describe("notePath und alarms", () => {
    const newCtx = (extra: Partial<CommandContext> = {}) => ({ ...ctx(undefined as unknown as string, { kind: "event", source: "a1/c1", new: true }), ...extra });

    it("notePath setzt den Anspruch auf die Notiz mit der erzeugten UID", () => {
      const plan = find("event.create").plan({ title: "Kickoff", start: "2026-09-10T09:00:00", notePath: "Termine/Kickoff.md" }, newCtx({ noteInfo: () => ({ exists: true }) }));
      const uid = primaryEvent(parseEvents(plan.newRaw))!.uid;
      expect(plan.claimsNote).toEqual({ path: "Termine/Kickoff.md", uid });
    });

    it("ohne notePath kein Anspruch", () => {
      const plan = find("event.create").plan({ title: "Kickoff", start: "2026-09-10T09:00:00" }, newCtx());
      expect(plan.claimsNote).toBeUndefined();
    });

    it("eine Notiz, die schon eine dav_uid traegt, wird abgelehnt (zweite Ausfuehrung legt keinen zweiten Termin an)", () => {
      expect(() => find("event.create").plan({ title: "K", start: "2026-09-10T09:00:00", notePath: "a.md" }, newCtx({ noteInfo: () => ({ exists: true, uid: "ev-1@calendar-notes" }) })))
        .toThrow(expect.objectContaining({ code: "noteAlreadyBound", args: ["a.md"] }));
    });

    it("eine fehlende Notiz wird abgelehnt statt eine zweite anzulegen", () => {
      expect(() => find("event.create").plan({ title: "K", start: "2026-09-10T09:00:00", notePath: "a.md" }, newCtx({ noteInfo: () => ({ exists: false }) })))
        .toThrow(expect.objectContaining({ code: "noteNotFound" }));
    });

    it("alarms werden als VALARM mit Dauer-Ausloeser geschrieben", () => {
      const plan = find("event.create").plan({ title: "Zahnarzt", start: "2026-09-10T09:00:00", alarms: ["-P1D", "-PT15M"] }, newCtx());
      const alarms = plan.newRaw.match(/BEGIN:VALARM[\s\S]*?END:VALARM/g) ?? [];
      expect(alarms).toHaveLength(2);
      expect(alarms[0]).toMatch(/ACTION:DISPLAY/);
      expect(alarms[0]).toMatch(/DESCRIPTION:Zahnarzt/);
      expect(alarms[0]).toMatch(/TRIGGER:-P1D/);
      expect(alarms[1]).toMatch(/TRIGGER:-PT15M/);
    });

    it.each(["-P1D", "-PT15M", "PT0S", "-P1W", "-P1DT2H", "+PT5M"])("alarms: %j ist eine Dauer und wird angenommen", (ok) => {
      const plan = find("event.create").plan({ title: "K", start: "2026-09-10T09:00:00", alarms: [ok] }, newCtx());
      expect(plan.newRaw).toContain("BEGIN:VALARM");
    });

    it.each(["", "gestern", "-PT", "P", "15 Minuten", "-P1X", "-P1DT"])("alarms: %j ist keine Dauer und bricht den Plan ab", (bad) => {
      expect(() => find("event.create").plan({ title: "K", start: "2026-09-10T09:00:00", alarms: [bad] }, newCtx()))
        .toThrow(expect.objectContaining({ code: "alarmInvalid" }));
    });

    it("url wird mitgeschrieben (das Schema versprach sie, der Plan verwarf sie)", () => {
      const plan = find("event.create").plan({ title: "K", start: "2026-09-10T09:00:00", url: "https://example.test/x" }, newCtx());
      expect(primaryEvent(parseEvents(plan.newRaw))!.url).toBe("https://example.test/x");
    });

    it("die Schema-Pruefung nimmt alarms als Liste an", () => {
      expect(validateInput(find("event.create").schema, { title: "K", start: "2026-09-10T09:00:00", alarms: ["-P1D"], notePath: "a.md" }).ok).toBe(true);
    });
  });
});
