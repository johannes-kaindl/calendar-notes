# calendar-notes M4 — Kommandos 2a, Einladungs-Weg, Plugin-API v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schreiben über explizite Kommandos (Spec §5): Kommando = `{ id, schema, describe, plan, execute }` auf dem gespeicherten Server-Objekt, `PUT` mit `If-Match`, 412 → Re-Sync + erneut anbieten, danach gezielter Re-Sync des Objekts; Modals als Formulare über dasselbe JSON-Schema; Einladungs-Weg Server-Scheduling → registrierter Mail-Transport → `.ics`; „Letzte Änderung zurücknehmen" aus dem Verlauf; Plugin-API v1 (Spec §5b) mit Kommando-Schemata als LLM-Tools und `registerMailTransport`. Stufe 2b (Sidebar/Inline-UI) bleibt außen vor.

**Architecture:** `src/core/commands/` (pure): `types.ts` (CommandDescriptor, CommandPlan, CommandContext), `registry.ts` (Liste + Lookup), `event-commands.ts` / `contact-commands.ts` (bauen auf `applyMutation`/`applyContactMutation`/`newEventIcs`/`newContactVcf`), `push-hand-edits.ts` (Frontmatter-Handänderung → Mutationen), `undo.ts` (Verlauf), `schema.ts` (Mini-JSON-Schema-Typen + Validator für flache Objekte: string/number/boolean/enum/array<string>/datetime/date/email), `imip.ts` (ImipMessage aus VEVENT bauen). `src/core/sync/` bekommt `resyncObject(deps, collectionId, href)` (holt ein Objekt, läuft `applyDelta` mit synthetischem Delta, führt Pläne aus, speichert State). `src/obsidian/command-modal.ts` (Formular aus Schema), `src/obsidian/plan-preview-modal.ts` (Diff + Bestätigen), `src/obsidian/api.ts` (`createPluginApi(plugin)` nach `vault-rag/src/plugin_api.ts`-Muster), `src/obsidian/invite.ts` (Einladungs-Weg + `.ics`-Modal). Discovery-Erweiterung: `src/core/dav/scheduling.ts` (`schedule-outbox-URL`, `calendar-user-address-set` am Principal).

**Tech Stack:** wie bisher; kein neuer Runtime-Dep (JSON-Schema-Validator handgeschrieben für die flache Untermenge, kein ajv).

**Spec:** §5, §5b, §3 (Snapshot-Verlauf), AGENTS-Dach (Anbieter-Muster `vault-rag/src/plugin_api.ts`, Konsumenten-Regel „bei jedem Aufruf frisch lesen"), `../mailstone/docs/2026-08-22-anforderungen-aus-calendar-notes.md` (Transport-Vertrag).

## Global Constraints

- `src/core/**` obsidian-/node-/DOM-frei; pure; TDD; strict; Lint 0; no inline eslint-disable.
- Kommandos lesen **nie** das Frontmatter als Wahrheit — Basis ist `state.objects[hp].raw` (Spec §5). Jede Ausführung: Bestätigung (Modal) — die API öffnet nie ein Modal; `plan`/`execute` sind zwei Schritte.
- `PUT` mit `If-Match: <etag aus State>`; `PutResult.conflict` → Objekt frisch holen, Re-Sync, Ergebnis `{ conflict: true }` (Modal bietet „Mit frischem Stand erneut"); nach Erfolg `resyncObject`.
- Verlauf: vor jedem PUT steht das alte `raw` im State (`history`, M2a) — `undo.last` PUTtet den Vorgänger mit aktuellem If-Match.
- Einladungen: Plugin verschickt keine Mail (Reihenfolge Scheduling → Transport → `.ics`).
- API: `app.plugins.plugins["calendar-notes"].api` mit `version: 1`; Konsumenten-Fehler dürfen das Plugin nicht brechen (alle API-Methoden fangen und liefern `{ error }`); `registerMailTransport` verlangt `{ id, label, accounts(), send() }`.
- Branch `m4-commands-api`; Commits deutsch mit Trailern; Baseline: `npm run smoke:gui` beider Sektionen **vor** Beginn (Lesson 2026-08-18) — der Treiber wird um P10/P11 erweitert.

---

### Task 1: Kommando-Typen, Mini-Schema, Registry (pure)

**Files:** Create `src/core/commands/types.ts`, `src/core/commands/schema.ts`, `src/core/commands/registry.ts`; Test `tests/core/commands/schema.test.ts`, `tests/core/commands/registry.test.ts`

**Interfaces:**
```ts
// schema.ts — flache Untermenge von JSON Schema
export type FieldSchema = { type: "string"; format?: "date-time" | "date" | "email" | "uri" | "multiline"; enum?: string[]; minLength?: number; description?: string }
  | { type: "number"; minimum?: number; maximum?: number; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "array"; items: { type: "string"; format?: "email" }; description?: string };
export interface ObjectSchema { type: "object"; properties: Record<string, FieldSchema>; required?: string[]; additionalProperties?: false }
export function validateInput(schema: ObjectSchema, input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] }   // Typen, required, enum, Format (date-time = ISO "YYYY-MM-DDTHH:mm(:ss)?(Z|±hh:mm)?" oder "YYYY-MM-DD HH:mm"; date = YYYY-MM-DD; email = enthält @), unbekannte Keys → Fehler
// types.ts
export type CommandTarget = { kind: "event" | "contact"; source: string; href: string; uid: string } | { kind: "event" | "contact"; source: string; new: true };
export interface CommandContext { now: Date; profile: MappingProfile; collection: CollectionConfig; account: Account; target: CommandTarget; raw?: string; etag?: string; resolveContact?(email: string): { path: string; display?: string } | undefined }
export interface CommandPlan { commandId: string; target: CommandTarget; summary: string; diff: { field: string; before?: string; after?: string }[]; newRaw: string; etag?: string; contentType: "text/calendar" | "text/vcard"; hrefForPut: string; createsNew: boolean; invite?: { attendees: string[]; method: "REQUEST" | "CANCEL" } }
export interface CommandDescriptor { id: string; kind: "event" | "contact"; title: string; description: string; schema: ObjectSchema; appliesTo(ctx: CommandContext): boolean; plan(input: Record<string, unknown>, ctx: CommandContext): CommandPlan }
// registry.ts
export function commandRegistry(): CommandDescriptor[]                  // alle (Task 2+3 registrieren sich über Arrays, keine Seiteneffekte)
export function findCommand(id: string): CommandDescriptor | undefined
export function commandsFor(ctx: CommandContext): CommandDescriptor[]  // appliesTo-Filter
export function toolDefinitions(): { name: string; description: string; parameters: ObjectSchema }[]   // für LLM-Tool-Calling (Koda)
```
- [x] Tests: Validator (required, enum, date-time beide Formen, email, unknown key, array of emails); Registry liefert Deskriptoren mit eindeutigen ids; `toolDefinitions` Form.
- [x] Commit `feat(commands): Kommando-Typen, Mini-JSON-Schema-Validator, Registry`.

---

### Task 2: Termin-Kommandos (pure)

**Files:** Create `src/core/commands/event-commands.ts`; Test `tests/core/commands/event-commands.test.ts`
Kommandos (ids): `event.move` (start, end?, allDay?, tzid? — Default tzid aus ctx.raw/Profil), `event.set-title`, `event.set-location`, `event.set-url`, `event.set-description`, `event.add-attendee` (email, name?, rsvp=true → `invite: {attendees:[email], method:"REQUEST"}`), `event.remove-attendee` (email → `invite: {…, method:"CANCEL"}` nur wenn Scheduling vorhanden — Flag in ctx.account), `event.set-partstat` (partstat ∈ ACCEPTED|DECLINED|TENTATIVE; eigene Adresse aus `account.calendarUserAddresses`), `event.delete` (Plan mit `newRaw: ""` + `deleteRequest: true` — erweitere CommandPlan um `delete?: true`), `event.create` (title, start, end?, allDay?, location?, description?, url?, calendar=ctx.collection; uid = `${newId}@calendar-notes`; hrefForPut = `${col.href}${uid}.ics`; createsNew). Jedes `plan`: baut `newRaw` via `applyMutation(ctx.raw, …)`/`newEventIcs`, `diff` aus `parseEvents(before/after)` (nur geänderte Felder), `summary` deutsch-neutral („Termin verschoben: 2026-09-02 14:00–15:30").
- [x] Tests je Kommando (Fixtures `tests/fixtures/ical`): newRaw parsebar, diff korrekt, SEQUENCE-Regeln, invite-Flags, create-Plan-Form, `appliesTo` (event-Kind, raw vorhanden bzw. `new`).
- [x] Commit `feat(commands): Termin-Kommandos (verschieben, Felder, Teilnehmer, Zu-/Absage, löschen, anlegen)`.

---

### Task 3: Kontakt-Kommandos + Handänderung schreiben + Undo (pure)

**Files:** Create `src/core/commands/contact-commands.ts`, `src/core/commands/push-hand-edits.ts`, `src/core/commands/undo.ts`; Tests analog
Kontakt-Kommandos: `contact.set-name` (fn, given?, family?), `contact.set-email` (index|new, value, types?), `contact.remove-email`, `contact.set-phone`/`remove-phone`, `contact.set-org`, `contact.set-title`, `contact.set-note`, `contact.set-birthday`, `contact.create` (fn, email?, tel?, org?; hrefForPut `${col.href}${uid}.vcf`).
`push-hand-edits.ts`: `planPushHandEdits(ctx, frontmatter, prevWritten)` → liest `handEdited`-Keys (wie `planUpsert`), kehrt Mapping um (`fmKey → serverField` über Profil) und erzeugt für **unterstützte** Felder Mutationen (event: title/location/url/description/start/end; contact: email/tel_cell/tel_home/tel_work/org/title/note/bday/fn) — nicht unterstützte Felder landen in `skipped: string[]` mit Grund; ein zusammengesetzter Plan.
`undo.ts`: `planUndoLast(ctx, history: {etag, raw, at}[])` → Plan mit `newRaw = history[0].raw`, diff gegen aktuelles raw, summary „Letzte Änderung zurücknehmen (Stand von <at>)".
- [x] Tests; Commit `feat(commands): Kontakt-Kommandos, Handänderungen auf den Server, Undo aus dem Verlauf`.

---

### Task 4: Ausführung: `executeCommand` + `resyncObject` + Konfliktpfad (core/sync)

**Files:** Create `src/core/sync/execute.ts`; Modify `src/core/sync/service.ts` (export `resyncObject`, Epoch-Guard teilen); Test `tests/core/sync/execute.test.ts`
```ts
export type ExecuteResult = { ok: true; uid: string; etag: string | null; resynced: boolean } | { ok: false; conflict: true; freshEtag?: string } | { ok: false; conflict: false; error: string }
export async function executeCommandPlan(deps: SyncDeps, settings: PluginSettings, plan: CommandPlan): Promise<ExecuteResult>
  // Transport via account+secret; delete → deleteObject(If-Match); create → putObject(If-None-Match); sonst putObject(If-Match: plan.etag) ; 412 → { conflict }; nach Erfolg: resyncObject(collectionId, hrefForPut) (GET Objekt → applyDelta mit Delta { changed:[obj] } → execute Pläne → state save); busy-Guard wie runAll
export async function resyncObject(deps, settings, collectionId: string, href: string): Promise<{ plans: NotePlan[] }>
```
- [x] Tests mit Fake-Transport: Erfolg + Resync legt/aktualisiert Notiz; 412 → conflict ohne Resync; create → If-None-Match; delete → DELETE + Notiz-Plan delete; busy.
- [x] Commit `feat(sync): Kommandos ausführen (If-Match, 412-Konflikt, gezielter Re-Sync)`.

---

### Task 5: Scheduling-Discovery + Einladungs-Weg + iMIP (core + obsidian)

**Files:** Create `src/core/dav/scheduling.ts` (`discoverScheduling(t, principalUrl)` → `{ outbox?: string; inbox?: string; addresses: string[] }` via PROPFIND `c:schedule-outbox-URL`, `c:schedule-inbox-URL`, `c:calendar-user-address-set`), `src/core/commands/imip.ts` (`buildImip(plan, method, from) → ImipMessage` — METHOD-Zeile ins VCALENDAR), `src/obsidian/invite.ts` (`InviteRouter`: `route(plan): "server" | "transport" | "ics"`, `send(...)`, `.ics`-Modal mit Textarea + „Kopieren"/„Als Datei speichern" (schreibt `<vault>/…/einladung-<uid>.ics` über vault.create)); Modify `src/core/settings.ts` (`Account.scheduling?: {outbox, inbox, addresses}` — bei Discovery gefüllt), `src/main.ts` (Discovery ruft `discoverScheduling`), `src/obsidian/plugin-host.ts` (Transport-Registry: `registerMailTransport/unregister`, Liste), Tests für core-Teile (Fixture: Nextcloud-Principal-Antwort mit outbox; Radicale ohne).
- [x] Commit `feat(invite): Scheduling-Discovery, iMIP-Bau, Einladungs-Weg Server → Transport → .ics`.

---

### Task 6: Kommando-UI — Formular-Modal aus Schema, Plan-Vorschau, Obsidian-Kommandos

**Files:** Create `src/obsidian/command-modal.ts` (`SchemaFormModal(app, descriptor, ctx, onSubmit)`: je Feld Setting mit Text/Toggle/Dropdown/TextArea/Datum-Text; Email-Felder mit Suggester über Kontakt-Index; Validierung via `validateInput` vor Submit), `src/obsidian/plan-preview-modal.ts` (summary, diff-Tabelle, Invite-Hinweis mit Route, Buttons „Ausführen"/„Abbrechen"; bei conflict: „Mit frischem Stand erneut öffnen"), Modify `src/main.ts`: Kommandos `command-run` („Termin/Kontakt ändern…": aktive Notiz → target aus Frontmatter (uidField/sourceField des passenden Profils) → Suggester über `commandsFor(ctx)` → Formular → Vorschau → execute → Notice), `command-new-event`, `command-new-contact`, `command-undo` (Verlauf des Objekts der aktiven Notiz), `command-push-hand-edits` (für aktive Notiz), i18n, styles.
- [x] Tests: pure Helfer (`targetFromFrontmatter(settings, fm)`), Formular-Modal nur Verdrahtungstest mit Kit-Mock; Rest im Smoke.
- [x] Commit `feat(obsidian): Kommandos — Formular aus Schema, Plan-Vorschau, Ausführen, Undo, Handänderungen schreiben`.

---

### Task 7: Plugin-API v1

**Files:** Create `src/obsidian/api.ts` (`createPluginApi(host): CalendarNotesApi`), `src/core/api/types.ts` (öffentliche Typen: `CalendarNotesApi { version: 1; events(q); contacts(q); get(uid); commands(); plan(id, input, targetRef); execute(plan); registerMailTransport(t); unregisterMailTransport(id); on(evt, cb): () => void }`), Modify `src/main.ts` (`this.api = createPluginApi(...)`; `service` feuert `synced`/`changed`-Events über ein kleines Event-Emitter-Objekt in `src/core/sync/events.ts`), `docs/API.md` (Vertrag, Beispiel für Koda/mailstone, Konsumenten-Regel „bei jedem Aufruf frisch lesen"), Tests `tests/obsidian/api.test.ts` mit Fakes (events/contacts aus State, commands() = toolDefinitions, plan/execute Durchreichung, Fehler werden gefangen → `{ error }`, registerMailTransport validiert Form).
- [x] Commit `feat(api): Plugin-API v1 — lesen, Kommandos planen/ausführen, Mail-Transport, Events`.

---

### Task 8: GUI-Smoke P10/P11 + Abschluss

**Files:** Modify `scripts/gui-smoke.ts` (P10: über `plugin.api.plan("event.move", …)` + `execute` → Radicale-Objekt geändert (GET) → Notiz-Frontmatter aktualisiert; P11: `event.add-attendee` ohne Scheduling/Transport → Route `ics`; P12: `undo` stellt Vorgänger her), `docs/SMOKE.md`, Baseline `docs/smoke/baseline-2026-08-23.md` (Lauf vor und nach M4), CHANGELOG, AGENTS („Was M4 liefert"), `docs/registry-kandidaten.md` (Kommando-Schema-als-Tool, Mini-Schema-Validator, Anbieter-API zweites Exemplar → REGISTRY-Status), Plan-Checkboxen.
- [x] `npm run gate && npm run test:integration && npm run typecheck:scripts`; Smoke beide Sektionen; Commit `docs: M4 abgeschlossen`.

## Self-Review
- Spec §5 Kommando-Satz 2a vollständig (verschieben/verlängern, Ort/URL/Titel, Teilnehmer add/remove, Zu-/Absage, löschen, Kontaktfeld, neu anlegen, Handänderung schreiben) → T2/T3/T6 ✓; If-Match/412/Re-Sync/Verlauf → T4 ✓; Einladungen Server → Transport → .ics → T5 ✓; §5b API (events/contacts/get/commands/plan/execute/registerMailTransport/on; Bestätigung beim Aufrufer; zwei Schritte) → T7 ✓; Stufe 2b bewusst außen vor.
- Schnittstellen: `CommandPlan`/`CommandDescriptor` (T1) in T2–T7; `executeCommandPlan` (T4) in T6/T7; `ImipMessage` aus mailstone-Vertrag in T5/T7; `SyncDeps` (M2b) in T4/T5.
