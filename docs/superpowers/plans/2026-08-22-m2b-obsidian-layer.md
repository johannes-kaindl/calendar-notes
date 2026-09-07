# calendar-notes M2b — Obsidian-Schicht (Transport, Secret, Settings, Vault-Adapter, Sync-Service, Trockenlauf) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Plugin wird benutzbar: Konten mit Passwort im Schlüsselbund, Discovery in den Settings, Sammlungen an Profile/Ordner binden, Sync (manuell, Intervall, Start) mit Trockenlauf-Vorschau, Notizen über `processFrontMatter`/`vault.process` schreiben, Zustand je Sammlung unter `manifest.dir/state/`. Kein Adoption-UI (M3), keine Kommandos/API (M4).

**Architecture:** `src/obsidian/` ist dünn: jede Klasse ist ein Adapter über ein Interface, das der `SyncService` (in `src/core/sync/`, pure bis auf die Interfaces) konsumiert: `TransportFactory`, `SecretStore`, `StateStore`, `NoteLookupFactory`, `PlanExecutor`, `Notifier`, `Clock`. Dadurch ist der gesamte Ablauf (Refresh → Sync → Plan → Ausführen → Zustand → Meldungen) in vitest mit Fakes testbar; die Obsidian-Klassen werden mit dem Kit-Mock nur auf Verdrahtung geprüft. Settings folgen dem Dach-Muster „Zweigleisige deklarative Settings — eine-Wahrheit-Walker" (`getSettingDefinitions()` + vendored `settings_walker`).

**Tech Stack:** Obsidian API 1.13 (`requestUrl`, `secretStorage`/`SecretComponent`, `processFrontMatter`, `vault.process`, `getSettingDefinitions`), vendored `obsidian-kit` (`settings_walker`, `folder-suggest`, `confirm`) + `code-kit` (`i18n`, `settings`, `timeout`), vitest + Kit-Mock.

**Spec:** `docs/superpowers/specs/2026-08-22-calendar-notes-design.md` §3 (Konto/Secret/Discovery/Auslöser/Fehler/Trockenlauf), §4 (Profile-Verwaltung, Import/Export), §2 (Schreibweg-Entscheidung). Vorgänger: M1 (`src/core/dav`, `ical`, `vcard`), M2a (`src/core/mirror`, `src/core/state`).

## Global Constraints

- `src/core/**` bleibt obsidian-/node-/DOM-frei (`npm run check:pure`) — `src/core/sync/` darf nur Interfaces und Typen aus `src/core/**` nutzen; alles Obsidian-Spezifische liegt in `src/obsidian/**`.
- `requestUrl({ throw: false })` + `withTimeout` (30 s Default; injizierbar). `requestUrl` folgt Redirects selbst — die Discovery muss damit umgehen (s. Task 3).
- Zugangsdaten **nie** in `data.json`: Konto speichert `secretId`; Passwort in `app.secretStorage`; nach `setSecret` rücklesen. Fehlt das Secret → Konto pausiert (Status, keine Notice-Schleife).
- Notizen schreiben: Neuanlage `vault.create(path, body)` + `processFrontMatter`; Update `processFrontMatter` (set/unset) + `vault.process` für Body **nur wenn** Plan `body` trägt; Archiv/Markieren `processFrontMatter`; Papierkorb `vault.trash(file, true)`.
- Settings-Tab: `getSettingDefinitions()` ist die eine Wahrheit; bedingte Zeilen **weglassen**, nicht `visible`; `display()` ruft den vendored Walker. Kein `document.createElement`, nur `createEl`/`Setting`. Sentence case in UI-Strings. i18n de/en über vendored `i18n` (`defineStrings`, `t`).
- Scorecard: keine `child_process`/`fs`; `vault.getMarkdownFiles()` ist erlaubt (info-level). `manifest.json` bleibt wie in M1.
- Branch `m2b-obsidian`, deutsche Commit-Messages, Trailer wie bisher. TDD für alles unter `src/core/**`; für `src/obsidian/**` Verdrahtungstests mit dem Kit-Mock, wo der Mock es trägt.

---

### Task 1: Settings-Modell (pure)

**Files:** Create `src/core/settings.ts`; Test `tests/core/settings.test.ts`

**Interfaces:**
```ts
export interface Account { id: string; name: string; baseUrl: string; username: string; secretId: string; principal?: string; calendarHome?: string; addressbookHome?: string }
export interface CollectionConfig { id: string; accountId: string; href: string; kind: "calendar" | "addressbook"; displayName: string; enabled: boolean; profileId: string; folderOverride?: string; readOnly: boolean; ctag?: string; syncToken?: string }
export interface SyncSettings { intervalMinutes: number; mobileIntervalMinutes: number; pastDays: number; futureDays: number; startupDelaySeconds: number; requestTimeoutMs: number; batchSize: number }
export interface PluginSettings { version: 1; accounts: Account[]; collections: CollectionConfig[]; profiles: MappingProfile[]; sync: SyncSettings; language: "auto" | "de" | "en" }
export const DEFAULT_SYNC: SyncSettings   // 15 / 60 / 90 / 365 / 10 / 30000 / 50
export function defaultSettings(): PluginSettings   // profiles = [defaultContactProfile(), defaultEventProfile()]
export function normalizeSettings(raw: unknown): PluginSettings   // mergeSettings(defaults, raw) + Profile einzeln via validateProfile (ungültige verworfen, Defaults ergänzt wenn fehlend) + Collections ohne existierendes Konto/Profil verworfen + Zahlen geklemmt (interval ≥0, days ≥0, timeout ≥1000)
export function secretIdFor(accountId: string): string            // `calendar-notes-${accountId}`
export function newId(prefix: string, rand: () => number): string // `${prefix}-${base36(rand)}`… 8 Zeichen; rand injiziert (pure)
export function sourceOf(c: CollectionConfig): string             // `${accountId}/${id}`
export function effectiveProfile(s: PluginSettings, c: CollectionConfig): MappingProfile | undefined   // profil + folderOverride angewandt
```

- [x] **Step 1: Tests**
```ts
import { describe, it, expect } from "vitest";
import { defaultSettings, normalizeSettings, secretIdFor, newId, sourceOf, effectiveProfile, DEFAULT_SYNC } from "../../src/core/settings";
describe("settings", () => {
  it("defaults carry both default profiles", () => {
    const s = defaultSettings();
    expect(s.profiles.map((p) => p.id)).toEqual(["default-contact", "default-event"]);
    expect(s.sync).toEqual(DEFAULT_SYNC);
  });
  it("normalize: merges, drops invalid profile, re-adds missing defaults, drops orphan collection, clamps", () => {
    const s = normalizeSettings({ accounts: [{ id: "a1", name: "X", baseUrl: "https://d/", username: "u", secretId: "calendar-notes-a1" }],
      collections: [{ id: "c1", accountId: "a1", href: "https://d/k/", kind: "calendar", displayName: "K", enabled: true, profileId: "default-event", readOnly: false }, { id: "c2", accountId: "ghost", href: "x", kind: "calendar", displayName: "G", enabled: true, profileId: "default-event", readOnly: false }],
      profiles: [{ id: "broken" }], sync: { intervalMinutes: -5, requestTimeoutMs: 10 } });
    expect(s.collections.map((c) => c.id)).toEqual(["c1"]);
    expect(s.profiles.map((p) => p.id).sort()).toEqual(["default-contact", "default-event"]);
    expect(s.sync.intervalMinutes).toBe(0); expect(s.sync.requestTimeoutMs).toBe(1000); expect(s.sync.pastDays).toBe(90);
  });
  it("normalize(undefined) == defaults; keeps a valid custom profile", () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings());
    const custom = { ...defaultSettings().profiles[0]!, id: "pallas", name: "Pallas" };
    expect(normalizeSettings({ profiles: [custom] }).profiles.map((p) => p.id)).toEqual(["pallas", "default-contact", "default-event"]);
  });
  it("helpers", () => {
    expect(secretIdFor("a1")).toBe("calendar-notes-a1");
    let i = 0; const rand = () => [0.1, 0.5, 0.9][i++ % 3]!;
    expect(newId("acc", rand)).toMatch(/^acc-[a-z0-9]{8}$/);
    const s = defaultSettings(); const c = { id: "c1", accountId: "a1", href: "h", kind: "calendar" as const, displayName: "K", enabled: true, profileId: "default-event", readOnly: false, folderOverride: "Termine/2026" };
    expect(sourceOf(c)).toBe("a1/c1");
    expect(effectiveProfile(s, c)?.folder).toBe("Termine/2026");
    expect(effectiveProfile(s, { ...c, profileId: "nope" })).toBeUndefined();
  });
});
```
- [x] **Step 2/3: RED → Implementieren** (`mergeSettings` aus `src/vendor/code-kit/settings.ts` — Signatur vor Ort prüfen; `validateProfile`/Defaults aus `src/core/mirror/profile.ts`). `newId`: 8 Zeichen aus `rand()` via `Math.floor(rand()*36).toString(36)`.
- [x] **Step 4: Commit** `feat(settings): Settings-Modell mit Normalisierung, Profilen, Konten, Sammlungen`.

---

### Task 2: Kit-Vendoring (kit-obsidian) + Collection-Refresh (core)

**Files:** Modify `tools/sync-kit.sh` (zusätzlich `src/vendor/kit-obsidian/{settings_walker,folder-suggest,confirm}.ts` aus `$KIT/src/obsidian/`, eigener VENDOR.json); Create `src/core/dav/refresh.ts`; Test `tests/core/dav/refresh.test.ts`

**Interfaces:**
```ts
export async function refreshCollection(t: Transport, col: DavCollection): Promise<DavCollection>   // PROPFIND Depth 0 auf col.href mit COLLECTION_PROPS; 207 → neue ctag/syncToken/readOnly/displayName übernommen (fehlende Props lassen alte Werte stehen); 404 → DavError(404); sonst DavError
```
- [x] **Step 1: Tests** — Fake-Transport: 207 mit neuem `getctag`+`sync-token` → Felder aktualisiert, übrige gleich; 207 ohne `sync-token` → alter Token bleibt; 404 → rejects `{status:404}`.
- [x] **Step 2/3:** `sh tools/sync-kit.sh` erweitern und laufen lassen; `refresh.ts` nutzt `propfindBody`, `parseMultistatus`, `collectionFromResponse` (exportiert in `discovery.ts`) — `collectionFromResponse(r, col.href)` liefert eine frische `DavCollection`; merge: `{ ...col, ...fresh }` nur mit definierten Feldern.
- [x] **Step 4: Commit** `feat(dav): Collection-Refresh (ctag/sync-token vor jedem Sync) + kit-obsidian vendored`.

---

### Task 3: Transport, Secrets, State-Store (Obsidian-Adapter, klein und getestet)

**Files:** Create `src/obsidian/transport.ts`, `src/obsidian/secrets.ts`, `src/obsidian/state-store.ts`; Modify `tests/__mocks__/obsidian.ts` (falls Mock-Ergänzungen nötig: `requestUrl` ist im Kit-Mock als MockFn vorhanden); Test `tests/obsidian/transport.test.ts`, `tests/obsidian/secrets.test.ts`, `tests/obsidian/state-store.test.ts`

**Interfaces:**
```ts
// transport.ts
export function obsidianTransport(opts: { timeoutMs: number; request?: typeof requestUrl }): Transport
  // requestUrl({ url, method, headers, body, throw: false }) in withTimeout; Timeout → DavResponse { status: 0, headers: {}, text: "timeout" }; Header-Objekt wie geliefert
// secrets.ts
export interface SecretStore { get(id: string): string | null; set(id: string, value: string): void /* wirft, wenn Rücklesen fehlschlägt */; has(id: string): boolean }
export function obsidianSecretStore(app: App): SecretStore     // über app.secretStorage; `set` verifiziert per getSecret (TaskNotes-Kniff)
export class MemorySecretStore implements SecretStore           // für Tests/Fallback
// state-store.ts
export interface StateStore { load(source: string): Promise<CollectionState>; save(state: CollectionState): Promise<void>; remove(source: string): Promise<void> }
export function adapterStateStore(adapter: DataAdapter, pluginDir: string): StateStore   // Datei `${pluginDir}/state/${encode(source)}.json`, mkdir bei Bedarf, parseState tolerant; encode: `/` → `__`
export class MemoryStateStore implements StateStore
```
- [x] **Step 1: Tests** — transport: Fake-`request` liefert `{status:207, headers:{etag:'"1"'}, text:"x"}` → DavResponse gleich; Fake, das nie auflöst → mit `timeoutMs: 20` Ergebnis `status:0`; Header `throw:false` und Methode/Body werden durchgereicht (capture). secrets: `MemorySecretStore` set/get/has; `obsidianSecretStore` mit Fake-`app.secretStorage` (`setSecret` speichert nicht → `set` wirft). state-store: Fake-Adapter (`exists/mkdir/read/write/remove` auf Map) → save/load roundtrip, load unbekannt → `emptyState(source)`, Pfad `state/acc__col.json`.
- [x] **Step 2/3:** Implementieren. Hinweis: `DataAdapter`-Typ aus `obsidian`; im Test eine Attrappe mit denselben Methoden übergeben (kein Import aus `obsidian` nötig).
- [x] **Step 4: Commit** `feat(obsidian): requestUrl-Transport mit Timeout, Secret-Store (Schlüsselbund), State-Store (manifest.dir/state)`.

---

### Task 4: Vault-Adapter — Notiz-Lookup und Plan-Ausführung

**Files:** Create `src/obsidian/vault-notes.ts`; Test `tests/obsidian/vault-notes.test.ts`

**Interfaces:**
```ts
export interface NoteIndexEntry { path: string; uid: string; source: string; recurrenceId?: string }
export function buildNoteIndex(files: { path: string; frontmatter?: Record<string, unknown> }[], profile: MappingProfile): Map<string, NoteIndexEntry>   // pure Helfer; key = `${source}\x00${uid}\x00${recurrenceId ?? ""}`
export class VaultNoteLookup implements NoteLookup   // constructor(app: App, profile: MappingProfile); baut Index aus app.vault.getMarkdownFiles() + metadataCache.getFileCache(f)?.frontmatter beim ersten Zugriff (lazy) ; byPath liest Frontmatter aus Cache und Body aus app.vault.cachedRead → NoteLookup ist synchron, deshalb: `await lookup.prime(paths?)` lädt Bodies vorab für alle Index-Treffer (Service ruft prime() vor applyDelta); `hasBacklinks(path)` scannt metadataCache.resolvedLinks nach Einträgen mit Ziel path
export interface PlanExecutor { execute(plan: NotePlan): Promise<void> }
export function vaultPlanExecutor(app: App): PlanExecutor
  // create: Ordner sicherstellen (createFolder rekursiv, existierende ignorieren), vault.create(path, body), processFrontMatter(f => Object.assign(f, frontmatter))
  // exists(path): IMMER vaultweit über app.vault.getAbstractFileByPath(path) != null — NIE aus dem Profil-Index (sonst überschreibt die Kollisions-Suffixierung fremde Notizen)
  // update: processFrontMatter(f => { set…; for unset delete f[k] }); if (plan.body !== undefined) vault.process(file, () => plan.body)
  // archive / delete:mark: processFrontMatter(set); delete:trash: vault.trash(file, true); skip: nichts
  // Datei nicht gefunden bei update/archive/delete → Error("Notiz nicht gefunden: path")
```
Wichtig: `NoteLookup` (M2a) ist synchron. Der Lookup cached Bodies über `prime()`; `byPath` für nicht geprimte Pfade liefert `undefined` (→ `applyDelta` meldet dann einen Fehler statt still zu überspringen) — daher ruft der SyncService `prime()` mit allen Pfaden aus `state.objects[*].notes[*].path` **plus** dem Index (alle Treffer des Profils) und prüft danach per Assertion, dass jeder State-Pfad geprimt ist (fehlt eine Datei, wird sie als `missing` markiert, nicht übersprungen).
- [x] **Step 1: Tests** — `buildNoteIndex`: drei Fake-Files (eine ohne uid, eine Override) → Map-Keys korrekt. `VaultNoteLookup` mit Kit-`makeFakeApp()`-Attrappe (prüfen, was der Mock an `vault.getMarkdownFiles`/`metadataCache.getFileCache`/`cachedRead`/`resolvedLinks`/`getAbstractFileByPath` bietet — fehlende Teile **im Test** als Objekt-Attrappe ergänzen, nicht den vendored Mock editieren): `byUid` findet, `byPath` nach `prime`, `byPath` ohne `prime` → `undefined`, `exists` findet eine Nicht-Profil-Notiz im selben Pfad, `hasBacklinks` über `resolvedLinks = { "A.md": { "Contacts/X.md": 1 } }`. `vaultPlanExecutor` mit Attrappe, die `create/processFrontMatter/process/trash/createFolder` protokolliert: je Plan-Op genau die erwarteten Aufrufe; `create` in verschachteltem Ordner legt Ordner an; `update` ohne body ruft `process` nicht.
- [x] **Step 2/3:** Implementieren. Ordner anlegen: Pfad-Segmente iterativ `getFolderByPath` → fehlt → `createFolder` (try/catch auf „already exists").
- [x] **Step 4: Commit** `feat(obsidian): Vault-Adapter — Notiz-Index/Lookup und Plan-Ausführung über processFrontMatter`.

---

### Task 5: SyncService (core/sync, pure bis auf Interfaces) + Notices

**Files:** Create `src/core/sync/service.ts`, `src/core/sync/types.ts`; Test `tests/core/sync/service.test.ts`

**Interfaces:**
```ts
// types.ts
export interface Notifier { info(msg: string): void; warn(msg: string): void }
export interface SyncDeps {
  settings(): PluginSettings;
  saveSettings(s: PluginSettings): Promise<void>;     // ctag/syncToken je Collection zurückschreiben
  secrets: SecretStore; stateStore: StateStore;
  transportFor(account: Account, password: string): Transport;
  lookupFor(profile: MappingProfile): Promise<NoteLookup>;   // inkl. prime()
  executor: PlanExecutor; notify: Notifier; now(): Date;
  resolveAttendee?(): AttendeeResolver | undefined;          // aus Kontakt-Index (E-Mail → Pfad); M2b: aus allen Contact-Profilen gebaut
}
export interface CollectionRunResult { collectionId: string; ok: boolean; dryRun: boolean; plans: NotePlan[]; counts: RunInfo["counts"]; error?: string; handEdited: { path: string; keys: string[] }[]; strategy?: string; skippedReason?: "disabled" | "no-secret" | "no-profile" | "busy" }
export interface RunResult { startedAt: string; finishedAt: string; collections: CollectionRunResult[] }
// service.ts
export class SyncService {
  constructor(deps: SyncDeps)
  isRunning(): boolean
  async runAll(opts?: { dryRun?: boolean }): Promise<RunResult>
  async runCollection(collectionId: string, opts?: { dryRun?: boolean }): Promise<CollectionRunResult>
  lastResult(): RunResult | undefined
}
```
Ablauf je Sammlung: disabled → skipped; Konto/Profil fehlt → skipped; Secret fehlt → skipped `no-secret` (keine Notice, nur Status); Transport bauen; `refreshCollection`; Fenster nur bei `kind==="calendar"` (`windowFor(now, pastDays, futureDays)`, `timeRange = toDavTimeRange`); **Kalender mit Fenster laufen immer über die etag-Diff-Strategie** (`syncCollection(t, { ...col, syncToken: undefined }, state.snapshot, { timeRange, batchSize })`) — nur so kommen Termine, die neu ins Fenster rücken, als `changed` herein und `outOfWindow` wird berechnet; Adressbücher nutzen `sync-collection`, wenn vorhanden; `lookupFor(profile)`; `applyDelta({ profile, source, delta, state, lookup, now, timeWindow, resolveAttendee })` — **`timeWindow` muss mitgegeben werden**, sonst findet die Client-seitige Fensterprüfung nicht statt; **dryRun** → Pläne zurück, nichts ausführen, Zustand nicht speichern; sonst Pläne der Reihe nach `executor.execute` (Fehler je Plan sammeln, weiter), dann `withRun` + `stateStore.save`, Collection-`ctag/syncToken` in Settings aktualisieren + `saveSettings`. Notices: bei **neuem** Fehler (anders als `state.lastRun?.error`) `warn`; bei handEdited `info` einmal je Lauf mit Anzahl. Teil-Anwendung: Pläne eines hrefs, der mitten in der Verarbeitung fehlschlägt, stehen bereits in `ApplyResult.plans`/`state` — sie werden ausgeführt (einzeln gültig), und die Status-Zeile nennt den Fehler je href; `applyDelta` stellt für Fehler-hrefs den alten etag wieder her, sodass der nächste Lauf erneut versucht. Epoch-Guard: `runAll`/`runCollection` während eines Laufs → sofort `skippedReason: "busy"` für alle (kein Warten). Fehler je Sammlung isoliert (try/catch um den ganzen Block → `ok:false, error`).
- [x] **Step 1: Tests** (Fakes: `MemorySecretStore`, `MemoryStateStore`, Fake-Transport aus `tests/helpers/fake-transport.ts` mit Radicale-ähnlichen Antworten für PROPFIND Depth 0 (refresh), REPORT sync-collection/multiget oder PROPFIND Depth 1 + multiget, Fake-Lookup (aus M2a-Tests), Fake-Executor protokolliert, Fake-Notifier sammelt): (a) dryRun liefert create-Pläne, Executor nicht gerufen, State nicht gespeichert; (b) echter Lauf: Executor gerufen, State gespeichert mit snapshot + lastRun.ok, Settings-ctag aktualisiert; (c) Secret fehlt → `no-secret`, kein Transport-Aufruf, keine Notice; (d) Transport wirft 401 in Sammlung A, Sammlung B läuft durch; `warn` genau einmal; zweiter Lauf mit gleichem Fehler → keine zweite `warn`; (e) busy: `runAll` zweimal ohne await → zweites Ergebnis nur `busy`.
- [x] **Step 2/3:** Implementieren.
- [x] **Step 4: Commit** `feat(sync): SyncService — Refresh, Sync, Plan, Ausführen, Zustand, Meldungen, Trockenlauf, Epoch-Guard`.

---

### Task 6: i18n-Strings + Settings-Tab

**Files:** Create `src/i18n/strings.ts` (EN/DE, Schlüssel alphabetisch je Bereich `settings.*`, `cmd.*`, `notice.*`, `preview.*`), `src/obsidian/settings-tab.ts`; Test `tests/obsidian/settings-tab.test.ts` (nur `getSettingDefinitions()`-Struktur mit Fake-Host)

**Interfaces:**
```ts
export interface SettingsHost {
  settings: PluginSettings; saveSettings(): Promise<void>;
  secrets: SecretStore;
  discover(account: Account): Promise<DiscoveryResult>;     // baut Transport mit Secret, ruft core discover
  syncNow(collectionId?: string): void; preview(): void;
  status(collectionId: string): { lastRun?: RunInfo; running: boolean };
  rand(): number;
}
export class CalendarNotesSettingTab extends PluginSettingTab { constructor(app, plugin, host: SettingsHost); getSettingDefinitions(): SettingDefinitionItem[]; display(): void }
```
Gruppen (Reihenfolge): **Konten** (`type:"list"` je Konto: Name, Server-URL, Benutzername (text), Passwort (render: `SecretComponent` → `secretId`), Button „Verbindung testen & Sammlungen finden" (render) — Ergebnis: Sammlungen werden in `settings.collections` ergänzt/aktualisiert (neue: `enabled:false`, Profil = Default passend zur Art), Notice mit Anzahl/Warnungen; `onDelete` entfernt Konto + seine Sammlungen + Secret; Add-Affordance legt Konto mit `newId("acc", rand)` + `secretIdFor` an) · **Sammlungen** (je aktiviertem Konto eine Gruppe; je Sammlung: Toggle „Spiegeln", Dropdown Profil (nur passende `kind`), Ordner-Override (render: Text + `FolderSuggest`), Statuszeile (letzter Lauf/Zähler/Fehler, desc) und Button „Jetzt synchronisieren") · **Profile** (`type:"list"`: Name + Art; Button „Bearbeiten (JSON)" → Modal mit Textarea, `validateProfile` beim Speichern; Buttons „Exportieren" (Clipboard, `navigator.clipboard`-Guard wie REGISTRY) / „Importieren" (Modal mit Textarea); `onDelete` nur wenn kein Collection-Bezug; Add legt Kopie eines Defaults mit neuer id an) · **Synchronisation** (slider/number: Intervall Desktop, Intervall Mobil, Tage zurück, Tage voraus, Startverzögerung; Sprache dropdown) · **Aktionen** (Buttons „Alle Sammlungen synchronisieren", „Vorschau (Trockenlauf)").
Hinweise: `getSettingDefinitions()` synchron — Discovery-Ergebnis/Statuszeilen werden im Host gecacht und per `refreshSettingsTab` neu gerendert. Schlüssel-Typen: für `control`-Einträge mit `key` muss `getControlValue/setControlValue` auf `settings.sync.*` zeigen — Tab überschreibt `getControlValue(key)`/`setControlValue(key, v)` mit Pfad-Auflösung (`sync.intervalMinutes`).
- [x] **Step 1: Test** — Fake-Host mit einem Konto, zwei Sammlungen (je Art), Defaults: `getSettingDefinitions()` enthält Gruppen-Headings in der Reihenfolge; Konto-Liste hat 1 Item; Sammlungs-Gruppe zeigt Profil-Dropdown nur mit passenden Profilen; ohne Konten erscheint `emptyState`-Text; `setControlValue("sync.intervalMinutes", 5)` schreibt in `settings.sync`.
- [x] **Step 2/3:** Implementieren nach `../audio-interface/src/obsidian/settings-tab.ts` (Aufbau, Walker-Aufruf in `display()`, `cleanupPrevious`). Für Modals (`Modal` + `TextAreaComponent`) kleine Klassen in derselben Datei oder `src/obsidian/json-modal.ts`.
- [x] **Step 4: Commit** `feat(obsidian): Settings-Tab — Konten mit Schlüsselbund, Discovery, Sammlungen, Profile (JSON), Sync-Optionen`.

---

### Task 7: Vorschau-Modal (Trockenlauf)

**Files:** Create `src/obsidian/preview-modal.ts`; Test `tests/obsidian/preview-modal.test.ts` (pure Gruppierungs-Helfer)

**Interfaces:**
```ts
export function summarizeRun(r: RunResult): { perCollection: { id: string; counts: RunInfo["counts"]; error?: string; skippedReason?: string }[]; byOp: Record<NotePlan["op"], { path: string; detail?: string }[]>; total: number }   // pure, exportiert
export class PreviewModal extends Modal { constructor(app, result: RunResult, onExecute: () => void); onOpen(): void }  // Überschrift mit Gesamtzahl, je Sammlung Zähler/Fehler, Listen je Op (create/update/archive/delete/skip nur als Zahl), handEdited-Hinweise, Buttons „Jetzt ausführen" (ruft onExecute, schließt) / „Schließen"
```
- [x] **Step 1: Test** — `summarizeRun` gruppiert korrekt; `detail` bei update = `set/unset`-Keys + „Body", bei delete = mode.
- [x] **Step 2/3/4:** Implementieren; Commit `feat(obsidian): Vorschau-Modal für den Trockenlauf`.

---

### Task 8: main.ts-Verdrahtung, Kommandos, Auslöser

**Files:** Modify `src/main.ts`; Create `src/obsidian/plugin-host.ts` (baut `SyncDeps` aus App/Plugin: Transport-Factory mit `settings.sync.requestTimeoutMs`, Secret-Store, State-Store (`this.manifest.dir`), `lookupFor` (VaultNoteLookup + prime), Executor, Notifier (`Notice`), `resolveAttendee` (Index aller Contact-Profile: E-Mail-Feld → Pfad; Display = Dateiname))
Kommandos: `sync-all` („Sync all collections"), `sync-preview` („Preview sync (dry run)" → `runAll({dryRun:true})` → `PreviewModal`), `sync-collection` (Suggester über aktivierte Sammlungen → `runCollection`). Auslöser: `app.workspace.onLayoutReady(() => window.setTimeout(() => runAll(), startupDelaySeconds*1000))` nur wenn mind. eine Sammlung aktiv; Intervall `registerInterval(window.setInterval(...))` mit `Platform.isMobile ? mobileIntervalMinutes : intervalMinutes` (0 = aus; bei Settings-Änderung neu setzen). Settings laden: `normalizeSettings(await loadData())`; Sprache: `setLang(pickLang(language==="auto" ? getLanguage() : language))`.
- [x] **Step 1:** Verdrahten; `npm run build`; `npm run lint` (0 Warnings); `npm run typecheck`.
- [x] **Step 2: Manueller Smoke (Maintainer-lokal, dokumentiert im Report):** `OBSIDIAN_PLUGIN_DIR=<staging-vault>/.obsidian/plugins/calendar-notes npm run deploy` gegen einen Wegwerf-Vault + laufendes Radicale (`npx tsx scripts/dav-server.ts`): Konto anlegen (`http://127.0.0.1:5232/`, test/test), Discovery findet Kalender+Kontakte, Sammlungen aktivieren, Vorschau zeigt 3+2 creates, Ausführen legt Notizen an, zweiter Lauf skip. Ergebnis als Stichpunkte in `docs/smoke/2026-08-22-m2b-manual.md` (was ging, was nicht). **Der automatisierte GUI-Smoke kommt in M3** — hier nur Beleg, dass der Pfad einmal gelaufen ist.
- [x] **Step 3: Commit** `feat: Plugin verdrahtet — Kommandos, Start-/Intervall-Sync, Vorschau`.

---

### Task 9: Abschluss M2b — Gate, Doku, Registry-Kandidaten

- [x] `npm run gate && npm run test:integration` grün; CHANGELOG (M2b-Zeile), AGENTS.md („Was M2b liefert" + Smoke-Anleitung), `docs/registry-kandidaten.md` (+ `secretStorage`-Muster erstes Exemplar, + SyncService-Interface-Injektion), Plan-Checkboxen; Commit `docs: M2b abgeschlossen`.

---

## Self-Review
- Spec §3 vollständig: Konto+Secret (T3/T6), Discovery (T6), Abgleich (T5 nutzt M1), Snapshot/State (T3/T5), Auslöser (T8), Fehler-Isolation + Notices nur bei neuen Fehlern (T5), Trockenlauf (T5/T7) ✓. §4 Profile-UI/Import/Export (T6) ✓; „Profil aus Notiz erzeugen" und Adoption → M3 (bewusst). §2 Schreibweg (T4) ✓.
- Typen: `NoteLookup`/`NotePlan`/`applyDelta` (M2a) in T4/T5; `Transport`/`DavCollection`/`syncCollection`/`refreshCollection` (M1/T2) in T5; `SecretStore`/`StateStore` (T3) in T5/T6; `RunResult` (T5) in T7/T8.
- Offen/Risiko (im Report von T8 festhalten): `requestUrl`-Redirect-Verhalten bei `.well-known` (Discovery erwartet 301 — falls requestUrl transparent folgt, landet der 207 der Ziel-URL unter der well-known-URL; `discover()` kommt damit zurecht, weil `current-user-principal` absolute hrefs liefert — im Smoke gegen Radicale **und** notiert für mailbox.org).
