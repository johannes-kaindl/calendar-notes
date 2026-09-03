import type { PriorityMap, StatusMap } from "./profile";

/** Schmaler Eingabetyp: das MINDESTE, was die Vorschlagsregel braucht. Die Uebersetzung aus der
 *  TaskNotes-API passiert in `src/obsidian/tasknotes.ts` — hier liegt nur das Urteil, damit es
 *  ohne Obsidian und ohne installiertes Fremdplugin pruefbar ist. */
export interface TnStatus { value: string; isCompleted: boolean; order: number }
export interface TnPriority { value: string; weight: number }
export interface TnDefaults { status: string; priority: string }

export type MapWarning =
  | "cancelled-collides-with-completed"
  | "single-open-status"
  | "default-status-unknown"
  | "default-priority-unknown";

const byOrder = <T extends { order: number }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.order - b.order);
const byWeight = <T extends { weight: number }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.weight - b.weight);

/**
 * Vorschlag ueber `isCompleted` + `order`, verankert an `defaults.status` — NIE ueber
 * Namensgleichheit: TaskNotes-Status sind frei konfigurierbar, Gleichheit waere Zufall und braeche
 * beim ersten Nutzer, der umbenennt. `defaults.status` ist der Wert, den TaskNotes selbst einer
 * neuen Aufgabe gibt — ohne ihn liefert „kleinste order unter den offenen" den `none`-Eintrag
 * (nicht gesetzt, kein Arbeitszustand), weil der strukturell nicht von einem echten offenen
 * Status zu unterscheiden ist.
 */
export function suggestStatusMap(statuses: readonly TnStatus[], defaults: TnDefaults): { map: StatusMap; warnings: MapWarning[] } | undefined {
  const offen = byOrder(statuses.filter((s) => !s.isCompleted));
  const fertig = byOrder(statuses.filter((s) => s.isCompleted));
  if (!offen.length || !fertig.length) return undefined;

  const warnings: MapWarning[] = [];
  const defaultOffen = offen.find((s) => s.value === defaults.status);
  const needsAction = defaultOffen ?? offen[0]!;
  if (!defaultOffen) warnings.push("default-status-unknown");

  const oberhalb = offen.filter((s) => s.order > needsAction.order);
  if (!oberhalb.length) warnings.push("single-open-status");
  const inProcess = oberhalb.length ? byOrder(oberhalb)[0]!.value : needsAction.value;

  const completed = fertig[0]!.value;
  const cancelled = fertig[fertig.length - 1]!.value;
  if (completed === cancelled) warnings.push("cancelled-collides-with-completed");

  return { map: { needsAction: needsAction.value, inProcess, completed, cancelled }, warnings };
}

/**
 * `normal` verankert an `defaults.priority`; `low`/`high` sind die naechsten Nachbarn unter/ueber
 * dem Default nach `weight`, nicht die Extremwerte — genau das ueberspringt den `none`-Eintrag
 * (der niedrigste `weight`, aber kein Arbeitswert).
 */
export function suggestPriorityMap(priorities: readonly TnPriority[], defaults: TnDefaults): { map: PriorityMap; warnings: MapWarning[] } | undefined {
  if (!priorities.length) return undefined;
  const warnings: MapWarning[] = [];
  const sorted = byWeight(priorities);
  const defaultPrio = priorities.find((p) => p.value === defaults.priority);
  const normal = defaultPrio ?? sorted[Math.floor((sorted.length - 1) / 2)]!;
  if (!defaultPrio) warnings.push("default-priority-unknown");

  const unterhalb = sorted.filter((p) => p.weight < normal.weight);
  const low = unterhalb.length ? unterhalb[unterhalb.length - 1]!.value : normal.value;

  const oberhalb = sorted.filter((p) => p.weight > normal.weight);
  const high = oberhalb.length ? oberhalb[0]!.value : normal.value;

  return { map: { high, normal: normal.value, low }, warnings };
}
