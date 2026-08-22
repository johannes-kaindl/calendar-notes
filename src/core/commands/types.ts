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
  /** Fertig formatierter Anzeigetext (z. B. „Termin verschoben: 01.09. 10:00–11:30") — heute
   *  fest Deutsch, weil er aus den Server-Rohdaten gebaut wird und `src/core/**` kein i18n
   *  kennt. Fuer eine EN-Oberflaeche (M5) braucht es einen strukturierten Nachfolger
   *  (`summaryKey` + Parameter statt eines fertigen Strings), damit die Obsidian-Schicht
   *  uebersetzen kann — nicht Teil dieses Tasks. */
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

/** `title`/`description` sind heute fest deutschsprachige Literale (Kommando-Register wird
 *  einmalig in event-commands.ts/contact-commands.ts befuellt, kein i18n-Import erlaubt in
 *  `src/core/**`). Fuer eine EN-Oberflaeche (M5) braucht der Descriptor stattdessen
 *  `titleKey`/`descriptionKey`, die die Obsidian-Schicht ueber `t()` aufloest — dieser Task
 *  fuehrt das noch nicht ein, die Formular-/Vorschau-Modals zeigen bis dahin die deutschen
 *  Literale unveraendert an. */
export interface CommandDescriptor {
  id: string;
  kind: "event" | "contact";
  title: string;
  description: string;
  schema: ObjectSchema;
  appliesTo(ctx: CommandContext): boolean;
  plan(input: Record<string, unknown>, ctx: CommandContext): CommandPlan;
}
