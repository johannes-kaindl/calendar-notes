import type { ProviderCallOptions, ProviderResult, ProviderToolDef, ToolLang } from "../../vendor/kit/tool-provider";
import type { ApiContact, ApiError, ApiEvent, ApiPlan, ApiTargetRef, ContactsQuery, EventsQuery } from "./types";

/**
 * Werkzeug-Vertrag `tool-provider` (obsidian-kit 0.60): eine KLEINE Werkzeugmenge statt der 20 Kommandos
 * der Registry. Gelesen wird mit drei Werkzeugen, geschrieben mit dreien; das Ziel (`uid`+`source`
 * bzw. `collectionId`) steht in den Parametern, und die Beschreibung sagt, woher das Modell es nimmt
 * (aus `list_events`/`list_contacts`). Jedes schreibende Werkzeug macht `plan → confirm → execute`
 * INTERN (Festlegung (e) im Kit) — `plan()`/`execute(plan)` der Plugin-API bleiben daneben bestehen.
 *
 * Rein: alles Obsidian-Abhaengige kommt ueber {@link ToolProviderHost}.
 */
export interface ToolProviderHost {
  events(q?: EventsQuery): Promise<ApiEvent[] | ApiError>;
  contacts(q?: ContactsQuery): Promise<ApiContact[] | ApiError>;
  get(ref: { uid: string; source?: string }): Promise<ApiEvent | ApiContact | null | ApiError>;
  plan(commandId: string, input: Record<string, unknown>, target: ApiTargetRef): Promise<ApiPlan | ApiError>;
  execute(plan: ApiPlan): Promise<{ ok: true; invite?: { route: string; delivered?: boolean } } | { ok: false; conflict?: boolean; error?: string } | ApiError>;
  /** Vollstaendige Obergrenze der Vault-Pfade, die dieser Plan beim Ausfuehren beschreibt (Resync nach dem PUT). */
  previewPaths(plan: ApiPlan, target: ApiTargetRef): Promise<string[]>;
}

const LIST_LIMIT = 40;

type Texts = Record<ToolLang, string>;
const T = {
  listEvents: { en: "List events from the mirrored calendars, soonest first. Use it to find the uid and source that move_event and get_item need.", de: "Listet Termine der gespiegelten Kalender, früheste zuerst. Hier stehen uid und source, die move_event und get_item brauchen." },
  listContacts: { en: "List or search contacts from the mirrored address books. Use it to find the uid and source that update_contact and get_item need.", de: "Listet oder sucht Kontakte der gespiegelten Adressbücher. Hier stehen uid und source, die update_contact und get_item brauchen." },
  getItem: { en: "Show one event or contact in full. uid (and source) come from list_events or list_contacts.", de: "Zeigt einen Termin oder Kontakt vollständig. uid (und source) stammen aus list_events oder list_contacts." },
  createEvent: { en: "Create a new event on the calendar server. collectionId is the id of a calendar (shown as collectionId in list_events lines).", de: "Legt einen neuen Termin auf dem Kalenderserver an. collectionId ist die Id eines Kalenders (steht als collectionId in den Zeilen von list_events)." },
  moveEvent: { en: "Change the start (and end) of an existing event. uid and source come from list_events.", de: "Ändert Beginn (und Ende) eines bestehenden Termins. uid und source stammen aus list_events." },
  updateContact: { en: "Change one field of an existing contact. uid and source come from list_contacts.", de: "Ändert ein Feld eines bestehenden Kontakts. uid und source stammen aus list_contacts." },
  from: { en: "Only events starting at or after this ISO date/time", de: "Nur Termine ab diesem ISO-Datum/-Zeitpunkt" },
  to: { en: "Only events starting at or before this ISO date/time", de: "Nur Termine bis zu diesem ISO-Datum/-Zeitpunkt" },
  collectionId: { en: "Restrict to one collection", de: "Auf eine Sammlung beschränken" },
  query: { en: "Case-insensitive text in the name or an email address", de: "Text im Namen oder in einer E-Mail-Adresse (Groß-/Kleinschreibung egal)" },
  uid: { en: "uid of the item", de: "uid des Eintrags" },
  source: { en: "source of the item, exactly as listed", de: "source des Eintrags, genau wie aufgelistet" },
  title: { en: "Title", de: "Titel" },
  start: { en: "Start, ISO date or date-time (e.g. 2026-09-01T10:00)", de: "Beginn, ISO-Datum oder -Zeitpunkt (z. B. 2026-09-01T10:00)" },
  end: { en: "End, ISO date or date-time", de: "Ende, ISO-Datum oder -Zeitpunkt" },
  allDay: { en: "All-day event", de: "Ganztägiger Termin" },
  location: { en: "Location", de: "Ort" },
  description: { en: "Description", de: "Beschreibung" },
  field: { en: "Which field to change", de: "Welches Feld geändert wird" },
  value: { en: "New value (for org: comma-separated parts)", de: "Neuer Wert (bei org: Teile durch Komma getrennt)" },
  noConfirm: { en: "Not done: this change needs the user's confirmation, and none was given.", de: "Nicht ausgeführt: Diese Änderung braucht die Bestätigung der Nutzerin, und sie lag nicht vor." },
  unknownTool: { en: "Unknown tool", de: "Unbekanntes Werkzeug" },
  none: { en: "Nothing found.", de: "Nichts gefunden." },
  done: { en: "Done.", de: "Erledigt." },
  conflict: { en: "The server changed this item in the meantime — list it again and retry.", de: "Der Server hat den Eintrag inzwischen geändert — erneut auflisten und noch einmal versuchen." },
} satisfies Record<string, Texts>;

const FIELD_COMMANDS = {
  name: { command: "contact.set-name", key: "fn" },
  email: { command: "contact.set-email", key: "value" },
  phone: { command: "contact.set-phone", key: "value" },
  org: { command: "contact.set-org", key: "org" },
  title: { command: "contact.set-title", key: "title" },
  note: { command: "contact.set-note", key: "note" },
  birthday: { command: "contact.set-birthday", key: "bday" },
} as const;
type ContactField = keyof typeof FIELD_COMMANDS;
const CONTACT_FIELDS = Object.keys(FIELD_COMMANDS) as ContactField[];

function providerToolDefs(lang: ToolLang): ProviderToolDef[] {
  const d = (x: Texts): string => x[lang];
  const str = (x: Texts) => ({ type: "string", description: d(x) });
  return [
    { name: "list_events", writes: false, description: d(T.listEvents),
      parameters: { type: "object", properties: { from: str(T.from), to: str(T.to), collectionId: str(T.collectionId) } } },
    { name: "list_contacts", writes: false, description: d(T.listContacts),
      parameters: { type: "object", properties: { query: str(T.query), collectionId: str(T.collectionId) } } },
    { name: "get_item", writes: false, description: d(T.getItem),
      parameters: { type: "object", properties: { uid: str(T.uid), source: str(T.source) }, required: ["uid"] } },
    { name: "create_event", writes: true, description: d(T.createEvent),
      parameters: { type: "object", properties: { collectionId: str(T.collectionId), title: str(T.title), start: str(T.start), end: str(T.end), allDay: { type: "boolean", description: d(T.allDay) }, location: str(T.location), description: str(T.description) }, required: ["collectionId", "title", "start"] } },
    { name: "move_event", writes: true, description: d(T.moveEvent),
      parameters: { type: "object", properties: { uid: str(T.uid), source: str(T.source), start: str(T.start), end: str(T.end), allDay: { type: "boolean", description: d(T.allDay) } }, required: ["uid", "source", "start"] } },
    { name: "update_contact", writes: true, description: d(T.updateContact),
      parameters: { type: "object", properties: { uid: str(T.uid), source: str(T.source), field: { type: "string", enum: [...CONTACT_FIELDS], description: d(T.field) }, value: str(T.value) }, required: ["uid", "source", "field", "value"] } },
  ];
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const strArg = (args: Record<string, unknown>, k: string): string | undefined => {
  const v = args[k];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const bad = (field: string, message: string): ProviderResult => ({ ok: false, reason: "bad-args", field, message });
const failed = (message: string): ProviderResult => ({ ok: false, reason: "failed", message });
const isError = (x: unknown): x is ApiError => isRecord(x) && typeof x["error"] === "string";

function eventLine(e: ApiEvent): string {
  const end = e.data.end ? ` – ${e.data.end}` : "";
  const where = e.data.location ? ` @ ${e.data.location}` : "";
  return `- ${e.data.start}${end} · ${e.data.summary}${where} [uid: ${e.uid} | source: ${e.source} | collectionId: ${e.collectionId}]`;
}
function contactLine(c: ApiContact): string {
  const mail = c.data.emails[0]?.value;
  const org = c.data.org?.length ? ` (${c.data.org.join(" / ")})` : "";
  return `- ${c.data.fn}${org}${mail ? ` · ${mail}` : ""} [uid: ${c.uid} | source: ${c.source} | collectionId: ${c.collectionId}]`;
}

function describeItem(x: ApiEvent | ApiContact): string {
  const head = `uid: ${x.uid}\nsource: ${x.source}\ncollectionId: ${x.collectionId}${x.path ? `\nnote: ${x.path}` : ""}`;
  if ("summary" in x.data) {
    const e = x.data;
    const rows = [["title", e.summary], ["start", e.start], ["end", e.end], ["allDay", e.allDay ? "yes" : undefined], ["location", e.location], ["url", e.url], ["status", e.status], ["rrule", e.rrule], ["attendees", e.attendees.map((a) => a.name ? `${a.name} <${a.email}>` : a.email).join(", ")], ["description", e.description]];
    return [head, ...rows.filter((r) => r[1]).map((r) => `${r[0]}: ${r[1]}`)].join("\n");
  }
  const c = x.data;
  const rows = [["name", c.fn], ["org", c.org?.join(" / ")], ["title", c.title], ["emails", c.emails.map((m) => m.value).join(", ")], ["phones", c.tels.map((m) => m.value).join(", ")], ["birthday", c.bday], ["note", c.note]];
  return [head, ...rows.filter((r) => r[1]).map((r) => `${r[0]}: ${r[1]}`)].join("\n");
}

export function createToolProvider(host: ToolProviderHost): {
  tools(opts?: { lang?: ToolLang }): ProviderToolDef[];
  executeTool(name: string, args: Record<string, unknown>, opts?: ProviderCallOptions): Promise<ProviderResult>;
} {
  /** plan → confirm (genau einmal, vor dem ersten Schreiben) → execute. */
  async function write(lang: ToolLang, commandId: string, input: Record<string, unknown>, target: ApiTargetRef, opts?: ProviderCallOptions): Promise<ProviderResult> {
    const plan = await host.plan(commandId, input, target);
    if (isError(plan)) return plan.error.startsWith("validation:") ? bad("input", plan.error) : failed(plan.error);
    if (!opts?.confirm) return { ok: false, reason: "needs-confirm", message: T.noConfirm[lang] };
    const paths = await host.previewPaths(plan, target);
    const outside = [plan.delete ? "CalDAV/CardDAV: delete" : plan.createsNew ? "CalDAV/CardDAV: create" : "CalDAV/CardDAV: update"];
    if (plan.invite) outside.push(`Mail/iMIP: ${plan.invite.method} → ${plan.invite.attendees.join(", ")}`);
    const ok = await opts.confirm({ summary: plan.summary, paths, outside });
    if (!ok) return { ok: false, reason: "needs-confirm", message: T.noConfirm[lang] };
    const res = await host.execute(plan);
    if (isError(res)) return failed(res.error);
    if (!res.ok) return failed("conflict" in res && res.conflict ? T.conflict[lang] : ("error" in res && res.error) || "failed");
    return { ok: true, content: `${T.done[lang]} ${plan.summary}` };
  }

  return {
    tools: (opts) => providerToolDefs(opts?.lang ?? "en"),

    async executeTool(name, args, opts) {
      const lang: ToolLang = opts?.lang ?? "en";
      try {
        switch (name) {
          case "list_events": {
            const q: EventsQuery = { ...(strArg(args, "from") ? { from: strArg(args, "from")! } : {}), ...(strArg(args, "to") ? { to: strArg(args, "to")! } : {}), ...(strArg(args, "collectionId") ? { collectionId: strArg(args, "collectionId")! } : {}) };
            const r = await host.events(q);
            if (isError(r)) return failed(r.error);
            const sorted = [...r].sort((a, b) => a.data.start.localeCompare(b.data.start));
            if (sorted.length === 0) return { ok: true, content: T.none[lang], data: [] };
            const shown = sorted.slice(0, LIST_LIMIT);
            const more = sorted.length > shown.length ? `\n(+${sorted.length - shown.length} more — narrow with from/to)` : "";
            return { ok: true, content: shown.map(eventLine).join("\n") + more, data: shown };
          }
          case "list_contacts": {
            const q: ContactsQuery = { ...(strArg(args, "query") ? { query: strArg(args, "query")! } : {}), ...(strArg(args, "collectionId") ? { collectionId: strArg(args, "collectionId")! } : {}) };
            const r = await host.contacts(q);
            if (isError(r)) return failed(r.error);
            if (r.length === 0) return { ok: true, content: T.none[lang], data: [] };
            const shown = r.slice(0, LIST_LIMIT);
            const more = r.length > shown.length ? `\n(+${r.length - shown.length} more — narrow with query)` : "";
            return { ok: true, content: shown.map(contactLine).join("\n") + more, data: shown };
          }
          case "get_item": {
            const uid = strArg(args, "uid");
            if (!uid) return bad("uid", "uid is required");
            const source = strArg(args, "source");
            const r = await host.get({ uid, ...(source ? { source } : {}) });
            if (isError(r)) return failed(r.error);
            if (r === null) return { ok: true, content: T.none[lang] };
            return { ok: true, content: describeItem(r), data: r };
          }
          case "create_event": {
            const collectionId = strArg(args, "collectionId"), title = strArg(args, "title"), start = strArg(args, "start");
            if (!collectionId) return bad("collectionId", "collectionId is required");
            if (!title) return bad("title", "title is required");
            if (!start) return bad("start", "start is required");
            const input: Record<string, unknown> = { title, start };
            for (const k of ["end", "location", "description"]) { const v = strArg(args, k); if (v) input[k] = v; }
            if (typeof args["allDay"] === "boolean") input["allDay"] = args["allDay"];
            return write(lang, "event.create", input, { new: true, collectionId }, opts);
          }
          case "move_event": {
            const uid = strArg(args, "uid"), source = strArg(args, "source"), start = strArg(args, "start");
            if (!uid) return bad("uid", "uid is required");
            if (!source) return bad("source", "source is required");
            if (!start) return bad("start", "start is required");
            const input: Record<string, unknown> = { start };
            const end = strArg(args, "end");
            if (end) input["end"] = end;
            if (typeof args["allDay"] === "boolean") input["allDay"] = args["allDay"];
            return write(lang, "event.move", input, { uid, source }, opts);
          }
          case "update_contact": {
            const uid = strArg(args, "uid"), source = strArg(args, "source"), value = strArg(args, "value"), field = strArg(args, "field");
            if (!uid) return bad("uid", "uid is required");
            if (!source) return bad("source", "source is required");
            if (!field || !(CONTACT_FIELDS as string[]).includes(field)) return bad("field", `field must be one of: ${CONTACT_FIELDS.join(", ")}`);
            if (!value) return bad("value", "value is required");
            const { command, key } = FIELD_COMMANDS[field as ContactField];
            // E-Mail und Telefon: der erste vorhandene Eintrag wird ersetzt, gibt es keinen, kommt einer dazu.
            const got = command === "contact.set-email" || command === "contact.set-phone" ? await host.get({ uid, source }) : null;
            const existing = got && !isError(got) && "fn" in got.data ? (command === "contact.set-email" ? got.data.emails.length : got.data.tels.length) : 0;
            const input: Record<string, unknown> = key === "org" ? { org: value.split(",").map((s) => s.trim()).filter(Boolean) } : { [key]: value };
            if (command === "contact.set-email" || command === "contact.set-phone") input["index"] = existing > 0 ? "0" : "new";
            return write(lang, command, input, { uid, source }, opts);
          }
          default:
            return { ok: false, reason: "unknown-tool", message: `${T.unknownTool[lang]}: ${name}` };
        }
      } catch (e) {
        return failed(e instanceof Error ? e.message : String(e));
      }
    },
  };
}
