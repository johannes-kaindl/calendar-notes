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

/** `summary`/`summaryKey`/`summaryArgs` werden vom Aufrufer gesetzt — s. Kommentar bei
 *  `planForMutation()` in `event-commands.ts`. */
function planForContactMutations(id: string, ctx: CommandContext, mutations: ContactMutation[]): CommandPlan {
  const before = ctx.raw;
  if (before === undefined) throw new Error(`${id}: kein Rohdaten (raw) vorhanden`);
  const beforeContact = parseContact(before);
  const newRaw = mutations.reduce((raw, m) => applyContactMutation(raw, m, { now: ctx.now }), before);
  const afterContact = parseContact(newRaw);
  const diff = diffContactFields(beforeContact, afterContact);
  return {
    commandId: id, target: ctx.target, summary: "", summaryKey: "", summaryArgs: [], diff, newRaw,
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

function checkIndex(ctx: CommandContext, kind: "email" | "tel", index: number | "new"): void {
  if (index === "new") return;
  const contact = parseContact(ctx.raw ?? "");
  const len = kind === "email" ? contact.emails.length : contact.tels.length;
  if (index < 0 || index >= len) throw new Error(`Index außerhalb: ${index}`);
}

const contactSetName: CommandDescriptor = {
  id: "contact.set-name", kind: "contact",
  title: "Change name", titleKey: "cmd.contact.set-name.title",
  description: "Set FN and optionally first/last name (N) of a contact", descriptionKey: "cmd.contact.set-name.desc",
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
    const plan = planForContactMutations("contact.set-name", ctx, mutations);
    plan.summary = `Name changed: "${fn}"`;
    plan.summaryKey = "plan.contact.set-name.summary";
    plan.summaryArgs = [fn];
    return plan;
  },
};

const contactSetEmail: CommandDescriptor = {
  id: "contact.set-email", kind: "contact",
  title: "Set email", titleKey: "cmd.contact.set-email.title",
  description: "Set an email address or add a new one", descriptionKey: "cmd.contact.set-email.desc",
  schema: {
    type: "object",
    properties: {
      index: { type: "string", description: "Index of an existing entry or \"new\"", descriptionKey: "cmd.contact.set-email.field.index" },
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
    checkIndex(ctx, "email", index);
    const types = Array.isArray(input["types"]) ? (input["types"] as unknown[]).map(String) : undefined;
    const plan = planForContactMutations("contact.set-email", ctx, [{ kind: "setEmail", index, value, types }]);
    plan.summary = `Email set: ${value}`;
    plan.summaryKey = "plan.contact.set-email.summary";
    plan.summaryArgs = [value];
    return plan;
  },
};

const contactRemoveEmail: CommandDescriptor = {
  id: "contact.remove-email", kind: "contact",
  title: "Remove email", titleKey: "cmd.contact.remove-email.title",
  description: "Remove an email address by index", descriptionKey: "cmd.contact.remove-email.desc",
  // Fix M6 (Review-Runde 3): `index` ist jetzt UEBERALL ein String ("0"|"1"|…) — vorher
  // schrieb dieses Schema `type: "number"`, waehrend set-email/set-phone (und `parseIndex()`
  // selbst) String-Indizes erwarten/liefern ("new" ist per Definition kein number). Ein
  // `validateInput()`-Aufruf mit `index: "0"` (die naheliegende Form fuer ein LLM-Tool-Call
  // oder ein Formularfeld) waere gegen `type: "number"` faelschlich abgelehnt worden.
  schema: { type: "object", properties: { index: { type: "string", description: "Index of an existing entry (\"0\", \"1\", ...)", descriptionKey: "cmd.contact.remove-email.field.index" } }, required: ["index"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const index = parseIndex(input["index"]);
    if (index === "new") throw new Error("contact.remove-email: index darf nicht \"new\" sein");
    checkIndex(ctx, "email", index);
    const plan = planForContactMutations("contact.remove-email", ctx, [{ kind: "removeEmail", index }]);
    plan.summary = "Email removed";
    plan.summaryKey = "plan.contact.remove-email.summary";
    plan.summaryArgs = [];
    return plan;
  },
};

const contactSetPhone: CommandDescriptor = {
  id: "contact.set-phone", kind: "contact",
  title: "Set phone number", titleKey: "cmd.contact.set-phone.title",
  description: "Set a phone number or add a new one", descriptionKey: "cmd.contact.set-phone.desc",
  schema: {
    type: "object",
    properties: {
      index: { type: "string", description: "Index of an existing entry or \"new\"", descriptionKey: "cmd.contact.set-phone.field.index" },
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
    checkIndex(ctx, "tel", index);
    const types = Array.isArray(input["types"]) ? (input["types"] as unknown[]).map(String) : undefined;
    const plan = planForContactMutations("contact.set-phone", ctx, [{ kind: "setTel", index, value, types }]);
    plan.summary = `Phone number set: ${value}`;
    plan.summaryKey = "plan.contact.set-phone.summary";
    plan.summaryArgs = [value];
    return plan;
  },
};

const contactRemovePhone: CommandDescriptor = {
  id: "contact.remove-phone", kind: "contact",
  title: "Remove phone number", titleKey: "cmd.contact.remove-phone.title",
  description: "Remove a phone number by index", descriptionKey: "cmd.contact.remove-phone.desc",
  // Fix M6 — s. Kommentar bei contact.remove-email oben.
  schema: { type: "object", properties: { index: { type: "string", description: "Index of an existing entry (\"0\", \"1\", ...)", descriptionKey: "cmd.contact.remove-phone.field.index" } }, required: ["index"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const index = parseIndex(input["index"]);
    if (index === "new") throw new Error("contact.remove-phone: index darf nicht \"new\" sein");
    checkIndex(ctx, "tel", index);
    const plan = planForContactMutations("contact.remove-phone", ctx, [{ kind: "removeTel", index }]);
    plan.summary = "Phone number removed";
    plan.summaryKey = "plan.contact.remove-phone.summary";
    plan.summaryArgs = [];
    return plan;
  },
};

const contactSetOrg: CommandDescriptor = {
  id: "contact.set-org", kind: "contact",
  title: "Change organization", titleKey: "cmd.contact.set-org.title",
  description: "Set or clear the organization (ORG)", descriptionKey: "cmd.contact.set-org.desc",
  schema: { type: "object", properties: { org: { type: "array", items: { type: "string" } } }, required: ["org"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const org = Array.isArray(input["org"]) ? (input["org"] as unknown[]).map(String) : [];
    const plan = planForContactMutations("contact.set-org", ctx, [{ kind: "org", org: org.length ? org : null }]);
    if (org.length) {
      const joined = org.join(" / ");
      plan.summary = `Organization changed: "${joined}"`;
      plan.summaryKey = "plan.contact.set-org.changed";
      plan.summaryArgs = [joined];
    } else {
      plan.summary = "Organization removed";
      plan.summaryKey = "plan.contact.set-org.removed";
      plan.summaryArgs = [];
    }
    return plan;
  },
};

const contactSetTitle: CommandDescriptor = {
  id: "contact.set-title", kind: "contact",
  title: "Change job title", titleKey: "cmd.contact.set-title.title",
  description: "Set or clear a contact's TITLE", descriptionKey: "cmd.contact.set-title.desc",
  schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const title = str(input["title"]) ?? "";
    const plan = planForContactMutations("contact.set-title", ctx, [{ kind: "title", title: title || null }]);
    if (title) {
      plan.summary = `Job title changed: "${title}"`;
      plan.summaryKey = "plan.contact.set-title.changed";
      plan.summaryArgs = [title];
    } else {
      plan.summary = "Job title removed";
      plan.summaryKey = "plan.contact.set-title.removed";
      plan.summaryArgs = [];
    }
    return plan;
  },
};

const contactSetNote: CommandDescriptor = {
  id: "contact.set-note", kind: "contact",
  title: "Change note", titleKey: "cmd.contact.set-note.title",
  description: "Set or clear a contact's NOTE", descriptionKey: "cmd.contact.set-note.desc",
  schema: { type: "object", properties: { note: { type: "string", format: "multiline" } }, required: ["note"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const note = str(input["note"]) ?? "";
    const plan = planForContactMutations("contact.set-note", ctx, [{ kind: "note", note: note || null }]);
    if (note) {
      plan.summary = "Note changed";
      plan.summaryKey = "plan.contact.set-note.changed";
      plan.summaryArgs = [];
    } else {
      plan.summary = "Note removed";
      plan.summaryKey = "plan.contact.set-note.removed";
      plan.summaryArgs = [];
    }
    return plan;
  },
};

const contactSetBirthday: CommandDescriptor = {
  id: "contact.set-birthday", kind: "contact",
  title: "Change birthday", titleKey: "cmd.contact.set-birthday.title",
  description: "Set or clear a contact's BDAY", descriptionKey: "cmd.contact.set-birthday.desc",
  schema: { type: "object", properties: { bday: { type: "string", format: "date" } }, required: ["bday"] },
  appliesTo: appliesToExistingContact,
  plan(input, ctx) {
    const bday = str(input["bday"]) ?? "";
    const plan = planForContactMutations("contact.set-birthday", ctx, [{ kind: "bday", bday: bday || null }]);
    if (bday) {
      plan.summary = `Birthday changed: ${bday}`;
      plan.summaryKey = "plan.contact.set-birthday.changed";
      plan.summaryArgs = [bday];
    } else {
      plan.summary = "Birthday removed";
      plan.summaryKey = "plan.contact.set-birthday.removed";
      plan.summaryArgs = [];
    }
    return plan;
  },
};

const contactCreate: CommandDescriptor = {
  id: "contact.create", kind: "contact",
  title: "Create contact", titleKey: "cmd.contact.create.title",
  description: "Create a new contact in the target collection", descriptionKey: "cmd.contact.create.desc",
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
      commandId: "contact.create", target: ctx.target,
      summary: `Contact created: "${fn}"`, summaryKey: "plan.contact.create.summary", summaryArgs: [fn],
      diff, newRaw,
      contentType: "text/vcard", hrefForPut: `${ctx.collection.href}${uid}.vcf`, createsNew: true,
    };
  },
};

export const CONTACT_COMMANDS: CommandDescriptor[] = [
  contactSetName, contactSetEmail, contactRemoveEmail, contactSetPhone, contactRemovePhone,
  contactSetOrg, contactSetTitle, contactSetNote, contactSetBirthday, contactCreate,
];
