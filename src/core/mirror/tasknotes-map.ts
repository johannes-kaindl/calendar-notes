import type { PriorityMap, StatusMap } from "./profile";

/** Schmaler Eingabetyp: das MINDESTE, was die Vorschlagsregel braucht. Die Uebersetzung aus der
 *  TaskNotes-API passiert in `src/obsidian/tasknotes.ts` — hier liegt nur das Urteil, damit es
 *  ohne Obsidian und ohne installiertes Fremdplugin pruefbar ist. */
export interface TnStatus { value: string; isCompleted: boolean; order: number }
export interface TnPriority { value: string; order: number }

export type MapWarning =
  | "cancelled-collides-with-completed"
  | "no-completed-status"
  | "no-open-status"
  | "single-open-status";

const byOrder = <T extends { order: number }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.order - b.order);

/**
 * Vorschlag ueber `isCompleted` + `order` — NIE ueber Namensgleichheit: TaskNotes-Status sind frei
 * konfigurierbar, Gleichheit waere Zufall und braeche beim ersten Nutzer, der umbenennt.
 */
export function suggestStatusMap(statuses: readonly TnStatus[]): { map: StatusMap; warnings: MapWarning[] } | undefined {
  const offen = byOrder(statuses.filter((s) => !s.isCompleted));
  const fertig = byOrder(statuses.filter((s) => s.isCompleted));
  if (!offen.length || !fertig.length) return undefined;

  const warnings: MapWarning[] = [];
  const needsAction = offen[0]!.value;
  const inProcess = offen[1]?.value ?? needsAction;
  if (offen.length === 1) warnings.push("single-open-status");

  const completed = fertig[0]!.value;
  const cancelled = fertig[fertig.length - 1]!.value;
  if (completed === cancelled) warnings.push("cancelled-collides-with-completed");

  return { map: { needsAction, inProcess, completed, cancelled }, warnings };
}

/** Extreme nach aussen, Mitte in die Mitte — bei genau drei Stufen ist das die naheliegende
 *  Zuordnung, bei mehr bleibt sie definiert statt zu raten. */
export function suggestPriorityMap(priorities: readonly TnPriority[]): { map: PriorityMap; warnings: MapWarning[] } | undefined {
  const sorted = byOrder(priorities);
  if (!sorted.length) return undefined;
  const low = sorted[0]!.value;
  const high = sorted[sorted.length - 1]!.value;
  const normal = sorted[Math.floor((sorted.length - 1) / 2)]!.value;
  return { map: { high, normal, low }, warnings: [] };
}
