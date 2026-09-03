// Liest die TaskNotes-Plugin-API (fremd, optional) EIN EINZIGES MAL beim Ableiten eines Profils —
// s. docs/tasknotes-api.md fuer die gemessene Form. Der Sync selbst konsultiert TaskNotes nie
// wieder (Spec § 5): das Profil ist danach ein gewoehnliches, eingefrorenes MappingProfile.
//
// Jeder Zugriff auf die Fremd-API steckt in try/catch — ein Wurf ergibt `undefined`, nie eine
// Ausnahme nach oben, denn ein Fremdplugin darf die eigenen Einstellungen nicht mitreissen.
// Gelesen wird ausschliesslich `model` und `catalog`; `api.tasks` wird an keiner Stelle
// angefasst — sobald calendar-notes eine Aufgabe anlegte oder aenderte, verwaltete es sie, und
// das besitzt TaskNotes.
import { suggestPriorityMap, suggestStatusMap, type TnDefaults, type TnPriority, type TnStatus, type MapWarning } from "../core/mirror/tasknotes-map";
import type { MappingProfile } from "../core/mirror/profile";

export interface TaskNotesReading {
  specVersion: string;
  statuses: TnStatus[];
  priorities: TnPriority[];
  identification: { method: "tag"; tag: string } | { method: "property"; propertyName: string; propertyValue: string };
  /** Serverfeld-Kandidat (catalog-Feld-`id`) → frontmatterKey, nur beschreibbare Felder mit
   *  gesetztem frontmatterKey — das Feld fehlt gemessen bei manchen Eintraegen (z. B. `archived`). */
  fieldKeys: Record<string, string>;
  /** ABWEICHUNG VOM TASK-9-BRIEF, gemessen begruendet: der Brief sah dieses Feld nicht vor, aber
   *  `config().defaults` ist gemaess Schritt 1b die einzige verlaessliche Verankerung fuer die
   *  Vorschlagsregeln — ohne sie waehlt `suggestStatusMap`/`suggestPriorityMap` den `none`-Eintrag
   *  (nicht gesetzt, kein Arbeitswert) statt eines echten Arbeitszustands. Befund schlaegt Brief. */
  defaults: TnDefaults;
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function readStatuses(raw: unknown): TnStatus[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: TnStatus[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return undefined;
    const e = entry as Record<string, unknown>;
    if (!isStr(e["value"]) || !isBool(e["isCompleted"]) || !isNum(e["order"])) return undefined;
    out.push({ value: e["value"], isCompleted: e["isCompleted"], order: e["order"] });
  }
  return out;
}

function readPriorities(raw: unknown): TnPriority[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: TnPriority[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return undefined;
    const e = entry as Record<string, unknown>;
    if (!isStr(e["value"]) || !isNum(e["weight"])) return undefined;
    out.push({ value: e["value"], weight: e["weight"] });
  }
  return out;
}

function readDefaults(raw: unknown): TnDefaults | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  if (!isStr(e["status"]) || !isStr(e["priority"])) return undefined;
  return { status: e["status"], priority: e["priority"] };
}

function readIdentification(raw: unknown): TaskNotesReading["identification"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  if (e["method"] === "tag" && isStr(e["tag"])) return { method: "tag", tag: e["tag"] };
  if (e["method"] === "property" && isStr(e["propertyName"]) && isStr(e["propertyValue"])) {
    return { method: "property", propertyName: e["propertyName"], propertyValue: e["propertyValue"] };
  }
  return undefined;
}

function readFieldKeys(raw: unknown): Record<string, string> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return undefined;
    const e = entry as Record<string, unknown>;
    const id = e["id"];
    const writable = e["writable"];
    const frontmatterKey = e["frontmatterKey"];
    if (!isStr(id) || !isBool(writable)) return undefined;
    if (!writable) continue;
    // frontmatterKey fehlt gemessen bei manchen Feldern (z. B. archived) — nicht ungeprueft lesen.
    if (isStr(frontmatterKey) && frontmatterKey.length > 0) out[id] = frontmatterKey;
  }
  return out;
}

/** Liest die TaskNotes-API einmalig. `undefined`, wenn TaskNotes fehlt, die Faehigkeit nicht
 *  gewaehrt wird, oder irgendein Feld nicht der gemessenen Form entspricht. */
export function readTaskNotes(app: unknown): TaskNotesReading | undefined {
  try {
    const a = app as { plugins?: { plugins?: Record<string, { api?: unknown }> } };
    const api = a.plugins?.plugins?.["tasknotes"]?.api as
      | { hasCapability?: (c: string) => boolean; model?: { info?: () => unknown; config?: () => unknown }; catalog?: { fields?: () => unknown } }
      | undefined;
    if (!api || typeof api.hasCapability !== "function") return undefined;
    if (!api.hasCapability("catalog.read")) return undefined;
    if (!api.model || typeof api.model.info !== "function" || typeof api.model.config !== "function") return undefined;

    const info = api.model.info() as Record<string, unknown>;
    if (!info || !isStr(info["specVersion"])) return undefined;
    const specVersion = info["specVersion"];

    const config = api.model.config() as Record<string, unknown>;
    if (!config) return undefined;
    const statuses = readStatuses(config["statuses"]);
    const priorities = readPriorities(config["priorities"]);
    const identification = readIdentification(config["taskIdentification"]);
    const defaults = readDefaults(config["defaults"]);
    if (!statuses || !priorities || !identification || !defaults) return undefined;

    if (!api.catalog || typeof api.catalog.fields !== "function") return undefined;
    const fieldKeys = readFieldKeys(api.catalog.fields());
    if (!fieldKeys) return undefined;

    return { specVersion, statuses, priorities, identification, fieldKeys, defaults };
  } catch {
    return undefined;
  }
}

/** Baut aus einer TaskNotesReading + Basisprofil ein neues, eingefrorenes MappingProfile. Gibt
 *  `base` unveraendert (bis auf id/name/specVersion) zurueck, wo die Ableitung nichts hergibt —
 *  ein halb abgeleitetes Profil waere schlechter als das Default. */
export function profileFromTaskNotes(
  reading: TaskNotesReading,
  base: MappingProfile,
  name: string,
  id: string,
): { profile: MappingProfile; warnings: MapWarning[] } {
  const warnings: MapWarning[] = [];
  let profile: MappingProfile = { ...base, id, name, taskNotesSpec: reading.specVersion };

  const statusResult = suggestStatusMap(reading.statuses, reading.defaults);
  if (statusResult) {
    profile = { ...profile, statusMap: statusResult.map };
    warnings.push(...statusResult.warnings);
  }

  const priorityResult = suggestPriorityMap(reading.priorities, reading.defaults);
  if (priorityResult) {
    profile = { ...profile, priorityMap: priorityResult.map };
    warnings.push(...priorityResult.warnings);
  }

  if (reading.identification.method === "tag") {
    profile = { ...profile, onCreate: { ...profile.onCreate, tags: [reading.identification.tag] } };
  } else {
    profile = { ...profile, onCreate: { ...profile.onCreate, [reading.identification.propertyName]: reading.identification.propertyValue } };
  }

  return { profile, warnings };
}
