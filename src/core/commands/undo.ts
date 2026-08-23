import { parseEvents, primaryEvent } from "../ical/event";
import { parseContact } from "../vcard/contact";
import { diffEventFields, hrefOfEventTarget } from "./event-commands";
import { diffContactFields, hrefOfContactTarget } from "./contact-commands";
import type { CommandContext, CommandDescriptor, CommandPlan } from "./types";

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

/** Registry-Eintrag fuer `planUndoLast` (Fix-Runde 1, Punkt 0) — vorher nur als freie Funktion
 *  erreichbar, ausschliesslich aus `CommandFlow.runUndo()`. Als regulaerer Deskriptor jetzt auch
 *  ueber `commandsFor()`/`api.plan("undo.last", …)` erreichbar (GUI-Smoke P12). `kind: "any"`,
 *  weil dasselbe Kommando auf Termine UND Kontakte wirkt (`ctx.profile.kind` entscheidet zur
 *  Laufzeit in `planUndoLast` selbst) — eine zweite Registrierung unter demselben Id wäre ein
 *  Verstoss gegen die Eindeutigkeitspruefung in `registerCommands()`. `appliesTo` prueft NUR
 *  `ctx.history` (vom Aufrufer befuellt, s. `buildCommandContext`) — ein Ziel ohne Verlauf hat
 *  nichts rueckgaengig zu machen. */
export const UNDO_LAST_COMMAND: CommandDescriptor = {
  id: "undo.last",
  kind: "any",
  title: "Letzte Änderung rückgängig machen",
  description: "Stellt den vorherigen Verlaufseintrag des Zielobjekts wieder her",
  schema: { type: "object", properties: {} },
  appliesTo(ctx: CommandContext): boolean {
    return (ctx.history?.length ?? 0) > 0;
  },
  plan(_input: Record<string, unknown>, ctx: CommandContext): CommandPlan {
    const plan = planUndoLast(ctx, ctx.history ?? []);
    if (!plan) throw new Error("undo.last: kein Verlauf vorhanden");
    return plan;
  },
};
