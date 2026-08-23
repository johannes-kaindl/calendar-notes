import { effectiveProfile, sourceOf, type PluginSettings } from "../settings";

/**
 * Aus dem Frontmatter einer Notiz erkanntes Kommando-Ziel — noch OHNE `href`/`raw`/`etag`,
 * weil die reines Frontmatter das nicht kennt. Der volle `CommandTarget` (types.ts) entsteht
 * erst danach aus dem Collection-State (s. `command-flow.ts`): dort wird per `uid` (und
 * `notes[rid].path` als Gegenprobe) das passende `ObjectState` gesucht und daraus `href` per
 * `resolveHref(collection.href, hp)` rekonstruiert.
 */
export interface FrontmatterTarget {
  kind: "event" | "contact";
  source: string;
  uid: string;
  collectionId: string;
  recurrenceId?: string;
}

/**
 * Prüft das Frontmatter einer Notiz gegen jede AKTIVIERTE Sammlung mit ihrem wirksamen Profil
 * (`effectiveProfile`, inkl. Ordner-Override) — die erste Sammlung, deren `sourceField` den
 * Sammlungs-`source` trägt UND deren `uidField` einen nicht-leeren String enthält, gewinnt.
 * Pure — kein Obsidian-/Netzwerk-Zugriff, damit sie ohne Modal/App getestet werden kann.
 */
export function targetFromFrontmatter(settings: PluginSettings, frontmatter: Record<string, unknown>): FrontmatterTarget | undefined {
  for (const col of settings.collections) {
    if (!col.enabled) continue;
    const profile = effectiveProfile(settings, col);
    if (!profile) continue;
    const source = sourceOf(col);
    if (frontmatter[profile.sourceField] !== source) continue;
    const uid = frontmatter[profile.uidField];
    if (typeof uid !== "string" || uid === "") continue;
    const recurrenceRaw = frontmatter[profile.recurrenceIdField];
    const recurrenceId = typeof recurrenceRaw === "string" && recurrenceRaw !== "" ? recurrenceRaw : undefined;
    return { kind: profile.kind, source, uid, collectionId: col.id, ...(recurrenceId ? { recurrenceId } : {}) };
  }
  return undefined;
}
