/**
 * Fehler des Kerns mit maschinenlesbarem Code. `src/core/**` bleibt i18n-frei: `message` ist
 * der englische Rückfall (Log, Tests, alles, was keinen Übersetzer hat), `code` + `args` sind
 * der Vertrag mit der Obsidian-Schicht, die daraus `core.error.<code>` übersetzt
 * (`describeError`, `src/obsidian/error-i18n.ts`). Muster wie `ExecuteErrorCode`.
 */
import { CodedError, type CodedErrorArg } from "../vendor/code-kit/coded-error";

export const CORE_ERROR_CODES = [
  "collectionNotFound", "accountNotFound", "profileNotFound", "noSecret",
  "notVcalendar", "notVcard", "notVevent", "notVtodo", "invalidIsoDate",
  "undoNoVevent", "undoNoHistory",
  "noRaw", "noVeventAfter", "noVtodo", "noVtodoAfter", "noVevent",
  "indexOutOfRange", "indexNotNew", "fieldMissing",
  "ownAddressUnknown", "ownAddressNotAttendee", "createNeedsTitleStart", "createNoVevent",
  "alarmInvalid", "noteAlreadyBound", "noteNotFound",
  "timeRangeUtc", "notMultistatus", "accessDenied", "noCollectionInResponse",
] as const;
export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number];

export type CoreErrorArg = CodedErrorArg;

export class CoreError extends CodedError<CoreErrorCode> {
  constructor(code: CoreErrorCode, message: string, args: readonly CoreErrorArg[] = []) {
    super(code, message, args);
    this.name = "CoreError";
  }
}
