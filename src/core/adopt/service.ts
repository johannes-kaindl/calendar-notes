import type { DavCollection, Transport } from "../dav/types";
import { refreshCollection } from "../dav/refresh";
import { syncCollection } from "../dav/sync";
import { parseContact } from "../vcard/contact";
import { parseEvents, primaryEvent } from "../ical/event";
import type { MappingProfile } from "../mirror/profile";
import { effectiveProfile, sourceOf, type Account, type CollectionConfig, type PluginSettings } from "../settings";
import type { SecretStore, StateStore } from "../sync/types";
import type { ServerItem } from "./match";

/** Strukturelle Teilmenge von `SyncDeps` (core/sync/types.ts) — jede `SyncDeps`-Instanz
 *  erfuellt dieses Interface automatisch, main.ts kann `this.deps` also direkt uebergeben,
 *  ohne einen zweiten Deps-Bau. */
export interface AdoptDeps {
  transportFor(account: Account, password: string): Transport;
  secrets: SecretStore;
  stateStore: StateStore;
  now(): Date;
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

/** Baut aus dem rohen DAV-Objekt ein `ServerItem` — Kontakte 1:1, Termine nur der Master
 *  (`primaryEvent`, kein `recurrenceId`): Adoption verknuepft nur mit der Serien-Notiz,
 *  s. Kommentar in `plan.ts`. Ein Objekt, das nicht parst oder (bei Terminen) keinen
 *  Master enthaelt, wird uebersprungen statt den ganzen Ladevorgang abzubrechen — dieselbe
 *  Toleranz wie bei `applyDelta` (dort landet es als Fehler im Ergebnis, hier ist die
 *  Adoption ein rein optionaler Zusatzschritt ohne eigenen Fehlerkanal). */
function itemFrom(col: CollectionConfig, href: string, etag: string, raw: string): ServerItem | undefined {
  try {
    if (col.kind === "addressbook") {
      const data = parseContact(raw);
      return { uid: data.uid, href, kind: "contact", data, raw, etag };
    }
    const data = primaryEvent(parseEvents(raw));
    return data ? { uid: data.uid, href, kind: "event", data, raw, etag } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Laedt ALLE Objekte einer Sammlung fuer die Adoption — bewusst OHNE Zeitfenster (Adoption
 * soll auch weit zurueckliegende/zukuenftige Termine sehen) und mit `prev: undefined`
 * (erzwingt einen Vollabgleich ueber `syncCollection`, unabhaengig vom gespeicherten
 * Sync-Zustand — der laufende Mirror-Sync bleibt unberuehrt).
 */
export async function loadServerItems(
  deps: AdoptDeps,
  settings: PluginSettings,
  collectionId: string,
): Promise<{ items: ServerItem[]; profile: MappingProfile; source: string; col: DavCollection }> {
  const colConfig = settings.collections.find((c) => c.id === collectionId);
  if (!colConfig) throw new Error(`Sammlung nicht gefunden: ${collectionId}`);
  const account = settings.accounts.find((a) => a.id === colConfig.accountId);
  if (!account) throw new Error(`Konto nicht gefunden: ${colConfig.accountId}`);
  const profile = effectiveProfile(settings, colConfig);
  if (!profile) throw new Error(`Profil nicht gefunden fuer Sammlung: ${collectionId}`);
  const secret = deps.secrets.get(account.secretId);
  if (secret === null || secret === "") throw new Error(`Kein Passwort fuer Konto hinterlegt: ${account.name}`);

  const transport = deps.transportFor(account, secret);
  const fresh = await refreshCollection(transport, baseCollectionOf(colConfig));
  const source = sourceOf(colConfig);
  const delta = await syncCollection(transport, fresh, undefined, { batchSize: settings.sync.batchSize });

  const items: ServerItem[] = [];
  for (const obj of delta.changed) {
    const item = itemFrom(colConfig, obj.href, obj.etag, obj.data);
    if (item) items.push(item);
  }
  return { items, profile, source, col: fresh };
}
