import type { DavCollection, Transport } from "../dav/types";
import { refreshCollection } from "../dav/refresh";
import { syncCollection, type SyncDelta } from "../dav/sync";
import { applyDelta } from "../mirror/apply";
import { windowFor, toDavTimeRange, type Window } from "../mirror/window";
import { effectiveProfile, sourceOf, type CollectionConfig, type PluginSettings } from "../settings";
import { withRun, type CollectionState, type RunInfo } from "../state/collection-state";
import type { CollectionRunResult, RunResult, SyncDeps } from "./types";

function zeroCounts(): RunInfo["counts"] {
  return { created: 0, updated: 0, skipped: 0, archived: 0, deleted: 0, errors: 0 };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errorStringOf(applyErrors: { href: string; message: string }[], execErrors: { path: string; message: string }[]): string | undefined {
  const parts = [...applyErrors.map((e) => `${e.href}: ${e.message}`), ...execErrors.map((e) => `${e.path}: ${e.message}`)];
  return parts.length ? parts.join("; ") : undefined;
}

function skipped(collectionId: string, dryRun: boolean, reason: NonNullable<CollectionRunResult["skippedReason"]>): CollectionRunResult {
  return { collectionId, ok: true, dryRun, plans: [], counts: zeroCounts(), handEdited: [], skippedReason: reason };
}

function baseCollectionOf(col: CollectionConfig): DavCollection {
  return {
    href: col.href,
    kind: col.kind,
    displayName: col.displayName,
    readOnly: col.readOnly,
    ...(col.ctag ? { ctag: col.ctag } : {}),
    ...(col.syncToken ? { syncToken: col.syncToken } : {}),
  };
}

/**
 * Orchestriert einen Sync-Lauf ueber alle (oder eine) konfigurierten Collections:
 * PROPFIND-Refresh, Server-Diff, `applyDelta`, Plan-Ausfuehrung, Zustand + Settings
 * zurueckschreiben, Meldungen. Pure bis auf die injizierten `SyncDeps`-Interfaces
 * (Transport, SecretStore, StateStore, PlanExecutor, Notifier) — kein Obsidian-,
 * Node- oder DOM-Import (`check:pure` deckt `src/core/**` ab).
 *
 * Kalender laufen IMMER ueber die etag-Diff-Strategie (Fenster erzwingt einen
 * vollstaendigen Fenster-Scan statt sync-collection, s. `syncCollection`-Aufruf
 * unten mit `syncToken: undefined`) — nur so kommen Termine, die neu ins Fenster
 * ruecken, als `changed` herein und `outOfWindow` wird ueberhaupt berechnet.
 * Adressbuecher nutzen sync-collection, wenn ein Token vorliegt (sync.ts entscheidet
 * das selbst anhand von `col.syncToken`).
 */
export class SyncService {
  private last: RunResult | undefined;

  constructor(private readonly deps: SyncDeps) {}

  /** Bidirektional mit `executeCommandPlan` geteilt (`deps.busy`, s. core/sync/busy.ts) —
   *  laeuft gerade ein Kommando, meldet sich ein Sync-Lauf hier ebenfalls busy. */
  isRunning(): boolean {
    return this.deps.busy.isBusy();
  }

  lastResult(): RunResult | undefined {
    return this.last;
  }

  async runAll(opts?: { dryRun?: boolean }): Promise<RunResult> {
    const dryRun = opts?.dryRun ?? false;
    if (!this.deps.busy.tryAcquire()) {
      const now = this.deps.now().toISOString();
      const settings = this.deps.settings();
      return { startedAt: now, finishedAt: now, collections: settings.collections.map((c) => skipped(c.id, dryRun, "busy")) };
    }
    try {
      const startedAt = this.deps.now().toISOString();
      const settings = this.deps.settings();
      const collections: CollectionRunResult[] = [];
      for (const col of settings.collections) {
        collections.push(await this.processCollection(col, dryRun));
      }
      const finishedAt = this.deps.now().toISOString();
      this.notifyHandEdited(collections);
      const result: RunResult = { startedAt, finishedAt, collections };
      this.last = result;
      return result;
    } finally {
      this.deps.busy.release();
    }
  }

  async runCollection(collectionId: string, opts?: { dryRun?: boolean }): Promise<CollectionRunResult> {
    const dryRun = opts?.dryRun ?? false;
    if (!this.deps.busy.tryAcquire()) return skipped(collectionId, dryRun, "busy");
    try {
      const startedAt = this.deps.now().toISOString();
      const settings = this.deps.settings();
      const col = settings.collections.find((c) => c.id === collectionId);
      const result = col ? await this.processCollection(col, dryRun) : skipped(collectionId, dryRun, "no-profile");
      const finishedAt = this.deps.now().toISOString();
      this.notifyHandEdited([result]);
      this.last = { startedAt, finishedAt, collections: [result] };
      return result;
    } finally {
      this.deps.busy.release();
    }
  }

  private notifyHandEdited(results: CollectionRunResult[]): void {
    const total = results.reduce((n, r) => n + r.handEdited.length, 0);
    if (total > 0) this.deps.notify.handEdited(total);
  }

  private async processCollection(col: CollectionConfig, dryRun: boolean): Promise<CollectionRunResult> {
    if (!col.enabled) return skipped(col.id, dryRun, "disabled");
    const settings = this.deps.settings();
    const account = settings.accounts.find((a) => a.id === col.accountId);
    const profile = effectiveProfile(settings, col);
    if (!account || !profile) return skipped(col.id, dryRun, "no-profile");
    const secret = this.deps.secrets.get(account.secretId);
    if (secret === null || secret === "") return skipped(col.id, dryRun, "no-secret");

    const source = sourceOf(col);
    const state = await this.deps.stateStore.load(source);
    try {
      const transport: Transport = this.deps.transportFor(account, secret);
      const fresh = await refreshCollection(transport, baseCollectionOf(col));

      const now = this.deps.now();
      let timeWindow: Window | undefined;
      let delta: SyncDelta;
      if (col.kind === "calendar") {
        timeWindow = windowFor(now, settings.sync.pastDays, settings.sync.futureDays);
        const timeRange = toDavTimeRange(timeWindow);
        delta = await syncCollection(transport, { ...fresh, syncToken: undefined }, state.snapshot, { timeRange, batchSize: settings.sync.batchSize });
      } else {
        delta = await syncCollection(transport, fresh, state.snapshot, { batchSize: settings.sync.batchSize });
      }

      const lookup = await this.deps.lookupFor(profile);
      const resolveAttendee = this.deps.resolveAttendee?.();
      const applyResult = applyDelta({
        profile, source, delta, state, lookup, now,
        ...(timeWindow ? { timeWindow } : {}),
        ...(resolveAttendee ? { resolveAttendee } : {}),
      });
      const handEdited = applyResult.plans
        .filter((p): p is Extract<typeof applyResult.plans[number], { op: "update" }> => p.op === "update" && p.handEdited.length > 0)
        .map((p) => ({ path: p.path, keys: p.handEdited }));

      if (dryRun) {
        const errorStr = errorStringOf(applyResult.errors, []);
        this.deps.events?.emit("synced", { collectionId: col.id, counts: applyResult.counts });
        return { collectionId: col.id, ok: true, dryRun: true, plans: applyResult.plans, counts: applyResult.counts, handEdited, strategy: delta.strategy, ...(errorStr ? { error: errorStr } : {}) };
      }

      // `emit("changed", …)` laeuft AUSSERHALB des try-Blocks (Fix-Runde 1, Punkt 1) — `emit()`
      // faengt Listener-Fehler zwar bereits selbst (core/sync/events.ts), aber ein Aufruf
      // INNERHALB dieses try haette einen werfenden Listener sonst als Exec-Fehler DIESES
      // Plans gezaehlt, obwohl `executor.execute(plan)` erfolgreich war.
      const execErrors: { path: string; message: string }[] = [];
      for (const plan of applyResult.plans) {
        try {
          await this.deps.executor.execute(plan);
        } catch (e) {
          execErrors.push({ path: plan.path, message: errorMessage(e) });
          continue;
        }
        this.deps.events?.emit("changed", { path: plan.path, op: plan.op, uid: plan.uid });
      }
      const errorStr = errorStringOf(applyResult.errors, execErrors);
      const runOk = applyResult.errors.length === 0 && execErrors.length === 0;
      const runInfo: RunInfo = { at: now.toISOString(), ok: runOk, counts: applyResult.counts, ...(errorStr ? { error: errorStr } : {}) };
      const newState: CollectionState = withRun(applyResult.state, runInfo);
      await this.deps.stateStore.save(newState);

      const newSettings: PluginSettings = {
        ...settings,
        collections: settings.collections.map((c) =>
          c.id === col.id ? { ...c, ...(delta.snapshot.ctag ? { ctag: delta.snapshot.ctag } : {}), ...(delta.snapshot.syncToken ? { syncToken: delta.snapshot.syncToken } : {}) } : c,
        ),
      };
      await this.deps.saveSettings(newSettings);

      if (errorStr && errorStr !== state.lastRun?.error) this.deps.notify.warn(`${col.displayName}: ${errorStr}`);

      this.deps.events?.emit("synced", { collectionId: col.id, counts: applyResult.counts });
      return { collectionId: col.id, ok: runOk, dryRun: false, plans: applyResult.plans, counts: applyResult.counts, handEdited, strategy: delta.strategy, ...(errorStr ? { error: errorStr } : {}) };
    } catch (e) {
      const message = errorMessage(e);
      const isNew = message !== state.lastRun?.error;
      if (!dryRun) {
        const runInfo: RunInfo = { at: this.deps.now().toISOString(), ok: false, error: message, counts: zeroCounts() };
        await this.deps.stateStore.save(withRun(state, runInfo));
      }
      if (isNew) this.deps.notify.warn(`${col.displayName}: ${message}`);
      this.deps.events?.emit("synced", { collectionId: col.id, counts: zeroCounts() });
      return { collectionId: col.id, ok: false, dryRun, plans: [], counts: zeroCounts(), handEdited: [], error: message };
    }
  }
}
