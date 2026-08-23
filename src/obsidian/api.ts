import type { App } from "obsidian";
import { collectContacts, collectEvents, findByUid, type CollectionStateEntry } from "../core/api/read";
import {
  CALENDAR_NOTES_API_VERSION,
  type ApiContact,
  type ApiError,
  type ApiEvent,
  type ApiExecuteResult,
  type ApiPlan,
  type ApiTargetRef,
  type CalendarNotesApi,
  type ContactsQuery,
  type EventsQuery,
} from "../core/api/types";
import { buildImip } from "../core/commands/imip";
import { ensureDefaultCommands, commandRegistry, findCommand, toolDefinitions } from "../core/commands/registry";
import { validateInput } from "../core/commands/schema";
import type { CommandContext, CommandPlan, CommandTarget } from "../core/commands/types";
import { resolveHref } from "../core/dav/url";
import { effectiveProfile, sourceOf, type Account, type PluginSettings } from "../core/settings";
import { executeCommandPlan } from "../core/sync/execute";
import type { SyncEvents } from "../core/sync/events";
import type { SyncDeps } from "../core/sync/types";
import { buildCommandContext } from "./command-context";
import { isMailTransport, type MailTransportRegistry } from "./plugin-host";
import { imipLabels, type InviteRouter } from "./invite";

/** Was `createPluginApi` braucht — main.ts baut das aus den bereits vorhandenen
 *  Plugin-Feldern (`deps`, `inviteRouter`, `mailTransports`) zusammen, s. `src/main.ts`. */
export interface PluginApiHost {
  app: App;
  deps: SyncDeps;
  inviteRouter: InviteRouter;
  mailTransports: MailTransportRegistry;
}

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Fix M8 (Review-Runde 3): ueberspringt DEAKTIVIERTE Sammlungen — deren State wird seit dem
 *  Deaktivieren nicht mehr synchronisiert und kann veraltet sein; `events()`/`contacts()`/
 *  `get()` sollen keinen stillen, potenziell stalen Stand ausliefern. Dokumentiert in
 *  `docs/API.md`. */
async function loadStates(deps: SyncDeps, settings: PluginSettings): Promise<CollectionStateEntry[]> {
  const entries: CollectionStateEntry[] = [];
  for (const collection of settings.collections) {
    if (!collection.enabled) continue;
    const state = await deps.stateStore.load(sourceOf(collection));
    entries.push({ collection, state });
  }
  return entries;
}

/**
 * Baut die Plugin-API v1 (`app.plugins.plugins["calendar-notes"].api`, Task 7, Spec §5b)
 * nach dem Anbieter-Muster `vault-rag/src/plugin_api.ts`: duenner Adapter ueber vorhandene
 * `core/**`-Funktionen und die bereits verdrahteten Obsidian-Objekte (`deps`, `inviteRouter`,
 * `mailTransports`) — kein eigener Zustand, jeder Aufruf liest frisch. Die API oeffnet NIE
 * ein Modal (Bestaetigung liegt beim Aufrufer) und jede Methode faengt selbst: ein
 * Fremdplugin bekommt `{ error }` zurueck statt eines Wurfs mitten in seinem eigenen Lauf.
 */
export function createPluginApi(host: PluginApiHost): CalendarNotesApi {
  const { app, deps, inviteRouter, mailTransports } = host;
  // Fix-Runde 1, Punkt 0: defensiv HIER ebenfalls aufrufen (idempotent) — `main.ts` ruft es
  // schon vor `createPluginApi(...)` auf, aber die API soll auch funktionieren, wenn sie
  // (z. B. in einem Test) ohne diesen Aufruf konstruiert wird. Kein Risiko fuer bereits von
  // main.ts oder einem Test registrierte Deskriptoren — `ensureDefaultCommands()` ergaenzt
  // nur, was unter derselben id noch fehlt.
  ensureDefaultCommands();

  async function accountFor(collectionSource: string): Promise<{ account: Account; settings: PluginSettings } | undefined> {
    const settings = deps.settings();
    const collection = settings.collections.find((c) => sourceOf(c) === collectionSource);
    if (!collection) return undefined;
    const account = settings.accounts.find((a) => a.id === collection.accountId);
    return account ? { account, settings } : undefined;
  }

  async function resolveCreateTarget(collectionId: string): Promise<{ ctx: CommandContext } | ApiError> {
    const settings = deps.settings();
    const collection = settings.collections.find((c) => c.id === collectionId);
    if (!collection) return { error: "collection-not-found" };
    // Fix M8 (Review-Runde 3): eine deaktivierte Sammlung ist fuer Schreibvorgaenge kein
    // gueltiges Ziel — s. `loadStates()` oben (Lesen) und `docs/API.md`.
    if (!collection.enabled) return { error: "collection-disabled" };
    const profile = effectiveProfile(settings, collection);
    const account = settings.accounts.find((a) => a.id === collection.accountId);
    if (!profile || !account) return { error: "profile-not-found" };
    const target: CommandTarget = { kind: profile.kind, source: sourceOf(collection), new: true };
    const ctx = buildCommandContext({ app, settings, now: deps.now(), profile, collection, account, target });
    return { ctx };
  }

  async function resolveExistingTarget(uid: string, source: string): Promise<{ ctx: CommandContext } | ApiError> {
    const settings = deps.settings();
    const collection = settings.collections.find((c) => sourceOf(c) === source);
    if (!collection) return { error: "collection-not-found" };
    if (!collection.enabled) return { error: "collection-disabled" };
    const profile = effectiveProfile(settings, collection);
    const account = settings.accounts.find((a) => a.id === collection.accountId);
    if (!profile || !account) return { error: "profile-not-found" };
    const state = await deps.stateStore.load(source);
    const entry = Object.entries(state.objects).find(([, o]) => o.uid === uid);
    if (!entry) return { error: "target-not-found" };
    const [hp, obj] = entry;
    const href = resolveHref(collection.href, hp);
    const target: CommandTarget = { kind: profile.kind, source, href, uid: obj.uid };
    const ctx = buildCommandContext({ app, settings, now: deps.now(), profile, collection, account, target, raw: obj.raw, etag: obj.etag, history: obj.history });
    return { ctx };
  }

  /** Liefert, was mit einer Einladung geschah — NIE ueber `InviteRouter.deliver` (das
   *  oeffnet bei mehreren Absender-Identitaeten ein Auswahl-Modal bzw. beim `ics`-Weg das
   *  Text-Modal). Beim Transport-Weg wird die erste verfuegbare Absender-Identitaet
   *  genommen (kein Mensch da, der waehlen koennte); ohne Identitaet oder ohne
   *  registrierten Transport faellt die API auf den `ics`-Weg zurueck (fertiger Text statt
   *  eines Modals). */
  async function deliverInvite(plan: CommandPlan, account: Account): Promise<ApiExecuteResult["invite"]> {
    if (!plan.invite) return undefined;
    // M3 (Review-Runde 3): den von route() TATSAECHLICH gewaehlten Transport nutzen statt
    // `mailTransports.list()[0]` — bei mehreren registrierten Transporten waere das ein
    // anderer, falls der erste keine Identitaeten hat (den haette route() gar nicht gewaehlt).
    const { route, transport } = await inviteRouter.route(account, plan);
    const now = deps.now();
    if (route === "server") return { route };
    if (route === "transport") {
      if (transport) {
        const identities = await transport.accounts();
        const sender = identities[0];
        if (sender) {
          const msg = buildImip(plan, plan.invite.method, sender.id, { now, labels: imipLabels() });
          const res = await transport.send(msg);
          return { route, delivered: res.ok };
        }
      }
      const msg = buildImip(plan, plan.invite.method, account.id, { now, labels: imipLabels() });
      return { route: "ics", ics: msg.ics };
    }
    const msg = buildImip(plan, plan.invite.method, account.id, { now, labels: imipLabels() });
    return { route: "ics", ics: msg.ics };
  }

  /** Eine EINZELNE Implementierung fuer beide `CalendarNotesApi.on`-Ueberladungen
   *  (`synced`/`changed` haben unterschiedliche, unverwandte Payload-Typen) — TS prueft
   *  Funktions-EXPRESSIONS gegen ueberladene Ziel-Call-Signaturen strikt kontravariant je
   *  Signatur (anders als methoden-syntaktische Interface-Glieder untereinander), das
   *  scheitert hier zwangslaeufig. Der Cast am Rueckgabe-Ort ist deshalb der akkurate Weg,
   *  keine `any`-Flucht: die Fallunterscheidung selbst bleibt vollstaendig typgeprueft. */
  function on(event: "synced" | "changed", cb: (e: SyncEvents["synced"] | SyncEvents["changed"]) => void): () => void {
    if (!deps.events) return () => {};
    if (event === "synced") return deps.events.on("synced", cb);
    return deps.events.on("changed", cb);
  }

  return {
    version: CALENDAR_NOTES_API_VERSION,

    async events(q?: EventsQuery): Promise<ApiEvent[] | ApiError> {
      try {
        const settings = deps.settings();
        return collectEvents(settings, await loadStates(deps, settings), q);
      } catch (e) {
        return { error: toErrorMessage(e) };
      }
    },

    async contacts(q?: ContactsQuery): Promise<ApiContact[] | ApiError> {
      try {
        const settings = deps.settings();
        return collectContacts(settings, await loadStates(deps, settings), q);
      } catch (e) {
        return { error: toErrorMessage(e) };
      }
    },

    async get(ref: { uid: string; source?: string }): Promise<ApiEvent | ApiContact | null | ApiError> {
      try {
        const settings = deps.settings();
        return findByUid(settings, await loadStates(deps, settings), ref);
      } catch (e) {
        return { error: toErrorMessage(e) };
      }
    },

    commands() {
      return commandRegistry().map((c) => ({ id: c.id, kind: c.kind, title: c.title, description: c.description, schema: c.schema }));
    },

    tools() {
      return toolDefinitions();
    },

    async plan(commandId: string, input: Record<string, unknown>, targetRef: ApiTargetRef): Promise<ApiPlan | ApiError> {
      try {
        const descriptor = findCommand(commandId);
        if (!descriptor) return { error: "command-not-found" };
        // Fix-Runde 1, Punkt 5: Eingabe VOR der Zielaufloesung gegen das Kommando-Schema
        // pruefen — ein Fremdplugin/LLM-Tool-Call bekommt eine praezise Fehlermeldung statt
        // eines Wurfs mitten in `descriptor.plan()` oder eines stillschweigend falsch
        // interpretierten Feldes.
        const validation = validateInput(descriptor.schema, input);
        if (!validation.ok) return { error: `validation: ${validation.errors.join("; ")}` };
        const isCreate = "new" in targetRef;
        const resolved = isCreate ? await resolveCreateTarget(targetRef.collectionId) : await resolveExistingTarget(targetRef.uid, targetRef.source);
        if ("error" in resolved) return resolved;
        const { ctx } = resolved;
        if (!descriptor.appliesTo(ctx)) return { error: "command-not-applicable" };
        let plan: CommandPlan;
        try {
          plan = descriptor.plan(input, ctx);
        } catch (e) {
          return { error: toErrorMessage(e) };
        }
        const inviteRoute = plan.invite ? (await inviteRouter.route(ctx.account, plan)).route : undefined;
        return { ...plan, ...(inviteRoute ? { inviteRoute } : {}) };
      } catch (e) {
        return { error: toErrorMessage(e) };
      }
    },

    async execute(plan: ApiPlan): Promise<ApiExecuteResult | ApiError> {
      try {
        const settings = deps.settings();
        const result = await executeCommandPlan(deps, settings, plan);
        if (result.ok && plan.invite) {
          const resolved = await accountFor(plan.target.source);
          const invite = resolved ? await deliverInvite(plan, resolved.account) : undefined;
          if (invite) return { ...result, invite };
        }
        return result;
      } catch (e) {
        return { error: toErrorMessage(e) };
      }
    },

    registerMailTransport(t) {
      if (!isMailTransport(t)) return { error: "invalid-mail-transport" };
      mailTransports.register(t);
      return { ok: true };
    },

    unregisterMailTransport(id: string): void {
      mailTransports.unregister(id);
    },

    on: on as CalendarNotesApi["on"],
  };
}
