import { fmKeyFor, type FmVal } from "../mirror/profile";
import { fmEquals } from "../mirror/hash";
import { parseEvents, primaryEvent } from "../ical/event";
import { applyMutation, type EventMutation } from "../ical/mutate";
import { parseContact } from "../vcard/contact";
import { applyContactMutation, type ContactMutation } from "../vcard/mutate";
import { diffEventFields, hrefOfEventTarget } from "./event-commands";
import { diffContactFields, hrefOfContactTarget } from "./contact-commands";
import type { CommandContext, CommandPlan } from "./types";

export interface SkippedField {
  key: string;
  reason: string;
}

export interface PushHandEditsResult {
  plan: CommandPlan | null;
  skipped: SkippedField[];
}

const EVENT_SUPPORTED = ["title", "location", "url", "description", "start", "end"] as const;
const CONTACT_SUPPORTED = ["email", "tel_cell", "tel_home", "tel_work", "org", "title", "note", "bday", "fn"] as const;

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function nullableStr(v: unknown): string | null {
  const s = str(v);
  return s === undefined || s === "" ? null : s;
}

function handEditedKeys(frontmatter: Record<string, unknown>, prevWritten: Record<string, FmVal>): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(prevWritten)) if (!fmEquals(frontmatter[k], v)) keys.push(k);
  return keys;
}

function planEventHandEdits(ctx: CommandContext, frontmatter: Record<string, unknown>, keys: string[], skipped: SkippedField[]): CommandPlan | null {
  const before = ctx.raw;
  if (before === undefined) throw new Error("push-hand-edits: kein Rohdaten (raw) vorhanden");
  const beforeEv = primaryEvent(parseEvents(before));
  if (!beforeEv) throw new Error("push-hand-edits: kein VEVENT vorhanden");
  const mutations: EventMutation[] = [];
  let times: { start?: string; end?: string } | undefined;
  for (const fmKey of keys) {
    const sf = EVENT_SUPPORTED.find((f) => fmKeyFor(ctx.profile, f) === fmKey);
    if (!sf) { skipped.push({ key: fmKey, reason: "kein unterstuetztes Server-Feld fuer dieses Frontmatter-Feld" }); continue; }
    const raw = frontmatter[fmKey];
    switch (sf) {
      case "title": mutations.push({ kind: "summary", summary: str(raw) ?? "" }); break;
      case "location": mutations.push({ kind: "location", location: nullableStr(raw) }); break;
      case "url": mutations.push({ kind: "url", url: nullableStr(raw) }); break;
      case "description": mutations.push({ kind: "description", description: nullableStr(raw) }); break;
      case "start": times = { ...times, start: str(raw) }; break;
      case "end": times = { ...times, end: str(raw) }; break;
    }
  }
  if (times) mutations.push({ kind: "times", start: times.start ?? beforeEv.start, end: times.end ?? beforeEv.end, allDay: beforeEv.allDay, tzid: beforeEv.tzid });
  if (mutations.length === 0) return null;
  const newRaw = mutations.reduce((raw, m) => applyMutation(raw, m, { now: ctx.now }), before);
  const afterEv = primaryEvent(parseEvents(newRaw));
  if (!afterEv) throw new Error("push-hand-edits: kein VEVENT nach Mutation");
  const diff = diffEventFields(beforeEv, afterEv);
  return {
    commandId: "push-hand-edits", target: ctx.target,
    summary: "Write hand edits to the server", summaryKey: "plan.push-hand-edits.summary", summaryArgs: [],
    diff, newRaw,
    etag: ctx.etag, contentType: "text/calendar", hrefForPut: hrefOfEventTarget(ctx.target), createsNew: false,
  };
}

function planContactHandEdits(ctx: CommandContext, frontmatter: Record<string, unknown>, keys: string[], skipped: SkippedField[]): CommandPlan | null {
  const before = ctx.raw;
  if (before === undefined) throw new Error("push-hand-edits: kein Rohdaten (raw) vorhanden");
  const beforeContact = parseContact(before);
  const mutations: ContactMutation[] = [];
  for (const fmKey of keys) {
    const sf = CONTACT_SUPPORTED.find((f) => fmKeyFor(ctx.profile, f) === fmKey);
    if (!sf) { skipped.push({ key: fmKey, reason: "kein unterstuetztes Server-Feld fuer dieses Frontmatter-Feld" }); continue; }
    const raw = frontmatter[fmKey];
    switch (sf) {
      case "fn": mutations.push({ kind: "fn", fn: str(raw) ?? "" }); break;
      case "title": mutations.push({ kind: "title", title: nullableStr(raw) }); break;
      case "note": mutations.push({ kind: "note", note: nullableStr(raw) }); break;
      case "bday": mutations.push({ kind: "bday", bday: nullableStr(raw) }); break;
      case "org": {
        const s = str(raw);
        mutations.push({ kind: "org", org: s ? s.split(" / ").map((x) => x.trim()).filter((x) => x.length > 0) : null });
        break;
      }
      case "email": {
        const prefIdx = beforeContact.emails.findIndex((e) => e.pref);
        const idx: number | "new" = prefIdx >= 0 ? prefIdx : beforeContact.emails.length > 0 ? 0 : "new";
        mutations.push({ kind: "setEmail", index: idx, value: str(raw) ?? "" });
        break;
      }
      case "tel_cell": case "tel_home": case "tel_work": {
        const kind = sf.slice("tel_".length);
        const found = beforeContact.tels.findIndex((t) => t.types.includes(kind));
        const idx: number | "new" = found >= 0 ? found : "new";
        mutations.push({ kind: "setTel", index: idx, value: str(raw) ?? "", types: idx === "new" ? [kind] : undefined });
        break;
      }
    }
  }
  if (mutations.length === 0) return null;
  const newRaw = mutations.reduce((raw, m) => applyContactMutation(raw, m, { now: ctx.now }), before);
  const afterContact = parseContact(newRaw);
  const diff = diffContactFields(beforeContact, afterContact);
  return {
    commandId: "push-hand-edits", target: ctx.target,
    summary: "Write hand edits to the server", summaryKey: "plan.push-hand-edits.summary", summaryArgs: [],
    diff, newRaw,
    etag: ctx.etag, contentType: "text/vcard", hrefForPut: hrefOfContactTarget(ctx.target), createsNew: false,
  };
}

export function planPushHandEdits(ctx: CommandContext, frontmatter: Record<string, unknown>, prevWritten: Record<string, FmVal>): PushHandEditsResult {
  const keys = handEditedKeys(frontmatter, prevWritten);
  const skipped: SkippedField[] = [];
  if (keys.length === 0) return { plan: null, skipped };
  const plan = ctx.profile.kind === "event" ? planEventHandEdits(ctx, frontmatter, keys, skipped) : planContactHandEdits(ctx, frontmatter, keys, skipped);
  return { plan, skipped };
}
