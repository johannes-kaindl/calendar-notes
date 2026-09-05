import type { NotePlan } from "../mirror/plan";
import type { NoteLookup } from "../mirror/apply";
import type { MappingProfile } from "../mirror/profile";
import type { AttendeeResolver } from "../mirror/fields";
import type { RunInfo } from "../state/collection-state";
import type { CollectionState } from "../state/collection-state";
import type { Account, PluginSettings } from "../settings";
import type { Transport } from "../dav/types";
import type { BusyGuard } from "./busy";
import type { SyncEmitter } from "./events";

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
  /**
   * `NoteLookup` fuer dieses Profil, bereits geprimt (Index-Pfade + State-Pfade).
   *
   * `extraPaths` primt zusaetzliche Notizen, die in beiden Quellen NICHT vorkommen — der Fall
   * ist eine im Vault entstandene Aufgabe, die gerade erst auf den Server geschrieben wurde:
   * sie traegt noch keine `dav_uid`, steht also in keinem Index und in keinem State. Ohne sie
   * hier zu nennen, liefert `byPath` fuer sie `undefined` (bewusst — s. `VaultNoteLookup`),
   * und `CommandPlan.claimsNote` liefe ins Leere.
   */
  lookupFor(profile: MappingProfile, extraPaths?: string[]): Promise<NoteLookup>;
  executor: PlanExecutor;
  notify: Notifier;
  now(): Date;
  resolveAttendee?(): AttendeeResolver | undefined; // aus Kontakt-Index (E-Mail -> Pfad)
  /** Bidirektionaler Busy-Guard (core/sync/busy.ts), geteilt zwischen `SyncService` und
   *  `executeCommandPlan` — egal wer zuerst `tryAcquire()`, die andere Seite sieht `isBusy()`
   *  und bricht busy ab, statt gleichzeitig gegen dasselbe Objekt zu schreiben. */
  busy: BusyGuard;
  /** Optional (Task 7, Spec §5b): `synced`/`changed`-Events fuer die Plugin-API. Optional,
   *  damit bestehende Tests/Fakes ohne Emitter weiterlaufen — `?.emit(...)` ist dann ein No-op. */
  events?: SyncEmitter;
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
  skippedReason?: "disabled" | "no-secret" | "no-profile" | "busy" | "unsupported-components";
}

export interface RunResult {
  startedAt: string;
  finishedAt: string;
  collections: CollectionRunResult[];
}
