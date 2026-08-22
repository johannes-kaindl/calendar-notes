import type { ExecuteErrorCode } from "../core/sync/execute";
import { t } from "../i18n/strings";

/** Uebersetzt die neutralen `ExecuteErrorCode`s aus `core/sync/execute.ts` (core bleibt
 *  i18n-frei) — einziger Ort, an dem `execute.error.<code>` gelesen wird. */
export function describeExecuteError(code: ExecuteErrorCode): string {
  return t(`execute.error.${code}`);
}
