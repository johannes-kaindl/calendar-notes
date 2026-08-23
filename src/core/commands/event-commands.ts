import { parseEvents, primaryEvent, type EventData } from "../ical/event";
import { applyMutation, newEventIcs, type EventMutation } from "../ical/mutate";
import { newId } from "../settings";
import type { CommandContext, CommandDescriptor, CommandPlan, CommandTarget } from "./types";

export function hrefOfEventTarget(target: CommandTarget): string {
  return "href" in target ? target.href : "";
}
const hrefOf = hrefOfEventTarget;

function appliesToExistingEvent(ctx: CommandContext): boolean {
  return ctx.target.kind === "event" && "href" in ctx.target && typeof ctx.raw === "string";
}

function appliesToNewEvent(ctx: CommandContext): boolean {
  return ctx.target.kind === "event" && "new" in ctx.target && ctx.target.new === true;
}

function fmtDT(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

function fmtRange(start: string, end?: string): string {
  const s = fmtDT(start);
  if (!end) return s;
  const em = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(end);
  const datePart = em?.[1];
  const timePart = em?.[2];
  if (datePart !== undefined && timePart !== undefined && s.startsWith(datePart)) return `${s}–${timePart}`;
  return `${s}–${fmtDT(end)}`;
}

const EVENT_DIFF_FIELDS = ["title", "location", "url", "description", "start", "end", "allDay", "attendees"] as const;

function eventFieldValue(e: EventData, field: (typeof EVENT_DIFF_FIELDS)[number]): string | undefined {
  switch (field) {
    case "title": return e.summary || undefined;
    case "location": return e.location;
    case "url": return e.url;
    case "description": return e.description;
    case "start": return e.start;
    case "end": return e.end;
    case "allDay": return String(e.allDay);
    case "attendees":
      return e.attendees.length ? e.attendees.map((a) => `${a.email}:${a.partstat ?? ""}`).sort().join(", ") : undefined;
  }
}

export function diffEventFields(before: EventData | undefined, after: EventData): { field: string; before?: string; after?: string }[] {
  const out: { field: string; before?: string; after?: string }[] = [];
  for (const field of EVENT_DIFF_FIELDS) {
    const b = before ? eventFieldValue(before, field) : undefined;
    const a = eventFieldValue(after, field);
    if (b !== a) out.push({ field, ...(b !== undefined ? { before: b } : {}), ...(a !== undefined ? { after: a } : {}) });
  }
  return out;
}

/** `summary`/`summaryKey`/`summaryArgs` werden vom Aufrufer NACH `planForMutation()` gesetzt
 *  (event.move braucht das gemutierte `afterEv` fuer den Zeitraum-Text, s. u.) — hier nur ein
 *  Platzhalter, der immer ueberschrieben wird. */
function planForMutation(id: string, ctx: CommandContext, mutation: EventMutation): CommandPlan {
  const before = ctx.raw;
  if (before === undefined) throw new Error(`${id}: kein Rohdaten (raw) vorhanden`);
  const beforeEv = primaryEvent(parseEvents(before));
  const newRaw = applyMutation(before, mutation, { now: ctx.now });
  const afterEv = primaryEvent(parseEvents(newRaw));
  if (!afterEv) throw new Error(`${id}: kein VEVENT nach Mutation`);
  const diff = diffEventFields(beforeEv, afterEv);
  return {
    commandId: id, target: ctx.target, summary: "", summaryKey: "", summaryArgs: [], diff, newRaw,
    etag: ctx.etag, contentType: "text/calendar", hrefForPut: hrefOf(ctx.target), createsNew: false,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

const eventMove: CommandDescriptor = {
  id: "event.move", kind: "event",
  title: "Move event", titleKey: "cmd.event.move.title",
  description: "Change the start/end time of an event", descriptionKey: "cmd.event.move.desc",
  schema: {
    type: "object",
    properties: {
      start: { type: "string", format: "date-time", description: "new start (ISO)", descriptionKey: "cmd.event.move.field.start" },
      end: { type: "string", format: "date-time", description: "new end (ISO)", descriptionKey: "cmd.event.move.field.end" },
      allDay: { type: "boolean" },
      tzid: { type: "string" },
    },
    required: ["start"],
  },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const start = str(input["start"]);
    if (!start) throw new Error("event.move: start fehlt");
    const beforeEv = primaryEvent(parseEvents(ctx.raw ?? ""));
    const tzid = str(input["tzid"]) ?? beforeEv?.tzid;
    const allDay = typeof input["allDay"] === "boolean" ? input["allDay"] : undefined;
    const mutation: EventMutation = { kind: "times", start, end: str(input["end"]), allDay, tzid };
    const plan = planForMutation("event.move", ctx, mutation);
    const afterEv = primaryEvent(parseEvents(plan.newRaw));
    const range = fmtRange(afterEv?.start ?? start, afterEv?.end);
    plan.summary = `Event moved: ${range}`;
    plan.summaryKey = "plan.event.move.summary";
    plan.summaryArgs = [range];
    return plan;
  },
};

const eventSetTitle: CommandDescriptor = {
  id: "event.set-title", kind: "event",
  title: "Change title", titleKey: "cmd.event.set-title.title",
  description: "Set the summary (SUMMARY) of an event", descriptionKey: "cmd.event.set-title.desc",
  schema: { type: "object", properties: { title: { type: "string", minLength: 1 } }, required: ["title"] },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const title = str(input["title"]);
    if (!title) throw new Error("event.set-title: title fehlt");
    const plan = planForMutation("event.set-title", ctx, { kind: "summary", summary: title });
    plan.summary = `Title changed: "${title}"`;
    plan.summaryKey = "plan.event.set-title.summary";
    plan.summaryArgs = [title];
    return plan;
  },
};

const eventSetLocation: CommandDescriptor = {
  id: "event.set-location", kind: "event",
  title: "Change location", titleKey: "cmd.event.set-location.title",
  description: "Set or clear the location (LOCATION) of an event", descriptionKey: "cmd.event.set-location.desc",
  schema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const location = str(input["location"]) ?? "";
    const plan = planForMutation("event.set-location", ctx, { kind: "location", location: location || null });
    if (location) {
      plan.summary = `Location changed: "${location}"`;
      plan.summaryKey = "plan.event.set-location.changed";
      plan.summaryArgs = [location];
    } else {
      plan.summary = "Location removed";
      plan.summaryKey = "plan.event.set-location.removed";
      plan.summaryArgs = [];
    }
    return plan;
  },
};

const eventSetUrl: CommandDescriptor = {
  id: "event.set-url", kind: "event",
  title: "Change URL", titleKey: "cmd.event.set-url.title",
  description: "Set or clear the URL of an event", descriptionKey: "cmd.event.set-url.desc",
  schema: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"] },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const url = str(input["url"]) ?? "";
    const plan = planForMutation("event.set-url", ctx, { kind: "url", url: url || null });
    if (url) {
      plan.summary = `URL changed: ${url}`;
      plan.summaryKey = "plan.event.set-url.changed";
      plan.summaryArgs = [url];
    } else {
      plan.summary = "URL removed";
      plan.summaryKey = "plan.event.set-url.removed";
      plan.summaryArgs = [];
    }
    return plan;
  },
};

const eventSetDescription: CommandDescriptor = {
  id: "event.set-description", kind: "event",
  title: "Change description", titleKey: "cmd.event.set-description.title",
  description: "Set or clear the description (DESCRIPTION) of an event", descriptionKey: "cmd.event.set-description.desc",
  schema: { type: "object", properties: { description: { type: "string", format: "multiline" } }, required: ["description"] },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const description = str(input["description"]) ?? "";
    const plan = planForMutation("event.set-description", ctx, { kind: "description", description: description || null });
    if (description) {
      plan.summary = "Description changed";
      plan.summaryKey = "plan.event.set-description.changed";
      plan.summaryArgs = [];
    } else {
      plan.summary = "Description removed";
      plan.summaryKey = "plan.event.set-description.removed";
      plan.summaryArgs = [];
    }
    return plan;
  },
};

const eventAddAttendee: CommandDescriptor = {
  id: "event.add-attendee", kind: "event",
  title: "Add attendee", titleKey: "cmd.event.add-attendee.title",
  description: "Add an attendee to an event (triggers an invitation)", descriptionKey: "cmd.event.add-attendee.desc",
  schema: {
    type: "object",
    properties: {
      email: { type: "string", format: "email" },
      name: { type: "string" },
      rsvp: { type: "boolean", description: "Default true", descriptionKey: "cmd.event.add-attendee.field.rsvp" },
    },
    required: ["email"],
  },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const email = str(input["email"]);
    if (!email) throw new Error("event.add-attendee: email fehlt");
    const name = str(input["name"]);
    const rsvp = typeof input["rsvp"] === "boolean" ? input["rsvp"] : true;
    const plan = planForMutation("event.add-attendee", ctx, { kind: "addAttendee", attendee: { email, name, rsvp } });
    plan.summary = `Attendee added: ${email}`;
    plan.summaryKey = "plan.event.add-attendee.summary";
    plan.summaryArgs = [email];
    if (rsvp) plan.invite = { attendees: [email], method: "REQUEST" };
    return plan;
  },
};

const eventRemoveAttendee: CommandDescriptor = {
  id: "event.remove-attendee", kind: "event",
  title: "Remove attendee", titleKey: "cmd.event.remove-attendee.title",
  description: "Remove an attendee from an event (triggers a cancellation, if scheduling is available)", descriptionKey: "cmd.event.remove-attendee.desc",
  schema: { type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const email = str(input["email"]);
    if (!email) throw new Error("event.remove-attendee: email fehlt");
    const plan = planForMutation("event.remove-attendee", ctx, { kind: "removeAttendee", email });
    plan.summary = `Attendee removed: ${email}`;
    plan.summaryKey = "plan.event.remove-attendee.summary";
    plan.summaryArgs = [email];
    if (ctx.scheduling) plan.invite = { attendees: [email], method: "CANCEL" };
    return plan;
  },
};

/** ALLE eigenen Adressen (Fix M5, Review-Runde 3) — vorher nahm `ownAddress()` NUR
 *  `scheduling.addresses[0]` (oder ersatzweise das Login-`username`) und verglich GENAU
 *  diese eine gegen die Attendee-Liste. Steht die eigene Adresse, unter der man tatsaechlich
 *  eingeladen ist, an einer anderen Stelle in `scheduling.addresses` (RFC 6638
 *  `calendar-user-address-set` liefert oft mehrere Aliase) oder nur im Login-`username`
 *  waehrend `addresses[0]` ein ANDERER Alias ist, warf das Kommando faelschlich "kein
 *  Teilnehmer". Jetzt: Vereinigungsmenge aus `scheduling.addresses` ∪ `username` (falls eine
 *  E-Mail-Form), case-insensitiv gegen jeden Attendee geprueft — die tatsaechlich passende
 *  Attendee-Adresse (nicht die erstbeste eigene) geht in die Mutation. */
function ownAddresses(ctx: CommandContext): string[] {
  const addrs = new Set<string>();
  for (const a of ctx.scheduling?.addresses ?? []) addrs.add(a.toLowerCase());
  if (ctx.account.username.includes("@")) addrs.add(ctx.account.username.toLowerCase());
  return [...addrs];
}

const eventSetPartstat: CommandDescriptor = {
  id: "event.set-partstat", kind: "event",
  title: "Set attendance status", titleKey: "cmd.event.set-partstat.title",
  description: "Set your own attendance status (ACCEPTED/DECLINED/TENTATIVE) for an event", descriptionKey: "cmd.event.set-partstat.desc",
  schema: { type: "object", properties: { partstat: { type: "string", enum: ["ACCEPTED", "DECLINED", "TENTATIVE"] } }, required: ["partstat"] },
  appliesTo: appliesToExistingEvent,
  plan(input, ctx) {
    const partstat = str(input["partstat"]) as "ACCEPTED" | "DECLINED" | "TENTATIVE" | undefined;
    if (!partstat) throw new Error("event.set-partstat: partstat fehlt");
    const ownSet = ownAddresses(ctx);
    if (ownSet.length === 0) throw new Error("Eigene Adresse unbekannt");
    const beforeEv = primaryEvent(parseEvents(ctx.raw ?? ""));
    const matched = beforeEv?.attendees.find((a) => ownSet.includes(a.email.toLowerCase()));
    if (!matched) throw new Error("Eigene Adresse ist kein Teilnehmer dieses Termins");
    const plan = planForMutation("event.set-partstat", ctx, { kind: "partstat", email: matched.email, partstat });
    plan.summary = `Attendance status set: ${partstat}`;
    plan.summaryKey = "plan.event.set-partstat.summary";
    plan.summaryArgs = [partstat];
    return plan;
  },
};

const eventDelete: CommandDescriptor = {
  id: "event.delete", kind: "event",
  title: "Delete event", titleKey: "cmd.event.delete.title",
  description: "Remove the event from the server", descriptionKey: "cmd.event.delete.desc",
  schema: { type: "object", properties: {} },
  appliesTo: appliesToExistingEvent,
  plan(_input, ctx) {
    return {
      commandId: "event.delete", target: ctx.target,
      summary: "Event deleted", summaryKey: "plan.event.delete.summary", summaryArgs: [],
      diff: [], newRaw: "",
      etag: ctx.etag, contentType: "text/calendar", hrefForPut: hrefOf(ctx.target), createsNew: false, delete: true,
    };
  },
};

const eventCreate: CommandDescriptor = {
  id: "event.create", kind: "event",
  title: "Create event", titleKey: "cmd.event.create.title",
  description: "Create a new event in the target collection", descriptionKey: "cmd.event.create.desc",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1 }, start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" },
      allDay: { type: "boolean" }, location: { type: "string" }, description: { type: "string", format: "multiline" }, url: { type: "string", format: "uri" },
    },
    required: ["title", "start"],
  },
  appliesTo: appliesToNewEvent,
  plan(input, ctx) {
    const title = str(input["title"]);
    const start = str(input["start"]);
    if (!title || !start) throw new Error("event.create: title/start fehlen");
    const uid = `${newId("ev", ctx.rand)}@calendar-notes`;
    const newRaw = newEventIcs(
      { uid, summary: title, start, end: str(input["end"]), allDay: typeof input["allDay"] === "boolean" ? input["allDay"] : undefined, location: str(input["location"]), description: str(input["description"]) },
      { now: ctx.now },
    );
    const afterEv = primaryEvent(parseEvents(newRaw));
    if (!afterEv) throw new Error("event.create: kein VEVENT erzeugt");
    const diff = diffEventFields(undefined, afterEv);
    const range = fmtRange(afterEv.start, afterEv.end);
    return {
      commandId: "event.create", target: ctx.target,
      summary: `Event created: ${range}`, summaryKey: "plan.event.create.summary", summaryArgs: [range],
      diff, newRaw,
      contentType: "text/calendar", hrefForPut: `${ctx.collection.href}${uid}.ics`, createsNew: true,
    };
  },
};

export const EVENT_COMMANDS: CommandDescriptor[] = [
  eventMove, eventSetTitle, eventSetLocation, eventSetUrl, eventSetDescription,
  eventAddAttendee, eventRemoveAttendee, eventSetPartstat, eventDelete, eventCreate,
];
