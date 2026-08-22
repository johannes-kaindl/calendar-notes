import type { ImipMessage } from "../commands/imip";
import type { ObjectSchema } from "../commands/schema";
import type { CommandPlan } from "../commands/types";
import type { EventData } from "../ical/event";
import type { ExecuteResult } from "../sync/execute";
import type { SyncEvents } from "../sync/events";
import type { ContactData } from "../vcard/contact";

/**
 * Oeffentlicher Vertrag `app.plugins.plugins["calendar-notes"].api` (Task 7, Spec §5b) —
 * nach dem Anbieter-Muster `vault-rag/src/plugin_api.ts`. Pure Typen, kein Obsidian-Import
 * (`src/core/**`, `check:pure`): die Implementierung lebt in `src/obsidian/api.ts`.
 *
 * Versionierung: `version: 1` erhoeht sich bei jeder brechenden Aenderung. Konsumenten
 * (Koda, mailstone) lesen die API bei JEDEM Aufruf frisch (nie beim Laden cachen — dieses
 * Plugin kann jederzeit deaktiviert werden) und pruefen `version` gegen ihre eigene
 * Konstante, bevor sie sich auf die Form der Rueckgaben verlassen.
 */
export const CALENDAR_NOTES_API_VERSION = 1;

/** Erwartbare Fehler sind WERTE, keine Ausnahmen: jede Methode faengt selbst und liefert
 *  `{ error }` statt zu werfen — ein Fremdplugin soll `"error" in result` pruefen, nicht
 *  raten muessen, welche Fehlerklasse ein `throw` transportiert (s. `VaultRetrievalApi`,
 *  REGISTRY § Plugin-zu-Plugin). `error` ist ein rohes (unuebersetztes) Diagnosewort —
 *  die Formulierung gehoert dem Aufrufer. */
export interface ApiError {
  error: string;
}

export interface ApiEvent {
  uid: string;
  source: string;
  collectionId: string;
  /** Pfad der zugehoerigen Notiz — fehlt nur, wenn (noch) keine Master-Notiz existiert. */
  path?: string;
  data: EventData;
}

export interface ApiContact {
  uid: string;
  source: string;
  collectionId: string;
  path?: string;
  data: ContactData;
}

export interface EventsQuery {
  /** ISO-Datum/-Zeit, inklusive Untergrenze — Vergleich ist ein einfacher String-Vergleich
   *  gegen `EventData.start` (kein Zeitzonen-Normalisieren, s. `src/core/api/read.ts`). */
  from?: string;
  to?: string;
  collectionId?: string;
}

export interface ContactsQuery {
  /** Teilstring-Suche (case-insensitive) ueber `fn` + alle `emails[].value`. */
  query?: string;
  collectionId?: string;
}

/** Ziel eines `plan()`-Aufrufs — Gegenstueck zu `CommandTarget` (core/commands/types.ts),
 *  aber ohne `href`: die API loest ein Ziel ueber `uid`+`source` im Collection-State auf,
 *  nie ueber Notiz-Frontmatter (die API hat keine aktive Notiz). */
export type ApiTargetRef = { uid: string; source: string } | { new: true; collectionId: string };

export type InviteRouteName = "server" | "transport" | "ics";

/** `CommandPlan` ist bereits serialisierbar (keine Funktionen/Klassen) — die API reicht ihn
 *  unveraendert durch und ergaenzt nur den vorab ermittelten Einladungs-Weg, damit ein
 *  Konsument VOR `execute()` weiss, ob eine E-Mail verschickt wuerde. */
export interface ApiPlan extends CommandPlan {
  inviteRoute?: InviteRouteName;
}

/** `execute()`-Ergebnis: `ExecuteResult` (core/sync/execute.ts) plus — nur bei Erfolg und
 *  wenn der Plan eine Einladung enthielt — was mit ihr geschah. Die API oeffnet dafuer NIE
 *  das `.ics`-Modal (anders als `InviteRouter.deliver` in `src/obsidian/invite.ts`): bei
 *  Server-/Transport-Weg wird zugestellt, beim `ics`-Weg kommt der fertige Text im Feld
 *  `ics` zurueck, der Aufrufer entscheidet selbst, was er damit tut. */
export type ApiExecuteResult = ExecuteResult & {
  invite?: { route: InviteRouteName; delivered?: boolean; ics?: string };
};

export interface ApiCommandDescriptor {
  id: string;
  kind: "event" | "contact";
  title: string;
  description: string;
  schema: ObjectSchema;
}

export interface ApiToolDefinition {
  name: string;
  description: string;
  parameters: ObjectSchema;
}

/** Vertrag mit mailstone (`../../../mailstone/docs/2026-08-22-anforderungen-aus-calendar-notes.md`
 *  § 2) — bewusst eine EIGENSTAENDIGE Kopie statt eines Imports aus `src/obsidian/invite.ts`:
 *  `src/core/**` bleibt obsidian-frei (`check:pure`), und zwei eigenstaendige Store-Repos
 *  (PROF-OBS-09) sollen kein Build-Coupling ueber ihre internen Typen eingehen — die
 *  Versionsnummer der API ist der vereinbarte Ersatz fuer den Compiler. */
export interface MailTransport {
  id: string;
  label: string;
  accounts(): Promise<{ id: string; address: string; label: string }[]>;
  send(msg: ImipMessage): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }>;
}

export interface CalendarNotesApi {
  version: 1;

  /** Termine aus allen (oder einer) Sammlung(en), deren Profil `kind: "event"` ist. */
  events(q?: EventsQuery): Promise<ApiEvent[] | ApiError>;
  /** Kontakte aus allen (oder einer) Sammlung(en), deren Profil `kind: "contact"` ist. */
  contacts(q?: ContactsQuery): Promise<ApiContact[] | ApiError>;
  /** Ein einzelnes Objekt ueber `uid` (+ optional `source` zur Eingrenzung). `null`, wenn
   *  nichts gefunden wurde — kein `ApiError`, ein leerer Treffer ist kein Fehlerzustand. */
  get(ref: { uid: string; source?: string }): Promise<ApiEvent | ApiContact | null | ApiError>;

  /** Kommando-Beschreibungen fuer Formulare/Anzeige. */
  commands(): ApiCommandDescriptor[];
  /** Dieselben Kommandos als LLM-Tool-Definitionen (`toolDefinitions()` aus der Registry). */
  tools(): ApiToolDefinition[];
  /** Baut einen `CommandPlan`, schreibt NICHTS. Bestaetigung liegt beim Aufrufer — Koda
   *  bestaetigt je Schreibvorgang, eine Crew duerfte nur schema-validiert `plan`+`execute`. */
  plan(commandId: string, input: Record<string, unknown>, target: ApiTargetRef): Promise<ApiPlan | ApiError>;
  /** Fuehrt einen zuvor per `plan()` erzeugten Plan aus (PUT/DELETE + gezielter Resync). */
  execute(plan: ApiPlan): Promise<ApiExecuteResult | ApiError>;

  /** mailstone-Registrierung (s. `MailTransport` oben) — validiert die Form defensiv, ein
   *  fremder Aufrufer bekommt kein TS-Vertrauen geschenkt. */
  registerMailTransport(t: MailTransport): { ok: true } | ApiError;
  unregisterMailTransport(id: string): void;

  /** `synced`: einmal je Sammlungs-Ergebnis (Trockenlauf inklusive). `changed`: je
   *  tatsaechlich ausgefuehrtem Notiz-Plan (Sync-Lauf UND Kommando-Resync). */
  on(event: "synced", cb: (e: SyncEvents["synced"]) => void): () => void;
  on(event: "changed", cb: (e: SyncEvents["changed"]) => void): () => void;
}
