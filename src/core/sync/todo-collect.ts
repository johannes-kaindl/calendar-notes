import type { FmVal } from "../mirror/profile";
import { fmEquals } from "../mirror/hash";

export interface TodoNoteState {
  path: string;
  frontmatter: Record<string, unknown>;
  /** Was der Spiegel zuletzt selbst geschrieben hat — die Vergleichsbasis fuer Handaenderungen. */
  prevWritten: Record<string, FmVal>;
  /** Fehlt = im Vault entstanden, noch nie auf dem Server. */
  uid?: string;
  /** href-PFAD, nicht die volle URL — s. `classifyTodos`. */
  href?: string;
  /** Der zuletzt gesehene Serverstand. Grundlage des Konflikt-Vergleichs. */
  etag?: string;
  collectionId?: string;
}

export type TodoGroup = "vault-only" | "new" | "conflict";

export interface ClassifiedTodo {
  note: TodoNoteState;
  group: TodoGroup;
  /** Nur belegt, wenn der Server die Ressource fuehrt: ihr aktuelles ETag. */
  serverEtag?: string;
  changedKeys: string[];
}

/** Wie `handEditedKeys` in push-hand-edits, aber ueber eine Menge statt eine Notiz. */
function changedKeys(fm: Record<string, unknown>, prev: Record<string, FmVal>): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(prev)) if (!fmEquals(fm[k], v)) keys.push(k);
  return keys;
}

/**
 * Ordnet jede Notiz genau einer Gruppe zu — oder gar keiner.
 *
 * ⚠️ **Schluessel-Vertrag:** `serverEtags` ist auf **href-Pfade** verschluesselt, nicht auf
 * volle URLs — so liefert es `listEtags` (`../dav/sync.ts`, dort
 * `etags[hrefPath(resolveHref(col.href, r.href))]`). `TodoNoteState.href` muss derselben
 * Normalisierung folgen; herzustellen ist sie beim Aufrufer, nicht hier. Wer volle URLs
 * hineingibt, bekommt lauter Konflikte, weil kein Schluessel trifft — und zwar ohne
 * Fehlermeldung, weil „kein Eintrag" ein regulaerer Fall ist.
 *
 * **Weggelassen wird, was hier nichts zu suchen hat:** unveraenderte Notizen und solche, die
 * sich NUR serverseitig bewegt haben. Letztere sind kein Fall fuer dieses Kommando, sondern
 * fuer den normalen Sync — sie hier zu zeigen hiesse, dem Nutzer eine Entscheidung
 * vorzulegen, die er nicht treffen muss.
 */
export function classifyTodos(notes: TodoNoteState[], serverEtags: Map<string, string>): ClassifiedTodo[] {
  const out: ClassifiedTodo[] = [];
  for (const note of notes) {
    const keys = changedKeys(note.frontmatter, note.prevWritten);
    if (note.uid === undefined) {
      out.push({ note, group: "new", changedKeys: keys });
      continue;
    }
    if (keys.length === 0) continue; // im Vault unveraendert — nicht unser Fall
    const serverEtag = note.href ? serverEtags.get(note.href) : undefined;
    if (serverEtag !== undefined && serverEtag === note.etag) {
      out.push({ note, group: "vault-only", changedKeys: keys });
    } else {
      // Abweichendes ODER fehlendes Server-ETag: beide Seiten sind auseinander. Ein fehlender
      // Eintrag heisst nicht „unveraendert", sondern „der Server fuehrt sie nicht (mehr)" —
      // geloescht, verschoben oder ausserhalb des Fensters. Stillschweigend hochladen waere
      // die falsche Annahme; der Nutzer bekommt sie vorgelegt.
      out.push({ note, group: "conflict", ...(serverEtag !== undefined ? { serverEtag } : {}), changedKeys: keys });
    }
  }
  return out;
}
