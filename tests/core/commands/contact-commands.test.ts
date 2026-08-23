import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTACT_COMMANDS } from "../../../src/core/commands/contact-commands";
import { validateInput } from "../../../src/core/commands/schema";
import { parseContact } from "../../../src/core/vcard/contact";
import { defaultContactProfile } from "../../../src/core/mirror/profile";
import type { Account, CollectionConfig } from "../../../src/core/settings";
import type { CommandContext, CommandTarget } from "../../../src/core/commands/types";

const FIXTURES = join(__dirname, "../../fixtures/vcard");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const ACCOUNT: Account = { id: "a1", name: "Acc", baseUrl: "https://dav.example/", username: "jay@example.test", secretId: "s1" };
const COLLECTION: CollectionConfig = { id: "ab1", accountId: "a1", href: "https://dav.example/ab/", kind: "addressbook", displayName: "AB", enabled: true, profileId: "default-contact", readOnly: false };
const NOW = new Date("2026-08-22T10:00:00Z");

function existingTarget(uid: string, filename: string): CommandTarget {
  return { kind: "contact", source: "a1/ab1", href: `https://dav.example/ab/${filename}`, uid };
}

function ctx(raw: string, target: CommandTarget, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    now: NOW, profile: defaultContactProfile(), collection: COLLECTION, account: ACCOUNT,
    target, raw, etag: "\"e1\"", rand: () => 0.42, ...overrides,
  };
}

function find(id: string) {
  const d = CONTACT_COMMANDS.find((c) => c.id === id);
  if (!d) throw new Error(`Kommando ${id} nicht gefunden`);
  return d;
}

describe("contact-commands: appliesTo", () => {
  it("Kommandos fuer bestehende Kontakte gelten nur bei contact-Target mit href + raw", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(find("contact.set-name").appliesTo(c)).toBe(true);
    expect(find("contact.create").appliesTo(c)).toBe(false);
    const newCtx = { ...c, target: { kind: "contact" as const, source: "a1/ab1", new: true as const } };
    expect(find("contact.set-name").appliesTo(newCtx)).toBe(false);
    expect(find("contact.create").appliesTo(newCtx)).toBe(true);
  });
});

describe("contact.set-name", () => {
  it("aendert FN und optional given/family (N bleibt sonst erhalten)", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.set-name").plan({ fn: "Dr. Florian B.", given: "Flori" }, c);
    const after = parseContact(plan.newRaw);
    expect(after.fn).toBe("Dr. Florian B.");
    expect(after.n?.given).toBe("Flori");
    expect(after.n?.family).toBe("Brandes");
    expect(plan.diff.some((d) => d.field === "fn")).toBe(true);
    expect(plan.diff.some((d) => d.field === "given")).toBe(true);
  });
});

describe("contact.set-email / contact.remove-email", () => {
  it("set-email mit index 'new' fuegt hinzu", () => {
    const c = ctx(read("v4-min.vcf"), existingTarget("c4-1@test", "v4-min.vcf"));
    const plan = find("contact.set-email").plan({ value: "zweite@example.test", types: ["work"] }, c);
    const after = parseContact(plan.newRaw);
    expect(after.emails.map((e) => e.value)).toContain("zweite@example.test");
  });

  it("set-email mit numerischem index ueberschreibt bestehenden Eintrag", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.set-email").plan({ index: "0", value: "neu@example.test" }, c);
    const after = parseContact(plan.newRaw);
    expect(after.emails[0]?.value).toBe("neu@example.test");
    expect(after.emails.length).toBe(2);
  });

  it("remove-email entfernt per Index", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.remove-email").plan({ index: 1 }, c);
    const after = parseContact(plan.newRaw);
    expect(after.emails.length).toBe(1);
  });

  it("set-email mit Index ausserhalb wirft", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(() => find("contact.set-email").plan({ index: "5", value: "x@example.test" }, c)).toThrow("Index außerhalb: 5");
  });

  it("remove-email mit Index ausserhalb (auch negativ) wirft", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(() => find("contact.remove-email").plan({ index: 2 }, c)).toThrow("Index außerhalb: 2");
    expect(() => find("contact.remove-email").plan({ index: -1 }, c)).toThrow("Index außerhalb: -1");
  });

  // Fix M6 (Review-Runde 3): index ist bei allen vier Kontakt-Kommandos konsistent ein
  // String-Schema — vorher schrieb remove-email/remove-phone `type: "number"`, obwohl
  // set-email/set-phone (und parseIndex()) String-Indizes erwarten.
  it("remove-email: schema akzeptiert einen String-Index (validateInput)", () => {
    const schema = find("contact.remove-email").schema;
    expect(validateInput(schema, { index: "1" }).ok).toBe(true);
  });

  it("remove-email: index='1' (String statt Number) funktioniert identisch zu index=1", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.remove-email").plan({ index: "1" }, c);
    const after = parseContact(plan.newRaw);
    expect(after.emails.length).toBe(1);
  });

  it("remove-email mit index='new' wirft (nichts zu entfernen)", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(() => find("contact.remove-email").plan({ index: "new" }, c)).toThrow("index darf nicht \"new\" sein");
  });
});

describe("contact.set-phone / contact.remove-phone", () => {
  it("set-phone neu mit types", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.set-phone").plan({ value: "+49 30 123", types: ["home"] }, c);
    const after = parseContact(plan.newRaw);
    expect(after.tels.some((t) => t.value === "+49 30 123" && t.types.includes("home"))).toBe(true);
  });

  it("remove-phone entfernt per Index", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.remove-phone").plan({ index: 0 }, c);
    const after = parseContact(plan.newRaw);
    expect(after.tels.length).toBe(1);
  });

  it("set-phone mit Index ausserhalb wirft", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(() => find("contact.set-phone").plan({ index: "9", value: "+49 1" }, c)).toThrow("Index außerhalb: 9");
  });

  it("remove-phone mit Index ausserhalb wirft", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(() => find("contact.remove-phone").plan({ index: 7 }, c)).toThrow("Index außerhalb: 7");
  });

  // Fix M6 — s. Kommentar bei contact.remove-email oben.
  it("remove-phone: schema akzeptiert einen String-Index (validateInput)", () => {
    const schema = find("contact.remove-phone").schema;
    expect(validateInput(schema, { index: "0" }).ok).toBe(true);
  });

  it("remove-phone mit index='new' wirft (nichts zu entfernen)", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(() => find("contact.remove-phone").plan({ index: "new" }, c)).toThrow("index darf nicht \"new\" sein");
  });

  it("set-email/set-phone mit index 'new' pruefen nicht gegen den Bestand", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    expect(() => find("contact.set-email").plan({ value: "x@example.test" }, c)).not.toThrow();
    expect(() => find("contact.set-phone").plan({ value: "+49 1" }, c)).not.toThrow();
  });
});

describe("contact.set-org / set-title / set-note / set-birthday", () => {
  it("set-org setzt Organisation als Array", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.set-org").plan({ org: ["Neue Praxis", "Abteilung"] }, c);
    const after = parseContact(plan.newRaw);
    expect(after.org).toEqual(["Neue Praxis", "Abteilung"]);
  });

  it("set-title mit leerem String entfernt TITLE", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.set-title").plan({ title: "" }, c);
    const after = parseContact(plan.newRaw);
    expect(after.title).toBeUndefined();
    expect(plan.summary).toBe("Berufsbezeichnung entfernt");
  });

  it("set-note setzt NOTE", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.set-note").plan({ note: "Neue Notiz" }, c);
    const after = parseContact(plan.newRaw);
    expect(after.note).toBe("Neue Notiz");
  });

  it("set-birthday setzt BDAY", () => {
    const c = ctx(read("v3-full.vcf"), existingTarget("c3-1@test", "v3-full.vcf"));
    const plan = find("contact.set-birthday").plan({ bday: "1980-01-02" }, c);
    const after = parseContact(plan.newRaw);
    expect(after.bday).toBe("1980-01-02");
  });
});

describe("contact.create", () => {
  it("baut einen neuen Kontakt mit generierter uid und hrefForPut", () => {
    const c = ctx(undefined as unknown as string, { kind: "contact", source: "a1/ab1", new: true });
    const plan = find("contact.create").plan({ fn: "Neue Person", email: "neu@example.test", org: "Firma X" }, c);
    expect(plan.createsNew).toBe(true);
    expect(plan.hrefForPut).toMatch(/^https:\/\/dav\.example\/ab\/ct-[a-z0-9]{8}@calendar-notes\.vcf$/);
    const after = parseContact(plan.newRaw);
    expect(after.fn).toBe("Neue Person");
    expect(after.emails[0]?.value).toBe("neu@example.test");
    expect(plan.diff.every((d) => d.before === undefined)).toBe(true);
  });
});
