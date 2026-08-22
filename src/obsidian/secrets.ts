import type { App } from "obsidian";

export interface SecretStore {
  get(id: string): string | null;
  set(id: string, value: string): void; // wirft, wenn Ruecklesen fehlschlaegt
  has(id: string): boolean;
}

/** In-Memory-Fallback fuer Tests und fuer eine Obsidian-Version ohne `secretStorage`. */
export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  get(id: string): string | null {
    return this.values.get(id) ?? null;
  }

  set(id: string, value: string): void {
    this.values.set(id, value);
  }

  has(id: string): boolean {
    return this.values.has(id);
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
      app.secretStorage.setSecret(id, value);
      if (app.secretStorage.getSecret(id) !== value) {
        throw new Error(`Obsidian SecretStorage did not persist ${id}`);
      }
    },
    has(id: string): boolean {
      return app.secretStorage.getSecret(id) !== null;
    },
  };
}
