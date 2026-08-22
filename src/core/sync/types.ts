import type { NotePlan } from "../mirror/plan";
import type { NoteLookup } from "../mirror/apply";
import type { MappingProfile } from "../mirror/profile";
import type { AttendeeResolver } from "../mirror/fields";
import type { RunInfo } from "../state/collection-state";
import type { CollectionState } from "../state/collection-state";
import type { Account, PluginSettings } from "../settings";
import type { Transport } from "../dav/types";

/** Strukturelle Verträge, die der SyncService konsumiert — src/core/** bleibt damit
 *  obsidian-/node-/DOM-frei (check:pure), waehrend src/obsidian/* konkrete
 *  Implementierungen liefert, die diese Interfaces ERFUELLEN statt sie zu importieren.
 *  Die konkreten Klassen (`MemorySecretStore`, `obsidianSecretStore`, `MemoryStateStore`,
 *  `adapterStateStore`, `vaultPlanExecutor`) leben weiterhin in `src/obsidian/*` und
 *  re-exportieren die hier definierten Typen — Importe bleiben so einseitig
 *  (obsidian → core, nie core → obsidian). */

export interface Notifier {
  info(msg: string): void;
  warn(msg: string): void;
  /** Strukturierter Ruf statt eines fertig formatierten Strings: `src/core/**` darf keine
   *  deutschsprachigen Literale enthalten (kein i18n-Import, `check:pure`). Der Aufrufer
   *  (`plugin-host.ts`) formatiert mit `t("notice.handEdited", count)`. */
  handEdited(count: number): void;
}

export interface SecretStore {
  get(id: string): string | null;
  set(id: string, value: string): void; // wirft, wenn Ruecklesen fehlschlaegt
  has(id: string): boolean;
}

export interface StateStore {
  load(source: string): Promise<CollectionState>;
  save(state: CollectionState): Promise<void>;
  remove(source: string): Promise<void>;
}

export interface PlanExecutor {
  execute(plan: NotePlan): Promise<void>;
}

export interface SyncDeps {
  settings(): PluginSettings;
  saveSettings(s: PluginSettings): Promise<void>; // ctag/syncToken je Collection zurueckschreiben
  secrets: SecretStore;
  stateStore: StateStore;
  transportFor(account: Account, password: string): Transport;
  lookupFor(profile: MappingProfile): Promise<NoteLookup>; // inkl. prime()
  executor: PlanExecutor;
  notify: Notifier;
  now(): Date;
  resolveAttendee?(): AttendeeResolver | undefined; // aus Kontakt-Index (E-Mail -> Pfad)
}

export interface CollectionRunResult {
  collectionId: string;
  ok: boolean;
  dryRun: boolean;
  plans: NotePlan[];
  counts: RunInfo["counts"];
  error?: string;
  handEdited: { path: string; keys: string[] }[];
  strategy?: string;
  skippedReason?: "disabled" | "no-secret" | "no-profile" | "busy";
}

export interface RunResult {
  startedAt: string;
  finishedAt: string;
  collections: CollectionRunResult[];
}
