/**
 * Fehler des Kerns mit maschinenlesbarem Code. `src/core/**` bleibt i18n-frei: `message` ist
 * der englische Rückfall (Log, Tests, alles, was keinen Übersetzer hat), `code` + `args` sind
 * der Vertrag mit der Obsidian-Schicht, die daraus `core.error.<code>` übersetzt
 * (`describeError`, `src/obsidian/error-i18n.ts`). Muster wie `ExecuteErrorCode`.
 */
export const CORE_ERROR_CODES = [
  "collectionNotFound", "accountNotFound", "profileNotFound", "noSecret",
  "notVcalendar", "notVcard", "notVevent", "notVtodo", "invalidIsoDate",
  "undoNoVevent", "undoNoHistory",
  "noRaw", "noVeventAfter", "noVtodo", "noVtodoAfter", "noVevent",
  "indexOutOfRange", "indexNotNew", "fieldMissing",
  "ownAddressUnknown", "ownAddressNotAttendee", "createNeedsTitleStart", "createNoVevent",
  "timeRangeUtc", "notMultistatus", "accessDenied", "noCollectionInResponse",
] as const;
export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number];

export type CoreErrorArg = string | number;

export class CoreError extends Error {
  constructor(public readonly code: CoreErrorCode, message: string, public readonly args: readonly CoreErrorArg[] = []) {
    super(message);
    this.name = "CoreError";
  }
}

/** Duck-Typing statt `instanceof`: auch `DavError` trägt einen Code, ohne von `CoreError` zu erben. */
export function coreErrorOf(e: unknown): { code: CoreErrorCode; args: readonly CoreErrorArg[] } | undefined {
  if (!(e instanceof Error)) return undefined;
  const c = e as Error & { code?: unknown; args?: unknown };
  if (typeof c.code !== "string" || !Array.isArray(c.args)) return undefined;
  return { code: c.code as CoreErrorCode, args: c.args as readonly CoreErrorArg[] };
}
