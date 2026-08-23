import { describe, it, expect, beforeEach } from "vitest";
import { Notice } from "../vendor/kit/obsidian-mock";
import { createMailTransportRegistry } from "../../src/obsidian/plugin-host";
import type { MailTransport } from "../../src/obsidian/invite";

function transport(overrides: Partial<MailTransport> = {}): MailTransport {
  return { id: "mailstone", label: "Mailstone", accounts: async () => [], send: async () => ({ ok: true }), ...overrides };
}

beforeEach(() => {
  Notice.instances.length = 0;
});

describe("createMailTransportRegistry", () => {
  it("registriert einen formkorrekten Transport", () => {
    const reg = createMailTransportRegistry();
    reg.register(transport());
    expect(reg.list().map((t) => t.id)).toEqual(["mailstone"]);
    expect(Notice.instances).toHaveLength(0);
  });

  it("lehnt einen Transport mit leerem label ab und meldet eine Notice", () => {
    const reg = createMailTransportRegistry();
    reg.register(transport({ label: "" }));
    expect(reg.list()).toEqual([]);
    expect(Notice.instances).toHaveLength(1);
  });

  it("lehnt einen Transport mit leerer id ab", () => {
    const reg = createMailTransportRegistry();
    reg.register(transport({ id: "" }));
    expect(reg.list()).toEqual([]);
    expect(Notice.instances).toHaveLength(1);
  });

  it("lehnt ein Objekt ohne accounts()/send() ab", () => {
    const reg = createMailTransportRegistry();
    reg.register({ id: "x", label: "X" } as unknown as MailTransport);
    expect(reg.list()).toEqual([]);
  });

  it("unregister entfernt einen registrierten Transport", () => {
    const reg = createMailTransportRegistry();
    reg.register(transport());
    reg.unregister("mailstone");
    expect(reg.list()).toEqual([]);
  });
});
