import type { App } from "obsidian";
import type { CommandContext, CommandTarget } from "../core/commands/types";
import type { MappingProfile } from "../core/mirror/profile";
import type { Account, CollectionConfig, PluginSettings } from "../core/settings";
import { buildAttendeeIndex } from "./plugin-host";

export interface CommandContextInput {
  app: App;
  settings: PluginSettings;
  now: Date;
  profile: MappingProfile;
  collection: CollectionConfig;
  account: Account;
  target: CommandTarget;
  raw?: string;
  etag?: string;
  history?: CommandContext["history"];
}

/**
 * Baut den `CommandContext` aus bereits aufgeloestem Profil/Sammlung/Konto/Ziel — der
 * letzte, geteilte Schritt zwischen `CommandFlow` (Ziel aus Notiz-Frontmatter) und der
 * Plugin-API (Ziel aus `uid`+`source`, `src/obsidian/api.ts`): beide loesen ihr Ziel
 * UNTERSCHIEDLICH auf, bauen den Kontext danach aber IDENTISCH — inklusive des
 * `resolveContact`-Attendee-Index. Fix-Runde 1, Punkt 6: reine Extraktion (keine
 * Verhaltensaenderung); `history` wird hier miterfasst, weil `undo.last` (Punkt 0) ihn
 * braucht und beide Aufrufer ohnehin schon das volle `ObjectState` in der Hand haben.
 */
export function buildCommandContext(input: CommandContextInput): CommandContext {
  const { app, settings, now, profile, collection, account, target, raw, etag, history } = input;
  return {
    now,
    rand: Math.random,
    profile,
    collection,
    account,
    target,
    ...(raw !== undefined ? { raw } : {}),
    ...(etag !== undefined ? { etag } : {}),
    ...(history !== undefined ? { history } : {}),
    ...(account.scheduling ? { scheduling: account.scheduling } : {}),
    resolveContact: buildAttendeeIndex(app, settings),
  };
}
