import type { MappingProfile } from "./profile";
import { statusValue, priorityValue } from "./todo-values";

export type VtodoStatus = "NEEDS-ACTION" | "IN-PROCESS" | "COMPLETED" | "CANCELLED";

/** Reihenfolge ist die Vorrangregel bei Kollision: der erste Treffer gewinnt. COMPLETED steht
 *  vor CANCELLED, weil Abhaken der Normalfall und Abbrechen die bewusste Ausnahme ist. */
const KANDIDATEN: readonly VtodoStatus[] = ["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"];

/** RFC 5545 3.8.1.9 — Repraesentanten je Klasse. Nur bei echtem Wechsel gesetzt; ein bereits
 *  passender Zahlenwert bleibt unangetastet (sonst springt eine 2 grundlos auf die 1). */
const REPRAESENTANT = { high: 1, normal: 5, low: 9 } as const;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Frontmatter-Statuswert → VTODO-Zustand, **bewahrend**.
 *
 * Die Abbildung ist rueckwaerts nicht eindeutig: `statusMap` darf zwei VTODO-Zustaende auf
 * denselben Frontmatter-Wert legen, und das mitgelieferte Default-Profil TUT das
 * (`completed` und `cancelled` beide auf `"done"`, s. `profile.ts`). Deshalb wird nicht
 * umgekehrt, sondern gefragt: **hat sich ueberhaupt etwas geaendert?** Passt der neue Wert
 * weiter zum alten Serverzustand, bleibt dieser stehen und es wird nichts geschrieben.
 *
 * Ohne diese Regel wuerde jede abgebrochene Aufgabe beim ersten Rueckschreiben zu einer
 * erledigten umgedeutet — ohne dass jemand etwas getan haette.
 *
 * `undefined` = kein Schreibvorgang (entweder unveraendert oder nicht abbildbar).
 */
export function reverseStatus(p: MappingProfile, alt: string | undefined, neu: unknown): VtodoStatus | undefined {
  if (!p.statusMap) return undefined;
  const ziel = str(neu);
  if (ziel === undefined) return undefined;
  // 1. Bewahren: der alte Zustand bildet weiterhin auf den neuen Wert ab.
  if (statusValue(p, alt) === ziel) return undefined;
  // 2. Echter Wechsel: den ersten Kandidaten nehmen, der auf den Zielwert abbildet.
  return KANDIDATEN.find((k) => statusValue(p, k) === ziel);
}

/**
 * Frontmatter-Prioritaetswert → VTODO-Prioritaet, **bewahrend** (gleiche Begruendung wie
 * `reverseStatus`: `1–4` fallen alle auf `high`, ein passender Wert darf nicht springen).
 *
 * `undefined` = kein Schreibvorgang · `null` = Property entfernen.
 */
export function reversePriority(p: MappingProfile, alt: number | undefined, neu: unknown): number | null | undefined {
  if (!p.priorityMap) return undefined;
  const ziel = str(neu);
  // 1. Bewahren.
  if (priorityValue(p, alt) === ziel) return undefined;
  // 2. Kein Zielwert oder einer ausserhalb der Abbildung → keine Prioritaet mehr.
  if (ziel === undefined) return alt === undefined ? undefined : null;
  const map = p.priorityMap;
  const klasse = (Object.keys(REPRAESENTANT) as (keyof typeof REPRAESENTANT)[])
    .find((k) => map[k] === ziel);
  if (!klasse) return alt === undefined ? undefined : null;
  return REPRAESENTANT[klasse];
}
