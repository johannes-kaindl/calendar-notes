# calendar-notes M3 — Adoption, Profil-aus-Notiz, Fixture-Vault, GUI-Smoke — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bestehende Notizen (Jays 99 Kontakte, 28 Termine) mit Server-Einträgen verknüpfen statt zu duplizieren (Spec §4 Adoption), ein Profil aus einer Beispielnotiz ableiten (Spec §4), ein getracktes Fixture für den Staging-Vault und ein automatisierter GUI-Smoke-Treiber (`npm run smoke:gui`, CORE-TEST-02 b) mit den Prüfpunkten aus dem M2b-Smoke — inklusive Settings-UI sichtbar.

**Architecture:** `src/core/adopt/` (pure): Kandidaten + Matching (E-Mail → Telefon E.164 → Name fuzzy; Termine: Start exakt + Titel-Ähnlichkeit) → `AdoptionSuggestion[]` mit Konfidenz; `src/core/mirror/profile-from-note.ts` (pure): Feld-Vorschlag aus Frontmatter-Keys. Obsidian: `src/obsidian/adoption-modal.ts` (Review-Tabelle, Verknüpfen/Überspringen/Neu anlegen, „alle sicheren übernehmen"), Kommando `adopt-collection`, Kommando `profile-from-note`; Verknüpfen = `processFrontMatter` setzt `uidField`/`sourceField` (+ `etagField`, `stateField: live`) und trägt die Notiz in den Sammlungs-State ein, damit der nächste Sync sie *aktualisiert* statt neu anzulegen. Treiber: `scripts/gui-smoke.ts` importiert die zentrale Brücke `../../tools/obsidian-cdp/` und `scripts/dav-server.ts`; Fixture `fixtures/vault/` (notes + obsidian).

**Tech Stack:** wie M1–M2b; CDP-Brücke `tools/obsidian-cdp/` (`attachTo`, `pollUntil`, `notices`, `setPluginSetting`, `buildVault`, `stagingVaultDir`); Radicale via `startRadicale` (Port 5298 im Smoke, 5299 in der Integration, 5232 manuell).

**Spec:** `docs/superpowers/specs/2026-08-22-calendar-notes-design.md` §4 (Adoption, Profil aus Notiz), §6.3 (GUI-Smoke, Staging-Vault, Baseline). Vorgänger: M2b (`docs/smoke/2026-08-22-m2b-manual.md` = Prüfpunkt-Quelle; Abschluss-Review-Notizen „M3 readiness").

## Global Constraints

- `src/core/**` obsidian-/node-/DOM-frei; pure; TDD; no inline eslint-disable; Lint 0 Warnings; strict.
- Adoption schreibt **nur** nach Bestätigung im Modal (Trockenlauf = Modal selbst); das Plugin legt **nie** Server-Einträge aus Notizen an (Spec §4.4).
- Treiber importiert die zentrale Brücke (`../../tools/obsidian-cdp/cdp.js`, `vault.js`), vendort nichts (Dach-AGENTS); `tsconfig.scripts.json` + `typecheck:scripts` wie bei `audio-interface`; Bundles (`.gui-smoke.mjs`) gitignored. Der Treiber **bringt kein Fenster nach vorn**, solange nicht `--focus` gesetzt ist (Jay arbeitet oft parallel) — Prüfungen laufen über `evaluate`, Screenshots nur mit `--focus`.
- Staging-Vault: `stagingVaultDir("calendar-notes")` (Env `STAGING_VAULTS_DIR`, Default-Hinweis `~/StagingVaults`), Fixture `fixtures/vault/` (Notizen mit **zwei** Strukturen: `Pallas/50_Ressourcen/10_Reference/10_Kontakte` + `Pallas/30_Chronos/70_Termine/10_Anstehend` mit Pallas-Profil und `Contacts/`, `Events/` mit Default-Profilen).
- Vault im laufenden Obsidian öffnen: Treiber prüft per `attachTo("workspace", port, "calendar-notes")`; fehlt das Fenster, versucht er **einmal** `ipcRenderer.sendSync("vault-open", dir, false)` über ein beliebiges anderes Obsidian-Fenster und wartet bis `readyState === "complete"` (≤ 150 s), sonst bricht er mit Anleitung ab.
- Branch `m3-adoption-smoke`; Commits deutsch mit Trailern wie bisher. Baseline: vor dem ersten Umbau am Treiber einen grünen Lauf in `docs/smoke/baseline-<datum>.md` festhalten (Lesson 2026-08-18).

---

### Task 1: Adoption-Matching (pure)

**Files:** Create `src/core/adopt/match.ts`, `src/core/adopt/phone.ts`; Test `tests/core/adopt/match.test.ts`, `tests/core/adopt/phone.test.ts`

**Interfaces:**
```ts
// phone.ts
export function normalizePhone(raw: string, defaultCountry = "49"): string | null   // Ziffern + führende 00→+, 0→+<country>; null wenn < 6 Ziffern
// match.ts
export interface ServerItem { uid: string; href: string; kind: "contact" | "event"; data: ContactData | EventData; raw: string; etag: string }
export interface CandidateNote { path: string; basename: string; frontmatter: Record<string, unknown>; body: string }
export type MatchReason = "email" | "phone" | "name" | "start+title";
export interface AdoptionSuggestion { item: ServerItem; note: CandidateNote; reason: MatchReason; confidence: "sure" | "likely" | "weak"; detail: string }
export interface MatchOptions { profile: MappingProfile; nameThreshold?: number /* 0.85 */; aliasesKey?: string /* "aliases" */ }
export function candidateNotes(notes: CandidateNote[], profile: MappingProfile): CandidateNote[]   // im Profil-Ordner (oder Unterordner), OHNE uidField, MIT onCreate.type (wenn gesetzt)
export function matchItems(items: ServerItem[], notes: CandidateNote[], opts: MatchOptions): { suggestions: AdoptionSuggestion[]; unmatchedItems: ServerItem[]; unmatchedNotes: CandidateNote[] }
export function nameSimilarity(a: string, b: string): number   // 0..1, case-/diakritik-insensitiv, Token-Jaccard + Dice auf Bigrammen, max der beiden
```
Regeln: Kontakt-Notiz-Werte aus Frontmatter über die Profil-Feldnamen (`fmKeyFor(profile,"email")`, `tel_cell/tel_home/tel_work`) **und** zusätzlich aus üblichen Keys (`email`, `mail`, `telefon`, `mobil`, `phone`, `tel`) — Adoption läuft vor dem ersten Sync, die Notizen sind handgemacht. Reihenfolge: exakte E-Mail (case-insensitiv, alle E-Mails des vCards) → `sure`; Telefon (normalisiert, alle Tels) → `sure`; Name (`fn` vs basename/`title`/`aliases`) ≥ threshold → `likely` (≥ 0.95 → `sure`), 0.7–threshold → `weak`. Termine: `start` gleich (ISO-Vergleich auf Minute; `termin_start`/`start`/`datum`+`uhrzeit` akzeptieren) **und** Titel-Ähnlichkeit ≥ 0.6 → `likely`; nur Start gleich → `weak`. Jede Notiz und jeder Item höchstens einmal (beste Konfidenz gewinnt; Ties → Item-Reihenfolge).

- [x] Tests: E-Mail-Treffer, Telefon-Treffer (`+49 171 1234567` vs `0171/1234567`), Name-fuzzy („Dr. Florian Brandes" vs „Florian Brandes"), Termin start+title, Notiz mit uidField wird nicht Kandidat, Notiz außerhalb des Ordners nicht, Eindeutigkeit (zwei Items, eine Notiz → nur bester), `nameSimilarity` Grenzfälle (leer, Umlaute/Akzente).
- [x] Implementieren; Commit `feat(adopt): Matching E-Mail → Telefon → Name / Start+Titel (pure)`.

---

### Task 2: Adoption-Plan + State-Eintrag (pure)

**Files:** Create `src/core/adopt/plan.ts`; Test `tests/core/adopt/plan.test.ts`

**Interfaces:**
```ts
export interface AdoptDecision { suggestion: AdoptionSuggestion; action: "link" | "skip" | "create" }
export interface LinkPlan { path: string; set: Record<string, FmVal> }   // uidField, sourceField, etagField, stateField:"live" (+ recurrenceIdField wenn Override — Adoption matcht nur Master)
export function planAdoption(decisions: AdoptDecision[], profile: MappingProfile, source: string): { links: LinkPlan[]; createUids: string[]; skippedUids: string[] }
export function stateAfterAdoption(state: CollectionState, links: LinkPlan[], items: ServerItem[], now: Date): CollectionState   // upsertObject je verknüpftem Item mit notePath, written = {} (leer → erster Sync schreibt alles und meldet KEINE handEdited, weil prevWritten leer), hash ""
```
- [x] Tests: link → set-Keys korrekt; skip/create Listen; `stateAfterAdoption` trägt `notes[""].path` ein und behält Snapshot.
- [x] Commit `feat(adopt): Adoptionsplan + State-Eintrag`.

---

### Task 3: Profil aus Notiz ableiten (pure)

**Files:** Create `src/core/mirror/profile-from-note.ts`; Test `tests/core/mirror/profile-from-note.test.ts`

**Interfaces:**
```ts
export function suggestProfileFromNote(kind: ProfileKind, frontmatter: Record<string, unknown>, opts: { folder: string; name: string; rand: () => number }): { profile: MappingProfile; mapped: Record<string,string>; unmapped: string[] }
```
Heuristik (case-insensitiv, Synonyme de/en): contact: `email|e-mail|mail→email`, `mobil|mobile|handy|phone_mobile→tel_cell`, `telefon|phone|tel|festnetz→tel_home`, `phone_work|telefon_arbeit|work_phone→tel_work`, `organisation|organization|org|firma|company→org`, `rolle|job_title|title(job)|position→title`, `website|url|web|homepage→url`, `adresse|address|anschrift→adr`, `geburtstag|birthday|bday→bday`, `name|title|fn→fn`; event: `termin_start|start|beginn|datum→start`, `termin_ende|end|ende→end`, `ort|location→location`, `online→online`, `teilnehmer|attendees→attendees`, `url|link→url`, `title|titel→title`, `status→status`. `onCreate` = `type` (wenn vorhanden) + `status` + `up` aus der Notiz übernehmen (Werte verbatim), `uidField` bleibt Default (`dav_uid`), **außer** die Notiz trägt `vcard_uid`/`ical_uid`/`uid` → dann dieses Feld als `uidField`. Identitäts-Kollisionen vermeiden (`validateProfile` muss `ok` sein — Test).
- [x] Tests: Pallas-Kontakt-Frontmatter (aus Spec: `organisation/rolle/email/telefon/mobil/adresse/vcard_uid/type/status/up`) → erwartete Zuordnung; Pallas-Termin (`termin_start/termin_ende/ort/online/teilnehmer/type`) ; unbekannte Keys in `unmapped`; Ergebnis validiert.
- [x] Commit `feat(mirror): Profil aus Beispielnotiz ableiten`.

---

### Task 4: Adoption-Service + Modal + Kommandos (Obsidian)

**Files:** Create `src/obsidian/adoption-modal.ts`, `src/core/adopt/service.ts` (pure bis auf Interfaces: lädt Items über `syncCollection(t, col, undefined)` mit vollem Listing — **ohne** timeRange, Adoption sieht alles — parst, ruft matchItems), Modify `src/main.ts` (Kommandos `adopt-collection`, `profile-from-note`), `src/i18n/strings.ts`, `src/obsidian/settings-tab.ts` (Button „Bestehende Notizen verknüpfen…" je Sammlung; Button „Profil aus aktueller Notiz erzeugen" im Profile-Block), `styles.css` (Tabellen-Klassen mit Theme-Variablen)

**Interfaces:**
```ts
// core/adopt/service.ts
export interface AdoptDeps { transportFor(account, password): Transport; secrets: SecretStore; stateStore: StateStore; now(): Date }
export async function loadServerItems(deps: AdoptDeps, settings: PluginSettings, collectionId: string): Promise<{ items: ServerItem[]; profile: MappingProfile; source: string; col: DavCollection }>
// obsidian/adoption-modal.ts
export class AdoptionModal extends Modal { constructor(app, input: { suggestions: AdoptionSuggestion[]; unmatchedItems: ServerItem[]; unmatchedNotes: CandidateNote[]; profile: MappingProfile }, onConfirm: (decisions: AdoptDecision[]) => Promise<void>) }
```
Modal: Kopf mit Zählern; Tabelle (Notiz · Server-Eintrag · Grund/Konfidenz · Aktion-Dropdown `link|skip|create` — Default `link` bei sure/likely, `skip` bei weak); Button „Alle sicheren übernehmen" (setzt `link` für `sure`), „Verknüpfen" (ruft onConfirm), „Abbrechen". Nicht gematchte Items: Hinweis „n neue Notizen entstehen beim nächsten Sync"; nicht gematchte Notizen: Hinweis „bleiben unberührt". `onConfirm` in main.ts: `planAdoption` → je Link `processFrontMatter` (set) → `stateAfterAdoption` → `stateStore.save` → Notice. Kommando `profile-from-note`: aktive Notiz → Kind wählen (Suggester contact/event) → `suggestProfileFromNote` → Profil in Settings anlegen → Notice mit mapped/unmapped; Settings-Tab aktualisieren.
- [x] Tests: `loadServerItems` mit Fake-Transport (Radicale-Fixtures) liefert 3 Events + 2 Kontakte; Modal: `collectDecisions()` pure Helfer (Default-Aktionen) getestet; main.ts-Verdrahtung im Smoke.
- [x] Commit `feat(obsidian): Adoption — Server-Einträge mit bestehenden Notizen verknüpfen (Modal) + Profil aus Notiz`.

---

### Task 5: Fixture-Vault

**Files:** Create `fixtures/vault/notes/**`, `fixtures/vault/obsidian/{app.json,appearance.json,core-plugins.json,community-plugins.json}`, `fixtures/vault/README.md`
Inhalt `notes/`: `Welcome.md`; Pallas-Struktur: `Pallas/50_Ressourcen/10_Reference/10_Kontakte/Alex Aguado.md` (Frontmatter wie Spec-Beispiel: `type: 👤 Kontakt`, `status: 3-evergreen 🌿`, `telefon: +34 696 386 907`, `vcard_uid: a4843c7a6d3005dd`, leere `email`), `…/10_Kontakte/ADAC.md` (Organisation, kein Server-Pendant), `Pallas/30_Chronos/70_Termine/10_Anstehend/2026-09-01 Zahnärztin.md` (`type: 📅 Termin`, `termin_start: 2026-09-01 10:00`, freier Body „Vorbereitung: Karte mitbringen"); generische Struktur: `Contacts/`, `Events/` leer (`.gitkeep` via Notiz `Contacts/_index.md`). `obsidian/`: `community-plugins.json` `["calendar-notes"]`, `app.json` `{ "promptDelete": false, "alwaysUpdateLinks": true, "showFrontmatter": true }`, `appearance.json` `{ "baseFontSize": 16 }`, `core-plugins.json` wie 3d-codeblocks-Fixture (`file-explorer`, `global-search`, `command-palette`, `page-preview`, `switcher`).
- [x] README: was das Fixture zeigt; `docs/images/fixture` ist hier **nicht** der Ort — `fixtures/vault` (Smoke-Fixture; `readme-shots` später dieselbe Quelle).
- [x] Commit `test(fixture): Staging-Vault-Fixture (Pallas-ähnlich + generisch)`.

---

### Task 6: GUI-Smoke-Treiber

**Files:** Create `scripts/gui-smoke.ts`, `tsconfig.scripts.json` (von `../audio-interface/tsconfig.scripts.json`), Modify `package.json` (`smoke:gui`, `typecheck:scripts`, `gate` + `typecheck:scripts`), `.gitignore` (`.gui-smoke.mjs`), `docs/SMOKE.md` (Prüfpunkte-Checkliste, vom Treiber gefahren)

Ablauf: Args `--port 9222`, `--vault calendar-notes`, `--keep`, `--focus`, `--section <name>`, `--setup` (baut den Staging-Vault via `buildVault({ repoRoot, vaultDir: stagingVaultDir("calendar-notes"), fixtureDir: "fixtures/vault", pluginId: "calendar-notes" })` und endet mit der Anleitung zum Öffnen) · ohne `--setup`: `attachTo("workspace", port, vault)`; fehlt es → Vault-Open-Versuch (s. Constraints) · Radicale `startRadicale({ port: 5298 })` · Prüfpunkte (jeder: Szene herstellen → messen → Protokollzeile `✔/✘ P<n> <Titel> — <Messwert>`), alle über `cdp.evaluate` gegen `app.plugins.plugins["calendar-notes"]`:
  - **P1 Laden:** Plugin geladen, `getSettingDefinitions()` liefert 5 Gruppen in Reihenfolge (über `app.setting.pluginTabs.find(t=>t.id==="calendar-notes").getSettingDefinitions()` — ggf. Tab-Instanz über `app.setting.openTabById` nur mit `--focus`).
  - **P2 Konto + Discovery:** Secret setzen, Konto anlegen, `discoverAccount` → 2 Sammlungen; Sammlungen aktivieren (Pallas-Profile aus `suggestProfileFromNote` ODER die Default-Profile — beide Varianten: `--section generic|pallas`).
  - **P3 Adoption (pallas):** `loadServerItems` + `matchItems` gegen den Fixture-Vault → Alex Aguado per Telefon `sure`, Zahnärztin per start+title `likely`, ADAC unmatched; `planAdoption`+`processFrontMatter`+State → danach Sync: Alex/Zahnärztin werden **aktualisiert**, nicht neu angelegt; freier Body „Vorbereitung…" bleibt.
  - **P4 Trockenlauf + Sync (generic):** 3+2 creates; Dateien vorhanden; Frontmatter-Keys wie erwartet.
  - **P5 Update-Pfad:** Server-PUT (Zeit+Beschreibung) → Lauf → Frontmatter neu + Body neu + `handEdited` leer.
  - **P6 Löschung:** Server-DELETE → Lauf → Datei weg (Papierkorb), `delete:trash` im Plan.
  - **P7 zweiter Discovery-Lauf:** aktivierte Sammlung bleibt aktiviert (Merge-Regel).
  - **P8 Settings-UI (nur `--focus`):** Settings-Fenster öffnen (`attachTo("settings")`), Tab `calendar-notes`, DOM enthält Konto-Unterseite + SecretComponent (`.setting-item` mit Passwort-Label) + Discovery-Button; Screenshot nach `docs/smoke/shots/` (gitignored).
  - **P9 Notices:** `notices(cdp)` nach P5 enthält keine Fehler.
  `finally`: Radicale stoppen, Notizen/State im Staging-Vault zurücksetzen (außer `--keep`).
- [x] `npm run typecheck:scripts` grün; Lauf gegen das laufende Obsidian: `npm run smoke:gui -- --section generic` und `-- --section pallas`; Ergebnis in `docs/smoke/baseline-2026-08-22.md` (Baseline) — **Wenn kein Obsidian mit Debug-Port läuft oder das Fenster fehlt und nicht geöffnet werden kann: Treiber meldet das klar; der Implementierer dokumentiert den Stand und bricht nicht ab.**
- [x] Commit `test(gui-smoke): Treiber gegen laufendes Obsidian (P1–P9) + Baseline`.

---

### Task 7: Abschluss M3 — Gate, Doku, Plan-Checkboxen, CORE-TEST-02-Zählung (Hinweis für Dach)

- [x] `npm run gate && npm run test:integration`; CHANGELOG (M3), AGENTS.md („Was M3 liefert": Adoption, Profil-aus-Notiz, `npm run smoke:gui`, Fixture), `docs/registry-kandidaten.md` (+ Adoption-Matching, + Vault-Open-Helfer), Plan-Checkboxen; Commit `docs: M3 abgeschlossen`.

## Self-Review
- Spec §4 Adoption (Kandidaten, Match-Reihenfolge, Review-Modal, nur Bestätigung schreibt, Unmatched unberührt, nie Server-Einträge aus Notizen) → T1, T2, T4 ✓; „Profil aus Notiz" → T3/T4 ✓; §6.3 Staging-Vault + GUI-Smoke + Baseline → T5, T6 ✓.
- Schnittstellen: `ServerItem/AdoptionSuggestion/AdoptDecision` (T1/T2) in T4/T6; `suggestProfileFromNote` (T3) in T4/T6; `loadServerItems` (T4) in T6; State-Eintrag via `upsertObject` (M2a) in T2.
