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
  /** ENGLISCHER Fallback-Anzeigetext (z. B. "Event moved: 2026-09-01 10:00–11:30"), aus den
   *  Server-Rohdaten gebaut UND aus denselben Argumenten wie `summaryArgs` komponiert — core
   *  bleibt dabei i18n-frei (kein `t()`-Import in `src/core/**`). Die Obsidian-Schicht
   *  uebersetzt ueber `summaryKey`/`summaryArgs` (`src/obsidian/command-i18n.ts::trPlan()`)
   *  und faellt auf dieses Feld zurueck, wenn `summaryKey` in keinem Woerterbuch steht (z. B.
   *  ein Fremdplugin-Kommando ohne eigene i18n-Eintraege). */
  summary: string;
  /** i18n-Key fuer `summary` (Schema `plan.<commandId>.summary`, teils mit `.changed`/
   *  `.removed`-Suffix bei zwei strukturell verschiedenen Formulierungen desselben Kommandos
   *  — s. `src/i18n/strings.ts`) + die Argumente, mit denen `t(summaryKey, ...summaryArgs)`
   *  denselben Text wie `summary` (in der jeweiligen Sprache) erzeugt. */
  summaryKey: string;
  summaryArgs: (string | number)[];
  diff: { field: string; before?: string; after?: string }[];
  newRaw: string;
  etag?: string;
  contentType: "text/calendar" | "text/vcard";
  hrefForPut: string;
  createsNew: boolean;
  invite?: { attendees: string[]; method: "REQUEST" | "CANCEL" };
  delete?: true;
}

/** i18n (M5, Task 1 — Sammel-Kommentar, gilt fuer `title`/`description` hier, `CommandPlan.
 *  summary`/`summaryKey` oben UND jede Schema-Feld-`description`/`descriptionKey` in
 *  `FieldSchema`/`ObjectSchema`, `src/core/commands/schema.ts`): `title`/`description` sind
 *  der ENGLISCHE Fallback-Text (core bleibt i18n-frei — kein `t()`-Import in
 *  `src/core/**`); `titleKey`/`descriptionKey` sind die zugehoerigen Schluessel (Schema
 *  `cmd.<id>.title`/`cmd.<id>.desc`, `id` mit `.` — z. B. `cmd.event.move.title`), aufgeloest
 *  erst in der Obsidian-Schicht (`src/obsidian/command-i18n.ts::tr()`) ueber `t()`, mit
 *  Rueckfall auf den englischen Fallback, wenn der Key in keinem Woerterbuch steht (z. B. ein
 *  Fremdplugin-Kommando ohne eigene i18n-Eintraege — `registerCommands()` ist oeffentliche
 *  API). WICHTIG, ueber die UI hinaus: `api.commands()` (`src/obsidian/api.ts`, Spec §5b)
 *  gibt `title`/`description` UEBERSETZT zurueck (plus `titleKey`/`descriptionKey` fuer
 *  Konsumenten, die Stabilitaet statt Sprache brauchen); `api.tools()` uebersetzt zusaetzlich
 *  jede Schema-Feld-`description` (LLM-Tool-Definitionen wollen fertigen Text). Beides ist
 *  eine additive Erweiterung des bestehenden Vertrags (neue Felder, keine entfernten/
 *  umbenannten) — `CALENDAR_NOTES_API_VERSION` bleibt unveraendert, s. `docs/API.md`. */
export interface CommandDescriptor {
  id: string;
  /** "any" fuer Kommandos, die auf BEIDE Arten wirken (aktuell nur `undo.last`) — nichts im
   *  Code verzweigt auf dieses Feld (rein deskriptiv fuer Anzeige/`commands()`), s. Fix-Runde 1. */
  kind: "event" | "contact" | "any";
  title: string;
  titleKey: string;
  description: string;
  descriptionKey: string;
  schema: ObjectSchema;
  appliesTo(ctx: CommandContext): boolean;
  plan(input: Record<string, unknown>, ctx: CommandContext): CommandPlan;
}
