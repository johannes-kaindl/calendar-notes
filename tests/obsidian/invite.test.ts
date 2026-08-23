import { describe, it, expect } from "vitest";
import { InviteRouter, type MailTransport } from "../../src/obsidian/invite";
import type { CommandPlan } from "../../src/core/commands/types";
import type { Account } from "../../src/core/settings";

const PLAN: CommandPlan = {
  commandId: "event.set-invite",
  target: { kind: "event", source: "acc1/cal1", href: "https://dav.example/cal1/evt-1.ics", uid: "evt-1" },
  summary: "Test",
  diff: [],
  newRaw: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
  etag: '"e1"',
  contentType: "text/calendar",
  hrefForPut: "https://dav.example/cal1/evt-1.ics",
  createsNew: false,
  invite: { attendees: ["a@example.test"], method: "REQUEST" },
};

function account(overrides: Partial<Account> = {}): Account {
  return { id: "acc1", name: "Acc", baseUrl: "https://dav.example/", username: "u", secretId: "sec1", ...overrides };
}

function fakeTransport(id = "mailstone", identities: { id: string; address: string; label: string }[] = [{ id: "mail@example.test", address: "mail@example.test", label: "mail@" }]): MailTransport {
  return { id, label: id, accounts: async () => identities, send: async () => ({ ok: true }) };
}

function emptyTransport(id = "mailstone"): MailTransport {
  return fakeTransport(id, []);
}

describe("InviteRouter.route", () => {
  it("waehlt 'server', wenn das Konto einen schedule-outbox hat — unabhaengig von Transporten (auch ohne Identitaeten)", async () => {
    const router = new InviteRouter(() => [emptyTransport()], {} as never);
    const acc = account({ scheduling: { outbox: "https://dav.example/outbox/", addresses: [] } });
    expect(await router.route(acc, PLAN)).toBe("server");
  });

  it("waehlt 'transport', wenn kein outbox aber ein Transport MIT mindestens einer Identitaet registriert ist", async () => {
    const router = new InviteRouter(() => [fakeTransport()], {} as never);
    expect(await router.route(account(), PLAN)).toBe("transport");
  });

  it("faellt auf 'ics' zurueck, wenn der registrierte Transport KEINE Identitaeten hat (Fix-Runde 1, Punkt 2)", async () => {
    const router = new InviteRouter(() => [emptyTransport()], {} as never);
    expect(await router.route(account(), PLAN)).toBe("ics");
  });

  it("waehlt 'transport', sobald IRGENDEIN registrierter Transport eine Identitaet hat (nicht nur der erste)", async () => {
    const router = new InviteRouter(() => [emptyTransport("a"), fakeTransport("b")], {} as never);
    expect(await router.route(account(), PLAN)).toBe("transport");
  });

  it("ein werfender accounts()-Aufruf blockiert die Routen-Wahl nicht", async () => {
    const throwing: MailTransport = { id: "broken", label: "broken", accounts: () => Promise.reject(new Error("kaputt")), send: async () => ({ ok: true }) };
    const router = new InviteRouter(() => [throwing, fakeTransport()], {} as never);
    expect(await router.route(account(), PLAN)).toBe("transport");
  });

  it("waehlt 'ics' als letzten Weg (kein outbox, kein Transport)", async () => {
    const router = new InviteRouter(() => [], {} as never);
    expect(await router.route(account(), PLAN)).toBe("ics");
  });

  it("scheduling ohne outbox (nur inbox/addresses) zaehlt nicht als 'server'", async () => {
    const router = new InviteRouter(() => [fakeTransport()], {} as never);
    const acc = account({ scheduling: { addresses: ["mailto:a@example.test"] } });
    expect(await router.route(acc, PLAN)).toBe("transport");
  });

  it("liest transports() bei jedem Aufruf frisch (An-/Abmelden zur Laufzeit)", async () => {
    let registered: MailTransport[] = [];
    const router = new InviteRouter(() => registered, {} as never);
    expect(await router.route(account(), PLAN)).toBe("ics");
    registered = [fakeTransport()];
    expect(await router.route(account(), PLAN)).toBe("transport");
  });
});
