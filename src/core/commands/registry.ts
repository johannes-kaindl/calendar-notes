import type { CommandContext, CommandDescriptor } from "./types";

// Kommandos registrieren sich als Arrays (keine automatischen Seiteneffekte beim Import der
// Kommando-Module); der Aufrufer (Komposition, z. B. main.ts oder ein Test) baut das Register
// per registerCommands() aus den exportierten Arrays der *-commands.ts-Module zusammen.
let registered: CommandDescriptor[] = [];

export function registerCommands(cmds: CommandDescriptor[]): void {
  registered = [...registered, ...cmds];
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
