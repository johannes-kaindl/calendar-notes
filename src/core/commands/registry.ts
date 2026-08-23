import { CONTACT_COMMANDS } from "./contact-commands";
import { EVENT_COMMANDS } from "./event-commands";
import type { CommandContext, CommandDescriptor } from "./types";
import { UNDO_LAST_COMMAND } from "./undo";

// Kommandos registrieren sich als Arrays (keine automatischen Seiteneffekte beim Import der
// Kommando-Module); der Aufrufer (Komposition, z. B. main.ts oder ein Test) baut das Register
// per registerCommands() aus den exportierten Arrays der *-commands.ts-Module zusammen.
let registered: CommandDescriptor[] = [];

export function registerCommands(cmds: CommandDescriptor[]): void {
  const seen = new Set(registered.map((c) => c.id));
  for (const c of cmds) {
    if (seen.has(c.id)) throw new Error(`Doppelte Kommando-ID: ${c.id}`);
    seen.add(c.id);
  }
  registered = [...registered, ...cmds];
}

/** Befuellt die Registry mit dem eingebauten Kommando-Satz (Event- + Contact-Kommandos +
 *  `undo.last`) — IDEMPOTENT: registriert nur, was noch NICHT unter derselben id vorliegt
 *  (egal ob von einem frueheren Aufruf hier oder von Tests manuell). Fix-Runde 1, Punkt 0:
 *  `src/main.ts` rief bisher `registerCommands()` nirgends auf, die Registry blieb zur
 *  Laufzeit leer — `commandsFor()`/`api.plan()`/`api.commands()`/`api.tools()` liefen ins
 *  Leere (GUI-Smoke P10/P11/P13). Sicher gegen Mehrfachaufruf (z. B. ein Plugin-Reload im
 *  selben Obsidian-Prozess) — anders als ein blindes `registerCommands([...])` wirft das
 *  hier NIE „Doppelte Kommando-ID". */
export function ensureDefaultCommands(): void {
  const ids = new Set(registered.map((c) => c.id));
  const defaults = [...EVENT_COMMANDS, ...CONTACT_COMMANDS, UNDO_LAST_COMMAND];
  const missing = defaults.filter((c) => !ids.has(c.id));
  if (missing.length > 0) registerCommands(missing);
}

export function resetCommands(): void {
  registered = [];
}

export function commandRegistry(): CommandDescriptor[] {
  return [...registered];
}

export function findCommand(id: string): CommandDescriptor | undefined {
  return registered.find((c) => c.id === id);
}

export function commandsFor(ctx: CommandContext): CommandDescriptor[] {
  return registered.filter((c) => c.appliesTo(ctx));
}

export function toolDefinitions(): { name: string; description: string; parameters: CommandDescriptor["schema"] }[] {
  return registered.map((c) => ({
    name: c.id.replace(/\./g, "_"),
    description: `${c.title} — ${c.description}`,
    parameters: c.schema,
  }));
}
