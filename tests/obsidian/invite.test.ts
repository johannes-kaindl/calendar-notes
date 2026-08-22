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

function fakeTransport(id = "mailstone"): MailTransport {
  return { id, label: id, accounts: async () => [], send: async () => ({ ok: true }) };
}

describe("InviteRouter.route", () => {
  it("waehlt 'server', wenn das Konto einen schedule-outbox hat — unabhaengig von Transporten", () => {
    const router = new InviteRouter(() => [fakeTransport()], {} as never);
    const acc = account({ scheduling: { outbox: "https://dav.example/outbox/", addresses: [] } });
    expect(router.route(acc, PLAN)).toBe("server");
  });

  it("waehlt 'transport', wenn kein outbox aber ein Transport registriert ist", () => {
    const router = new InviteRouter(() => [fakeTransport()], {} as never);
    expect(router.route(account(), PLAN)).toBe("transport");
  });

  it("waehlt 'ics' als letzten Weg (kein outbox, kein Transport)", () => {
    const router = new InviteRouter(() => [], {} as never);
    expect(router.route(account(), PLAN)).toBe("ics");
  });

  it("scheduling ohne outbox (nur inbox/addresses) zaehlt nicht als 'server'", () => {
    const router = new InviteRouter(() => [fakeTransport()], {} as never);
    const acc = account({ scheduling: { addresses: ["mailto:a@example.test"] } });
    expect(router.route(acc, PLAN)).toBe("transport");
  });

  it("liest transports() bei jedem Aufruf frisch (An-/Abmelden zur Laufzeit)", () => {
    let registered: MailTransport[] = [];
    const router = new InviteRouter(() => registered, {} as never);
    expect(router.route(account(), PLAN)).toBe("ics");
    registered = [fakeTransport()];
    expect(router.route(account(), PLAN)).toBe("transport");
  });
});
