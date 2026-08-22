import { describe, it, expect, beforeEach } from "vitest";
import { commandRegistry, findCommand, commandsFor, toolDefinitions, registerCommands, resetCommands } from "../../../src/core/commands/registry";
import type { CommandDescriptor, CommandContext } from "../../../src/core/commands/types";
import { defaultEventProfile, defaultContactProfile } from "../../../src/core/mirror/profile";
import type { Account, CollectionConfig } from "../../../src/core/settings";
import { EVENT_COMMANDS } from "../../../src/core/commands/event-commands";
import { CONTACT_COMMANDS } from "../../../src/core/commands/contact-commands";

function descriptor(id: string, kind: "event" | "contact", appliesTo: (ctx: CommandContext) => boolean = () => true): CommandDescriptor {
  return {
    id, kind, title: `Titel ${id}`, description: `Beschreibung ${id}`,
    schema: { type: "object", properties: { x: { type: "string" } } },
    appliesTo,
    plan: () => {
      throw new Error("nicht getestet");
    },
  };
}

const ACCOUNT: Account = { id: "a1", name: "Acc", baseUrl: "https://d/", username: "u", secretId: "s1" };
const EVENT_COL: CollectionConfig = { id: "c1", accountId: "a1", href: "https://d/cal/", kind: "calendar", displayName: "Cal", enabled: true, profileId: "default-event", readOnly: false };

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    now: new Date("2026-08-22T10:00:00Z"),
    profile: defaultEventProfile(),
    collection: EVENT_COL,
    account: ACCOUNT,
    target: { kind: "event", source: "a1/c1", new: true },
    rand: () => 0.5,
    ...overrides,
  };
}

describe("commands registry", () => {
  beforeEach(() => resetCommands());

  it("commandRegistry liefert alle registrierten Deskriptoren mit eindeutigen ids", () => {
    registerCommands([descriptor("event.move", "event"), descriptor("contact.set-name", "contact")]);
    const all = commandRegistry();
    expect(all.map((c) => c.id).sort()).toEqual(["contact.set-name", "event.move"]);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it("findCommand findet per id, sonst undefined", () => {
    registerCommands([descriptor("event.move", "event")]);
    expect(findCommand("event.move")?.id).toBe("event.move");
    expect(findCommand("nope")).toBeUndefined();
  });

  it("commandsFor filtert ueber appliesTo(ctx)", () => {
    registerCommands([
      descriptor("event.move", "event", (c) => c.target.kind === "event"),
      descriptor("contact.set-name", "contact", (c) => c.target.kind === "contact"),
    ]);
    const eventCtx = ctx();
    expect(commandsFor(eventCtx).map((c) => c.id)).toEqual(["event.move"]);
    const contactCtx = ctx({ profile: defaultContactProfile(), target: { kind: "contact", source: "a1/c1", new: true } });
    expect(commandsFor(contactCtx).map((c) => c.id)).toEqual(["contact.set-name"]);
  });

  it("toolDefinitions: name mit Unterstrich statt Punkt, description aus title+description, parameters == schema", () => {
    const d = descriptor("event.set-title", "event");
    registerCommands([d]);
    const defs = toolDefinitions();
    expect(defs).toEqual([{ name: "event_set-title", description: "Titel event.set-title — Beschreibung event.set-title", parameters: d.schema }]);
  });

  it("leeres Register liefert leere Ergebnisse", () => {
    expect(commandRegistry()).toEqual([]);
    expect(findCommand("x")).toBeUndefined();
    expect(commandsFor(ctx())).toEqual([]);
    expect(toolDefinitions()).toEqual([]);
  });

  it("registerCommands wirft bei doppelter id (innerhalb eines Aufrufs)", () => {
    expect(() => registerCommands([descriptor("event.move", "event"), descriptor("event.move", "event")])).toThrow("Doppelte Kommando-ID: event.move");
  });

  it("registerCommands wirft bei doppelter id (gegen bereits Registriertes)", () => {
    registerCommands([descriptor("event.move", "event")]);
    expect(() => registerCommands([descriptor("event.move", "event")])).toThrow("Doppelte Kommando-ID: event.move");
  });

  it("nach einem Wurf bleibt das Register unveraendert (kein Teil-Effekt)", () => {
    registerCommands([descriptor("event.move", "event")]);
    expect(() => registerCommands([descriptor("contact.set-name", "contact"), descriptor("event.move", "event")])).toThrow();
    expect(commandRegistry().map((c) => c.id)).toEqual(["event.move"]);
  });

  it("das reale Register (EVENT_COMMANDS ∪ CONTACT_COMMANDS) hat eindeutige ids und eindeutige toolDefinitions-Namen", () => {
    registerCommands([...EVENT_COMMANDS, ...CONTACT_COMMANDS]);
    const all = commandRegistry();
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = toolDefinitions().map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
