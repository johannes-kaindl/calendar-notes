import type { App } from "obsidian";
import type { SecretStore } from "../core/sync/types";

export type { SecretStore };

/** Entfernt fuehrende/abschliessende CR/LF — der typische Clipboard-Rest, wenn ein
 *  Passwort per `pbcopy < datei` aus einer Datei mit Zeilenumbruch kopiert wurde.
 *  Absichtlich kein voller `trim()`: ein Leerzeichen im Passwort bleibt gueltig,
 *  nur Zeilenumbrueche sind nie Teil eines DAV-Passworts. */
function stripCrLf(value: string): string {
  return value.replace(/^[\r\n]+/, "").replace(/[\r\n]+$/, "");
}

/** In-Memory-Fallback fuer Tests und fuer eine Obsidian-Version ohne `secretStorage`. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  get(id: string): string | null {
    return this.values.get(id) ?? null;
  }

  set(id: string, value: string): void {
    this.values.set(id, stripCrLf(value));
  }

  has(id: string): boolean {
    return (this.values.get(id) ?? "") !== "";
  }
}

/** SecretStore ueber `app.secretStorage` (Obsidian-Schluesselbund, seit 1.11.4).
 *  `set` liest nach dem Schreiben zurueck (TaskNotes-Kniff) — ein `setSecret`, das
 *  den Wert stillschweigend verwirft (z. B. Plattform ohne Keychain-Zugriff), soll
 *  hier auffallen statt erst beim naechsten Sync mit einem falschen Passwort. */
export function obsidianSecretStore(app: App): SecretStore {
  return {
    get(id: string): string | null {
      return app.secretStorage.getSecret(id);
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
  };
}
