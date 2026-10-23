---
paths:
  - "src/core/commands/**"
  - "src/core/api/**"
  - "src/core/sync/execute.ts"
  - "src/main.ts"
  - "src/obsidian/api.ts"
  - "src/obsidian/plugin-host.ts"
  - "src/obsidian/command-*.ts"
  - "src/obsidian/invite.ts"
  - "src/obsidian/plan-preview-modal.ts"
  - "docs/API.md"
---

# Kommandos, Einladungen und Plugin-API — Gotchas

Aufbau: `docs/internal/architecture.md`; Vertrag nach außen: `docs/API.md`.

- **Kommandos tragen Übersetzungs-Schlüssel, aufgelöst wird erst in der Obsidian-Schicht.** `CommandDescriptor.titleKey`/`.descriptionKey`, `CommandPlan.summaryKey`/`summaryArgs` sind Pflichtfelder; `title`/`description`/`summary` bleiben englischer Fallback. `src/core/commands/**` bleibt obsidian- und i18n-frei (kein `t()`-Import), die Übersetzung passiert in `command-flow.ts`, `plan-preview-modal.ts` und `api.ts`; ein Registry-Test prüft DE/EN-Vollständigkeit jedes Keys.
- **`api.commands()` und `api.tools()` geben `title`/`description`/Schema-`description` unverändert an Fremdplugins und LLM-Tool-Definitionen weiter.** Ein Wechsel von fertigem Text auf `*Key`-Felder ist deshalb eine BRECHENDE Änderung des Plugin-API-Vertrags (`CALENDAR_NOTES_API_VERSION` müsste steigen, s. `docs/API.md`), nicht nur ein internes Refactoring.
- **Registry-Bootstrap:** `ensureDefaultCommands()` (`src/core/commands/registry.ts`, idempotent) wird in `main.ts::onload()` VOR `CommandFlow`/`createPluginApi` aufgerufen und defensiv nochmal in `createPluginApi` selbst. Ohne das blieb `commandRegistry()` zur Laufzeit leer (GUI-Smoke Lauf 3). Live per zweimaligem `disablePlugin`/`enablePlugin` bestätigt: `commands().length` bleibt stabil, kein „Doppelte Kommando-ID“-Wurf.
- **`undo.last` ist ein regulärer `commandRegistry()`-Eintrag mit `kind: "any"`** — wirkt auf Termine UND Kontakte, `appliesTo` prüft nur `ctx.history?.length`.
- **Ausführung (`executeCommandPlan`):** `PUT` mit `If-Match: <etag>` (create: `If-None-Match`); 412 → `{ conflict: true, freshEtag? }` (die UI bietet „Mit frischem Stand erneut“); nach Erfolg gezielter `resyncObject(collectionId, href)` — GET des einzelnen Objekts, `applyDelta` mit synthetischem Delta, Notiz-Plan ausführen, State speichern. `executeCommandPlans` führt mehrere Pläne unter **einem** Busy-Guard aus.
- **Einladungs-Weg (`InviteRouter.route`):** Server-Scheduling (`account.scheduling.outbox`, per `discoverScheduling`) → registrierter Mail-Transport → `.ics`-Fallback (Textmodal mit Kopieren/Speichern). `src/core/commands/imip.ts` baut die iMIP-Nachricht (`METHOD:REQUEST`/`CANCEL`) — Vertrag mit mailstone, **eigenständige Kopie der Typen** (kein Import über `src/core/**`, PROF-OBS-09).
- **Die Plugin-API (`createPluginApi`) macht zweistufig `plan()`/`execute()` und öffnet nie ein Modal** — die Bestätigung liegt beim Aufrufer. `events()`/`contacts()`/`get()` lesen aus dem State, nie live vom Server; `toolDefinitions()` ersetzt `.`→`_` in den Namen; jede Methode fängt selbst und liefert `{ error }`. Zugriff `app.plugins.plugins["calendar-notes"].api` mit `version: 1`, Ereignisse `on("synced"|"changed")` und `registerMailTransport` stehen in `docs/API.md`. Zweites Exemplar des Anbieter-Musters aus `vault-rag/src/plugin_api.ts` im Dach (Registry-Kandidat, Zeile in `../REGISTRY.md`).
