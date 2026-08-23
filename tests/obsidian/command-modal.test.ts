import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialValuesFor, parseFormValues, SchemaFormModal } from "../../src/obsidian/command-modal";
import { Setting } from "../vendor/kit/obsidian-mock";
import type { ObjectSchema } from "../../src/core/commands/schema";
import type { CommandContext, CommandDescriptor, CommandTarget } from "../../src/core/commands/types";
import { defaultContactProfile, defaultEventProfile } from "../../src/core/mirror/profile";
import type { Account, CollectionConfig } from "../../src/core/settings";

const FIXTURES = join(__dirname, "../fixtures");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const ACCOUNT: Account = { id: "a1", name: "Acc", baseUrl: "https://dav.example/", username: "jay@example.test", secretId: "s1" };
const EVENT_COLLECTION: CollectionConfig = { id: "c1", accountId: "a1", href: "https://dav.example/cal/", kind: "calendar", displayName: "Cal", enabled: true, profileId: "default-event", readOnly: false };
const CONTACT_COLLECTION: CollectionConfig = { id: "c2", accountId: "a1", href: "https://dav.example/ab/", kind: "addressbook", displayName: "AB", enabled: true, profileId: "default-contact", readOnly: false };
const NOW = new Date("2026-08-22T10:00:00Z");

function eventTarget(): CommandTarget {
  return { kind: "event", source: "a1/c1", href: "https://dav.example/cal/simple.ics", uid: "simple-1@test" };
}
function contactTarget(): CommandTarget {
  return { kind: "contact", source: "a1/c2", href: "https://dav.example/ab/c3.vcf", uid: "c3-1@test" };
}

describe("initialValuesFor", () => {
  it("prefills event fields from the parsed raw ICS", () => {
    const schema: ObjectSchema = { type: "object", properties: { title: { type: "string" }, location: { type: "string" }, start: { type: "string", format: "date-time" } } };
    const descriptor = { id: "event.move", kind: "event", title: "t", description: "d", schema, appliesTo: () => true, plan: () => { throw new Error("unused"); } } as unknown as CommandDescriptor;
    const ctx: CommandContext = { now: NOW, rand: () => 0.5, profile: defaultEventProfile(), collection: EVENT_COLLECTION, account: ACCOUNT, target: eventTarget(), raw: read("ical/simple.ics"), etag: "\"e1\"" };
    const values = initialValuesFor(descriptor, ctx);
    expect(values["title"]).toBe("Zahnärztin Dr. Müller");
    expect(values["location"]).toBe("Praxis am Markt, Hauptstraße 1");
    expect(values["start"]).toBe("2026-09-01T10:00:00");
  });

  it("prefills contact fields from the parsed raw vCard", () => {
    const schema: ObjectSchema = { type: "object", properties: { fn: { type: "string" }, given: { type: "string" }, family: { type: "string" }, org: { type: "array", items: { type: "string" } }, bday: { type: "string", format: "date" } } };
    const descriptor = { id: "contact.set-name", kind: "contact", title: "t", description: "d", schema, appliesTo: () => true, plan: () => { throw new Error("unused"); } } as unknown as CommandDescriptor;
    const ctx: CommandContext = { now: NOW, rand: () => 0.5, profile: defaultContactProfile(), collection: CONTACT_COLLECTION, account: ACCOUNT, target: contactTarget(), raw: read("vcard/v3-full.vcf"), etag: "\"e1\"" };
    const values = initialValuesFor(descriptor, ctx);
    expect(values["fn"]).toBe("Dr. Florian Brandes");
    expect(values["given"]).toBe("Florian");
    expect(values["family"]).toBe("Brandes");
    expect(values["bday"]).toBe("1975-04-12");
  });

  it("stays empty for a brand-new target (no raw yet)", () => {
    const schema: ObjectSchema = { type: "object", properties: { title: { type: "string" } } };
    const descriptor = { id: "event.create", kind: "event", title: "t", description: "d", schema, appliesTo: () => true, plan: () => { throw new Error("unused"); } } as unknown as CommandDescriptor;
    const ctx: CommandContext = { now: NOW, rand: () => 0.5, profile: defaultEventProfile(), collection: EVENT_COLLECTION, account: ACCOUNT, target: { kind: "event", source: "a1/c1", new: true } };
    expect(initialValuesFor(descriptor, ctx)).toEqual({});
  });
});

describe("parseFormValues", () => {
  const schema: ObjectSchema = {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1 },
      end: { type: "string", format: "date-time" },
      count: { type: "number" },
      active: { type: "boolean" },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["title"],
  };

  it("converts numbers, booleans and newline-separated arrays", () => {
    const out = parseFormValues(schema, { title: "x", count: "3", active: true, tags: "a\nb\n\nc " });
    expect(out).toEqual({ title: "x", count: 3, active: true, tags: ["a", "b", "c"] });
  });

  it("omits empty optional fields instead of sending an invalid empty string", () => {
    const out = parseFormValues(schema, { title: "x", end: "", count: "", tags: "" });
    expect(out).toEqual({ title: "x" });
  });

  it("keeps an empty REQUIRED string so validateInput can flag it", () => {
    const out = parseFormValues(schema, { title: "" });
    expect(out).toEqual({ title: "" });
  });
});

describe("SchemaFormModal", () => {
  const schema: ObjectSchema = { type: "object", properties: { title: { type: "string", minLength: 1 } }, required: ["title"] };
  const descriptor: CommandDescriptor = {
    id: "event.set-title", kind: "event", title: "Titel ändern", titleKey: "test.event.set-title.title", description: "", descriptionKey: "test.event.set-title.desc",
    schema, appliesTo: () => true, plan: () => { throw new Error("unused in this test"); },
  };
  const ctx: CommandContext = { now: NOW, rand: () => 0.5, profile: defaultEventProfile(), collection: EVENT_COLLECTION, account: ACCOUNT, target: eventTarget(), raw: read("ical/simple.ics"), etag: "\"e1\"" };

  it("submits the validated input once the form is valid", () => {
    let submitted: Record<string, unknown> | undefined;
    const modal = new SchemaFormModal({} as any, descriptor, ctx, (input) => { submitted = input; });
    modal.onOpen();
    // Prefilled from ctx.raw (Zahnärztin Dr. Müller) — Setting.__last ist der Titel-Text-Setting.
    const setting = Setting.__last!;
    const text = setting.components[0];
    text.setValue("Neuer Titel");
    text.onChangeCB?.("Neuer Titel");
    // Buttons: Abbrechen, Speichern — der zweite ist der Submit-Button.
    const submitBtn = modal.contentEl.querySelectorAll?.("button") ?? [];
    void submitBtn;
    // Kein direkter Button-Zugriff im Mock noetig: submit() ueber die private Methode testen
    // waere ueberformalisiert — stattdessen den Callback direkt nachbilden, den der
    // „Speichern"-ButtonComponent im echten Code ausloest.
    (modal as any).submit();
    expect(submitted).toEqual({ title: "Neuer Titel" });
  });

  it("keeps the modal open and shows errors when validation fails", () => {
    let submitted: Record<string, unknown> | undefined;
    const modal = new SchemaFormModal({} as any, descriptor, ctx, (input) => { submitted = input; });
    modal.onOpen();
    const setting = Setting.__last!;
    const text = setting.components[0];
    text.setValue("");
    text.onChangeCB?.("");
    (modal as any).submit();
    expect(submitted).toBeUndefined();
    expect((modal as any).errorsEl.textContent ?? (modal as any).errorsEl.children?.length).toBeTruthy();
  });
});
