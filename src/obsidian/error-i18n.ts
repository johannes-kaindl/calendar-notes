import { codedErrorText } from "../vendor/code-kit/coded-error";
import { t } from "../i18n/strings";

/** Text eines Fehlers fuer den Nutzer: ein Fehler mit Code (`CoreError`, `DavError` mit Code) wird
 *  uebersetzt, jeder andere bleibt bei seiner Meldung; fehlt zu einem Code die Uebersetzung, steht die
 *  englische Meldung statt des Schluessels. Einziger Ort, an dem `core.error.<code>` gelesen wird, der
 *  Mechanismus liegt in code-kit `coded-error`; `src/core/**` bleibt i18n-frei (Muster wie `describeExecuteError`). */
export function describeError(e: unknown): string {
  return codedErrorText(e, t, "core.error.");
}
