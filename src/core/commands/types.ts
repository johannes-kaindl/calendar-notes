import type { MappingProfile } from "../mirror/profile";
import type { Account, CollectionConfig } from "../settings";
import type { ObjectSchema } from "./schema";

export type CommandTarget =
  | { kind: "event" | "contact"; source: string; href: string; uid: string }
  | { kind: "event" | "contact"; source: string; new: true };

export interface CommandContext {
  now: Date;
  profile: MappingProfile;
  collection: CollectionConfig;
  account: Account;
  target: CommandTarget;
  raw?: string;
  etag?: string;
  rand: () => number;
  /** Vorabgriff auf Account.scheduling (Task 5) — hier direkt am Kontext, damit T2/T3 nicht auf T5 warten muessen. */
  scheduling?: { addresses: string[]; outbox?: string };
  resolveContact?(email: string): { path: string; display?: string } | undefined;
}

export interface CommandPlan {
  commandId: string;
  target: CommandTarget;
  summary: string;
  diff: { field: string; before?: string; after?: string }[];
  newRaw: string;
  etag?: string;
  contentType: "text/calendar" | "text/vcard";
  hrefForPut: string;
  createsNew: boolean;
  invite?: { attendees: string[]; method: "REQUEST" | "CANCEL" };
  delete?: true;
}

export interface CommandDescriptor {
  id: string;
  kind: "event" | "contact";
  title: string;
  description: string;
  schema: ObjectSchema;
  appliesTo(ctx: CommandContext): boolean;
  plan(input: Record<string, unknown>, ctx: CommandContext): CommandPlan;
}
