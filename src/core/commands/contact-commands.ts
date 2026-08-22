import { parseContact, type ContactData } from "../vcard/contact";
import { applyContactMutation, newContactVcf, type ContactMutation } from "../vcard/mutate";
import { newId } from "../settings";
import type { CommandContext, CommandDescriptor, CommandPlan, CommandTarget } from "./types";

export function hrefOfContactTarget(target: CommandTarget): string {
  return "href" in target ? target.href : "";
}

function appliesToExistingContact(ctx: CommandContext): boolean {
  return ctx.target.kind === "contact" && "href" in ctx.target && typeof ctx.raw === "string";
}

function appliesToNewContact(ctx: CommandContext): boolean {
  return ctx.target.kind === "contact" && "new" in ctx.target && ctx.target.new === true;
}

const CONTACT_DIFF_FIELDS = ["fn", "given", "family", "org", "title", "note", "bday", "emails", "tels"] as const;

function typedList(items: { value: string; types: string[] }[]): string | undefined {
  return items.length ? items.map((t) => `${t.value}:${t.types.join("/")}`).sort().join(", ") : undefined;
}

function contactFieldValue(c: ContactData, field: (typeof CONTACT_DIFF_FIELDS)[number]): string | undefined {
  switch (field) {
    case "fn": return c.fn || undefined;
    case "given": return c.n?.given;
    case "family": return c.n?.family;
    case "org": return c.org && c.org.length ? c.org.join(" / ") : undefined;
    case "title": return c.title;
    case "note": return c.note;
    case "bday": return c.bday;
    case "emails": return typedList(c.emails);
    case "tels": return typedList(c.tels);
  }
}

export function diffContactFields(before: ContactData | undefined, after: ContactData): { field: string; before?: string; after?: string }[] {
  const out: { field: string; before?: string; after?: string }[] = [];
  for (const field of CONTACT_DIFF_FIELDS) {
    const b = before ? contactFieldValue(before, field) : undefined;
    const a = contactFieldValue(after, field);
    if (b !== a) out.push({ field, ...(b !== undefined ? { before: b } : {}), ...(a !== undefined ? { after: a } : {}) });
  }
  return out;
}

function planForContactMutations(id: string, ctx: CommandContext, mutations: ContactMutation[], summary: string): CommandPlan {
  const before = ctx.raw;
  if (before === undefined) throw new Error(`${id}: kein Rohdaten (raw) vorhanden`);
  const beforeContact = parseContact(before);
  const newRaw = mutations.reduce((raw, m) => applyContactMutation(raw, m, { now: ctx.now }), before);
  const afterContact = parseContact(newRaw);
  const diff = diffContactFields(beforeContact, afterContact);
  return {
    commandId: id, target: ctx.target, summary, diff, newRaw,
    etag: ctx.etag, contentType: "text/vcard", hrefForPut: hrefOfContactTarget(ctx.target), createsNew: false,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseIndex(v: unknown): number | "new" {
  if (v === undefined || v === "new") return "new";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : "new";
}

const contactSetName: CommandDescriptor = {
  id: "contact.set-name", kind: "contact", title: "Namen aendern", description: "FN und optional Vor-/Nachname (N) eines Kontakts setzen",
  schema: {
    type: "object",
    properties: { fn: { type: "string", minLength: 1 }, given: { type: "string" }, family: { type: "string" } },
    required: ["fn"],
  },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const fn = str(input["fn"]);
    if (!fn) throw new Error("contact.set-name: fn fehlt");
    const mutations: ContactMutation[] = [{ kind: "fn", fn }];
    const given = str(input["given"]);
    const family = str(input["family"]);
    if (given !== undefined || family !== undefined) {
      const beforeContact = parseContact(ctx.raw ?? "");
      mutations.push({ kind: "n", n: { ...beforeContact.n, given: given ?? beforeContact.n?.given, family: family ?? beforeContact.n?.family } });
    }
    return planForContactMutations("contact.set-name", ctx, mutations, `Name geändert: "${fn}"`);
  },
};

const contactSetEmail: CommandDescriptor = {
  id: "contact.set-email", kind: "contact", title: "E-Mail setzen", description: "E-Mail-Adresse setzen oder eine neue hinzufuegen",
  schema: {
    type: "object",
    properties: {
      index: { type: "string", description: "Index eines bestehenden Eintrags oder \"new\"" },
      value: { type: "string", format: "email" },
      types: { type: "array", items: { type: "string" } },
    },
    required: ["value"],
  },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const value = str(input["value"]);
    if (!value) throw new Error("contact.set-email: value fehlt");
    const index = parseIndex(input["index"]);
    const types = Array.isArray(input["types"]) ? (input["types"] as unknown[]).map(String) : undefined;
    return planForContactMutations("contact.set-email", ctx, [{ kind: "setEmail", index, value, types }], `E-Mail gesetzt: ${value}`);
  },
};

const contactRemoveEmail: CommandDescriptor = {
  id: "contact.remove-email", kind: "contact", title: "E-Mail entfernen", description: "E-Mail-Adresse per Index entfernen",
  schema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const index = typeof input["index"] === "number" ? input["index"] : Number(input["index"]);
    return planForContactMutations("contact.remove-email", ctx, [{ kind: "removeEmail", index }], "E-Mail entfernt");
  },
};

const contactSetPhone: CommandDescriptor = {
  id: "contact.set-phone", kind: "contact", title: "Telefonnummer setzen", description: "Telefonnummer setzen oder eine neue hinzufuegen",
  schema: {
    type: "object",
    properties: {
      index: { type: "string", description: "Index eines bestehenden Eintrags oder \"new\"" },
      value: { type: "string" },
      types: { type: "array", items: { type: "string" } },
    },
    required: ["value"],
  },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const value = str(input["value"]);
    if (!value) throw new Error("contact.set-phone: value fehlt");
    const index = parseIndex(input["index"]);
    const types = Array.isArray(input["types"]) ? (input["types"] as unknown[]).map(String) : undefined;
    return planForContactMutations("contact.set-phone", ctx, [{ kind: "setTel", index, value, types }], `Telefonnummer gesetzt: ${value}`);
  },
};

const contactRemovePhone: CommandDescriptor = {
  id: "contact.remove-phone", kind: "contact", title: "Telefonnummer entfernen", description: "Telefonnummer per Index entfernen",
  schema: { type: "object", properties: { index: { type: "number" } }, required: ["index"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const index = typeof input["index"] === "number" ? input["index"] : Number(input["index"]);
    return planForContactMutations("contact.remove-phone", ctx, [{ kind: "removeTel", index }], "Telefonnummer entfernt");
  },
};

const contactSetOrg: CommandDescriptor = {
  id: "contact.set-org", kind: "contact", title: "Organisation aendern", description: "Organisation (ORG) setzen oder loeschen",
  schema: { type: "object", properties: { org: { type: "array", items: { type: "string" } } }, required: ["org"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const org = Array.isArray(input["org"]) ? (input["org"] as unknown[]).map(String) : [];
    const summary = org.length ? `Organisation geändert: "${org.join(" / ")}"` : "Organisation entfernt";
    return planForContactMutations("contact.set-org", ctx, [{ kind: "org", org: org.length ? org : null }], summary);
  },
};

const contactSetTitle: CommandDescriptor = {
  id: "contact.set-title", kind: "contact", title: "Berufsbezeichnung aendern", description: "TITLE eines Kontakts setzen oder loeschen",
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const title = str(input["title"]) ?? "";
    const summary = title ? `Berufsbezeichnung geändert: "${title}"` : "Berufsbezeichnung entfernt";
    return planForContactMutations("contact.set-title", ctx, [{ kind: "title", title: title || null }], summary);
  },
};

const contactSetNote: CommandDescriptor = {
  id: "contact.set-note", kind: "contact", title: "Notiz aendern", description: "NOTE eines Kontakts setzen oder loeschen",
  schema: { type: "object", properties: { note: { type: "string", format: "multiline" } }, required: ["note"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const note = str(input["note"]) ?? "";
    const summary = note ? "Notiz geändert" : "Notiz entfernt";
    return planForContactMutations("contact.set-note", ctx, [{ kind: "note", note: note || null }], summary);
  },
};

const contactSetBirthday: CommandDescriptor = {
  id: "contact.set-birthday", kind: "contact", title: "Geburtstag aendern", description: "BDAY eines Kontakts setzen oder loeschen",
  schema: { type: "object", properties: { bday: { type: "string", format: "date" } }, required: ["bday"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const bday = str(input["bday"]) ?? "";
    const summary = bday ? `Geburtstag geändert: ${bday}` : "Geburtstag entfernt";
    return planForContactMutations("contact.set-birthday", ctx, [{ kind: "bday", bday: bday || null }], summary);
  },
};

const contactCreate: CommandDescriptor = {
  id: "contact.create", kind: "contact", title: "Kontakt anlegen", description: "Neuen Kontakt in der Ziel-Collection anlegen",
  schema: {
    type: "object",
    properties: {
      fn: { type: "string", minLength: 1 }, email: { type: "string", format: "email" }, tel: { type: "string" }, org: { type: "string" },
    },
    required: ["fn"],
  },
  appliesTo: appliesToNewContact,
  plan(input, ctx) {
    const fn = str(input["fn"]);
    if (!fn) throw new Error("contact.create: fn fehlt");
    const uid = `${newId("ct", ctx.rand)}@calendar-notes`;
    const newRaw = newContactVcf({ uid, fn, email: str(input["email"]), tel: str(input["tel"]), org: str(input["org"]) }, { now: ctx.now });
    const afterContact = parseContact(newRaw);
    const diff = diffContactFields(undefined, afterContact);
    return {
      commandId: "contact.create", target: ctx.target, summary: `Kontakt angelegt: "${fn}"`, diff, newRaw,
      contentType: "text/vcard", hrefForPut: `${ctx.collection.href}${uid}.vcf`, createsNew: true,
    };
  },
};

export const CONTACT_COMMANDS: CommandDescriptor[] = [
  contactSetName, contactSetEmail, contactRemoveEmail, contactSetPhone, contactRemovePhone,
  contactSetOrg, contactSetTitle, contactSetNote, contactSetBirthday, contactCreate,
];
