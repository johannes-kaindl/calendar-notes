---
paths:
  - "src/core/settings.ts"
  - "src/obsidian/settings-tab.ts"
  - "src/vendor/kit-obsidian/secrets.ts"
  - "src/vendor/kit/secrets.ts"
---

# Zugangsdaten — `SecretComponent` ist ein Verweis, kein Passwortfeld

- **Die Passwort-Zeile im Settings-Tab bindet nicht ein Passwort, sondern einen Schlüsselbund-Eintrag.** `setValue(id)` nimmt die Secret-ID, und `onChange` liefert die **ID** des im Dialog gewählten bzw. neu angelegten Eintrags zurück — nie dessen Wert; das X löst die Verknüpfung und ruft mit `null` zurück. Den Wert schreibt Obsidian selbst, das Plugin merkt sich nur, **welcher** Eintrag zum Konto gehört (`account.secretId`), und ruft `setSecret` im Normalbetrieb gar nicht mehr auf.
- **Bis 0.1.4 wurde der Rückgabewert als Passwort gespeichert:** jedes Konto meldete sich mit dem *Namen* seines Eintrags an und bekam von jedem Server **401** — sichtbar wurde das nicht, weil `has()` den Müllwert als „belegt“ meldete und die Zeile befüllt aussah. `repairSecretLinks()` (`src/core/settings.ts`) räumt das beim Start auf.
- **Die `.d.ts` deklariert nur `setValue(value: string)`;** der Beleg für die Semantik steht in der App-Implementierung (`~/Library/Application Support/obsidian/obsidian-<ver>.asar`; Lesson 2026-08-25 in `oneiron:LESSONS.md`).
- **Der GUI-Smoke deckt diesen Pfad ab:** Radicale läuft mit `htpasswd` (`fixtures/radicale/config`), P2a (falsches Passwort → 401) und P2b (Konto über die Oberfläche einrichten, Secret-Dialog, Discovery antwortet) fangen den 0.1.4-Fehler (gemessen 2026-08-30 mit zurückgedrehtem Fix: P2b rot, P2a und P2 grün). `seedAccount` in P2 umgeht den `onChange`-Rückruf und prüft ihn deshalb nicht (`docs/SMOKE.md`, P2b).
