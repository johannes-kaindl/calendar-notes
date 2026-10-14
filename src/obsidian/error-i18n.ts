import { coreErrorOf } from "../core/errors";
import { t } from "../i18n/strings";

/** Text eines Fehlers fuer den Nutzer: ein Fehler mit Code (`CoreError`, `DavError` mit Code) wird
 *  uebersetzt, jeder andere bleibt bei seiner Meldung. Einziger Ort, an dem `core.error.<code>`
 *  gelesen wird — `src/core/**` bleibt i18n-frei (Muster wie `describeExecuteError`). */
export function describeError(e: unknown): string {
  const coded = coreErrorOf(e);
  if (coded) return t(`core.error.${coded.code}`, ...coded.args);
  return e instanceof Error ? e.message : String(e);
}
