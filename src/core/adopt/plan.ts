import type { FmVal, MappingProfile } from "../mirror/profile";
import type { AdoptionSuggestion, ServerItem } from "./match";
import type { CollectionState } from "../state/collection-state";
import { upsertObject } from "../state/collection-state";
import { hrefPath } from "../dav/url";

export interface AdoptDecision {
  suggestion: AdoptionSuggestion;
  action: "link" | "skip" | "create";
}

export interface LinkPlan {
  path: string;
  set: Record<string, FmVal>;
}

/** Adoption matcht immer nur den Master (kein `recurrenceId` am ServerItem) — recurrenceIdField
 * bleibt deshalb unbesetzt; ein Override würde ihn ergänzen, sobald Adoption Overrides matcht. */
export function planAdoption(
  decisions: AdoptDecision[],
  profile: MappingProfile,
  source: string,
): { links: LinkPlan[]; createUids: string[]; skippedUids: string[] } {
  const links: LinkPlan[] = [];
  const createUids: string[] = [];
  const skippedUids: string[] = [];
  for (const d of decisions) {
    const { item, note } = d.suggestion;
    if (d.action === "link") {
      links.push({
        path: note.path,
        set: {
          [profile.uidField]: item.uid,
          [profile.sourceField]: source,
          [profile.etagField]: item.etag,
          [profile.stateField]: "live",
        },
      });
    } else if (d.action === "create") {
      createUids.push(item.uid);
    } else {
      skippedUids.push(item.uid);
    }
  }
  return { links, createUids, skippedUids };
}

/** Ordnet jedem LinkPlan das ursprüngliche ServerItem über `profile.uidField` zu und schreibt einen
 * State-Eintrag mit leerem `written`/`hash` — der erste reguläre Sync-Lauf sieht dadurch kein
 * `prevWritten` und meldet folglich keine handEdited-Kollision. */
export function stateAfterAdoption(state: CollectionState, links: LinkPlan[], items: ServerItem[], profile: MappingProfile, now: Date): CollectionState {
  const at = now.toISOString();
  let next = state;
  for (const link of links) {
    const uid = link.set[profile.uidField];
    const item = items.find((i) => i.uid === uid);
    if (!item) continue;
    next = upsertObject(next, hrefPath(item.href), { uid: item.uid, etag: item.etag, raw: item.raw, written: {}, hash: "", notePath: link.path, at });
  }
  return next;
}
