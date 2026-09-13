// vendored from obsidian-kit@0.35.0, src/obsidian/secrets.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import type { App } from "obsidian";
import { stripCrLf, type SecretStore } from "../kit/secrets";

/** Form-Prüfung statt Versionsprüfung (Muster anysource-sideloader `src/main.ts`): ob der
 *  Schlüsselbund da ist, sagt die API selbst — eine Versionsnummer sagt nur, ab wann er
 *  da sein sollte. */
export function secretStorageAvailable(app: App): boolean {
  const s = (app as { secretStorage?: unknown }).secretStorage as
    | { getSecret?: unknown; setSecret?: unknown }
    | undefined;
  return typeof s?.getSecret === "function" && typeof s?.setSecret === "function";
}

/** SecretStore über `app.secretStorage` (Obsidian-Schlüsselbund, seit 1.11.4).
 *  `set` liest nach dem Schreiben zurück (TaskNotes-Kniff) — ein `setSecret`, das den Wert
 *  stillschweigend verwirft (Plattform ohne Keychain-Zugriff), soll hier auffallen statt erst
 *  beim nächsten Aufruf mit einem falschen Token. `delete` schreibt den Leerstring: die
 *  Obsidian-API hat keinen Löschaufruf, und `has` behandelt leer als „nicht vorhanden". */
export function obsidianSecretStore(app: App): SecretStore {
  return {
    get(id: string): string | null {
      const v = app.secretStorage.getSecret(id);
      return v === "" ? null : v;
    },
    set(id: string, value: string): void {
      const sanitized = stripCrLf(value);
      app.secretStorage.setSecret(id, sanitized);
      if (app.secretStorage.getSecret(id) !== sanitized) {
        throw new Error(`Obsidian SecretStorage did not persist ${id}`);
      }
    },
    has(id: string): boolean {
      const v = app.secretStorage.getSecret(id);
      return v !== null && v !== "";
    },
    delete(id: string): void {
      app.secretStorage.setSecret(id, "");
    },
  };
}
