import { parseEvents, primaryEvent } from "../ical/event";
import { parseContact } from "../vcard/contact";
import { diffEventFields, hrefOfEventTarget } from "./event-commands";
import { diffContactFields, hrefOfContactTarget } from "./contact-commands";
import type { CommandContext, CommandPlan } from "./types";

export interface HistoryEntry {
  etag: string;
  raw: string;
  at: string;
}

export function planUndoLast(ctx: CommandContext, history: HistoryEntry[]): CommandPlan | null {
  const prev = history[0];
  if (!prev) return null;
  const summary = `Letzte Änderung zurücknehmen (Stand von ${prev.at})`;
  if (ctx.profile.kind === "event") {
    const beforeEv = ctx.raw ? primaryEvent(parseEvents(ctx.raw)) : undefined;
    const afterEv = primaryEvent(parseEvents(prev.raw));
    if (!afterEv) throw new Error("undo: kein VEVENT im Verlauf");
    return {
      commandId: "undo.last", target: ctx.target, summary, diff: diffEventFields(beforeEv, afterEv), newRaw: prev.raw,
      etag: ctx.etag, contentType: "text/calendar", hrefForPut: hrefOfEventTarget(ctx.target), createsNew: false,
    };
  }
  const beforeContact = ctx.raw ? parseContact(ctx.raw) : undefined;
  const afterContact = parseContact(prev.raw);
  return {
    commandId: "undo.last", target: ctx.target, summary, diff: diffContactFields(beforeContact, afterContact), newRaw: prev.raw,
    etag: ctx.etag, contentType: "text/vcard", hrefForPut: hrefOfContactTarget(ctx.target), createsNew: false,
  };
}
