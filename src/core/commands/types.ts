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
  /** Verlauf des Zielobjekts (`ObjectState.history`, neueste zuerst) — Fix-Runde 1: macht
   *  `undo.last` zu einem regulaeren Registry-Eintrag statt eines Sonderpfads nur in
   *  `CommandFlow` (s. `src/core/commands/undo.ts`). Inline statt Import aus
   *  `state/collection-state.ts`, um `commands/types.ts` nicht an das State-Modul zu koppeln —
   *  dieselbe Form wie `ObjectState["history"]`. */
  history?: { etag: string; raw: string; at: string }[];
}

export interface CommandPlan {
  commandId: string;
  target: CommandTarget;
  /** Fertig formatierter Anzeigetext (z. B. „Termin verschoben: 01.09. 10:00–11:30") — heute
   *  fest Deutsch, weil er aus den Server-Rohdaten gebaut wird und `src/core/**` kein i18n
   *  kennt. Fuer eine EN-Oberflaeche (M5) braucht es einen strukturierten Nachfolger
   *  (`summaryKey` + Parameter statt eines fertigen Strings), damit die Obsidian-Schicht
   *  uebersetzen kann — nicht Teil dieses Tasks. Dieselbe Schuld traegt `CommandDescriptor.
   *  title`/`.description` UND jede Schema-Feld-`description` (`FieldSchema`,
   *  `src/core/commands/schema.ts`) — s. den Sammel-Kommentar bei `CommandDescriptor` unten,
   *  der die volle Konsequenz (inkl. `api.commands()`/`api.tools()`) beschreibt. */
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

/** i18n-Schuld (M9, Review-Runde 3 — Sammel-Kommentar, gilt fuer `title`/`description` hier,
 *  `CommandPlan.summary` oben UND jede Schema-Feld-`description` in `FieldSchema`/
 *  `ObjectSchema`, `src/core/commands/schema.ts`): alle drei sind heute fest deutschsprachige
 *  Literale (Kommando-Register wird einmalig in event-commands.ts/contact-commands.ts
 *  befuellt, kein i18n-Import erlaubt in `src/core/**`). Fuer eine EN-Oberflaeche (M5) braucht
 *  es strukturierte Nachfolger statt fertiger Strings — `titleKey`/`descriptionKey` hier,
 *  `summaryKey` (+ Parameter) an `CommandPlan`, `descriptionKey` je Schema-Feld — jeweils erst
 *  in der Obsidian-Schicht (Formular-/Vorschau-Modal) ueber `t()` aufgeloest; dieser Task
 *  fuehrt das noch nicht ein, alle drei zeigen bis dahin unveraendert die deutschen Literale.
 *  WICHTIG, ueber die UI hinaus: `api.commands()`/`api.tools()` (`src/obsidian/api.ts`, Spec
 *  §5b) geben `title`/`description`/Schema-`description` unveraendert an Fremdplugins/
 *  LLM-Tool-Definitionen weiter — ein Wechsel von fertigem Text auf `*Key`-Felder ist also
 *  eine BRECHENDE Aenderung des Plugin-API-Vertrags (`CALENDAR_NOTES_API_VERSION` muesste
 *  steigen, s. `docs/API.md`), kein rein internes Refactoring. */
export interface CommandDescriptor {
  id: string;
  /** "any" fuer Kommandos, die auf BEIDE Arten wirken (aktuell nur `undo.last`) — nichts im
   *  Code verzweigt auf dieses Feld (rein deskriptiv fuer Anzeige/`commands()`), s. Fix-Runde 1. */
  kind: "event" | "contact" | "any";
  title: string;
  description: string;
  schema: ObjectSchema;
  appliesTo(ctx: CommandContext): boolean;
  plan(input: Record<string, unknown>, ctx: CommandContext): CommandPlan;
}
