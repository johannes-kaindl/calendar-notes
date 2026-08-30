/**
 * GUI-Smoke-Treiber (Skill gui-smoke-setup, CORE-TEST-02 b): faehrt die Pruefpunkte aus
 * `docs/SMOKE.md` gegen ein LAUFENDES Obsidian ueber CDP — echtes Vault, echtes DAV
 * (Radicale, lokal gestartet), echtes `app.secretStorage`, echte Frontmatter-Schreibpfade.
 *
 * Voraussetzung (der eine Handgriff, der Handarbeit bleibt):
 *   osascript -e 'quit app "Obsidian"'; open -a Obsidian --args --remote-debugging-port=9222
 *   OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/calendar-notes" npm run deploy
 *
 * Aufruf:
 *   npm run smoke:gui -- --setup                  # baut den Staging-Vault aus dem Fixture neu
 *   npm run smoke:gui -- --section generic         # Standard-Profile (Contacts/Events)
 *   npm run smoke:gui -- --section pallas          # Profile aus Pallas-Notizen + Adoption
 *   npm run smoke:gui -- --section generic --focus # zusaetzlich P8 (Settings-UI, Screenshot)
 *
 * Jeder Lauf legt ein eigenes Konto + zwei Sammlungen an, benutzt Radicale auf Port 5298
 * (die produktive Kollisionsgefahr mit einem laufenden Port-5232-Radicale entfaellt damit),
 * und stellt am Ende den VORHER-Zustand des Vaults + der Plugin-Settings wieder her (Snapshot
 * vor jeder Aenderung, Restore im `finally` — s. Skill gui-smoke-setup § Aufraeumen). `--keep`
 * laesst den erzeugten Zustand stehen (zum Nachschauen).
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import {
  Cdp,
  attachTo,
  notices,
  pollUntil,
  releaseAlwaysOnTop,
  requireVisible,
} from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
import { capture, writeShot } from "../../tools/obsidian-cdp/shot.js";
import { startRadicale, type RunningServer } from "./dav-server.js";

const PLUGIN_ID = "calendar-notes";
const RADICALE_PORT = 5298;
const ACCOUNT_ID = "acc-smoke";
const SECRET_ID = `calendar-notes-${ACCOUNT_ID}`;

// Erwartete Reihenfolge der 6 benannten Settings-Gruppen (getSettingDefinitions() in
// settings-tab.ts: accountsGroup, collectionsGroup, profilesGroup, syncGroup, displayGroup,
// actionsGroup) — aus src/i18n/strings.ts, Schluessel `settings.*.heading`, DE und EN, weil
// `initI18n` in main.ts auf `getLanguage()` faellt (systemabhaengig, im Treiber nicht erzwingbar).
//
// Stand 0.1.9 (Settings-Ueberarbeitung aus dem Erstkontakt-Befund, docs/ux/2026-08-29-*):
// sechs Gruppen statt fuenf, und drei sind umbenannt. Diese Listen sind bewusst woertlich —
// P1 SOLL rot werden, wenn sich die Oberfläche aendert; er hat es getan, nur hat den Lauf
// zwischen dem 23.08. und heute niemand gefahren. Wer eine Ueberschrift aendert, zieht hier nach.
const SETTING_HEADINGS_DE = ["Konten", "Kalender & Adressbücher", "Profile — welches Feld gehört wohin", "Abgleich", "Darstellung", "Aktionen"];
const SETTING_HEADINGS_EN = ["Accounts", "Calendars & address books", "Profiles — which field goes where", "Sync", "Appearance", "Actions"];

// `settings.accounts.testButton` aus src/i18n/strings.ts, DE + EN — P8 matcht den
// Discovery-Button exakt gegen dieses Label, statt per Substring-Regex zu raten.
const DISCOVER_BUTTON_LABELS = ["Test connection & find collections", "Verbindung testen & Sammlungen finden"];

const ACCOUNT_NAME = "Smoke";

// `import.meta.url` zeigt nach dem esbuild-Buendeln auf `.gui-smoke.mjs` — das liegt im
// Repo-Root (esbuild schreibt dorthin, `outfile` ohne Pfadpraefix), NICHT in `scripts/`.
// Ein `resolve(HERE, "..")` waere deshalb ein Verzeichnis zu hoch (wie bei `dav-server.ts`s
// eigenem `import.meta.url`, s. Kommentar dort) — hier reicht HERE direkt als Repo-Wurzel.
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

const ALEX_PATH = "Pallas/50_Ressourcen/10_Reference/10_Kontakte/Alex Aguado.md";
const ADAC_PATH = "Pallas/50_Ressourcen/10_Reference/10_Kontakte/ADAC.md";
const ZAHN_PATH = "Pallas/30_Chronos/70_Termine/10_Anstehend/2026-09-01 Zahnärztin.md";
const KONTAKTE_FOLDER = "Pallas/50_Ressourcen/10_Reference/10_Kontakte";
const ANSTEHEND_FOLDER = "Pallas/30_Chronos/70_Termine/10_Anstehend";

interface Check {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}
const checks: Check[] = [];
function record(id: string, name: string, passed: boolean, detail: string): void {
  checks.push({ id, name, passed, detail });
  console.log(`${passed ? "✔" : "✘"} ${id} ${name} — ${detail}`);
}

// Fuer Pruefpunkte, die (noch) keinen programmatischen Pfad haben — zaehlt NICHT in
// checks/exitCode mit (kein Rot fuer etwas, das strukturell fehlt statt kaputt zu sein),
// erscheint aber sichtbar im Protokoll. Seit Fix-Runde 1 (Punkt 0) hat P12 selbst wieder
// einen programmatischen Pfad (`checkP12`) und ruft das hier nicht mehr auf — bleibt als
// Infrastruktur fuer kuenftige Pruefpunkte ohne headless-Pfad stehen.
function recordSkip(id: string, name: string, reason: string): void {
  console.log(`⚠ ${id} ${name} — übersprungen: ${reason}`);
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v ?? def;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// Der Ort wird ueber `stagingVaultDir()` aufgeloest, nicht selbst zusammengebaut — Dach-Regel
// (obsidian-plugins/AGENTS.md § Staging-Vaults). Der fruehere Fallback auf
// `~/StagingVaults/calendar-notes` ist ersatzlos weg, und zwar nicht aus Ordnungsliebe: er zeigte
// seit dem 2026-08-30 auf ein Verzeichnis, das es nicht mehr gibt, und `buildVault` haette es
// stillschweigend NEU angelegt — der Lauf misst dann gegen ein leeres Fixture, waehrend der echte
// Vault danebenliegt. Genau diese Sorte Default hat den Drift erzeugt, den das Dach an dem Tag
// aufloeste (18 Vaults in zwei konkurrierenden Basen). Fehlt die Variable, wirft `stagingVaultDir`
// mit Anleitung; `--vault-dir <pfad>` bleibt als bewusster Einzelfall-Override.
function resolveVaultDir(): string {
  return arg("vault-dir", "") || stagingVaultDir(PLUGIN_ID);
}

async function waitForWorkspaceWindow(port: number, vault: string, timeoutMs: number): Promise<Cdp | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const c = await attachTo("workspace", port, vault);
      if (c) return c;
    } catch {
      // Debug-Port noch nicht wieder da — weiterversuchen bis zur Frist.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

// ── --setup: Vault aus dem Fixture neu bauen ────────────────────────────────
async function runSetup(port: number, vault: string): Promise<void> {
  const vaultDir = resolveVaultDir();
  const log = buildVault({
    repoRoot: REPO_ROOT,
    vaultDir,
    fixtureDir: join(REPO_ROOT, "fixtures/vault"),
    pluginId: PLUGIN_ID,
  });
  for (const line of log) console.log(`  ${line}`);
  console.log(`\nVault gebaut unter ${vaultDir}.`);

  const before = await attachTo("workspace", port, vault).catch(() => null);
  if (before) {
    console.log(`Fenster "${vault}" ist bereits offen — loese app:reload aus, damit Notizen + Plugin frisch geladen werden.`);
    try {
      await before.evaluate(`app.commands.executeCommandById("app:reload"); return true;`);
    } catch (e) {
      console.log(`  app:reload fehlgeschlagen (${e instanceof Error ? e.message : String(e)}) — bitte manuell neu laden.`);
    }
    before.close();
    console.log("Warte, bis das Fenster wieder verbunden werden kann …");
    const back = await waitForWorkspaceWindow(port, vault, 30_000);
    if (back) {
      console.log("Fenster ist zurueck.");
      back.close();
    } else {
      console.log("Fenster kam in 30s nicht zurueck (Timeout) — vor dem naechsten Lauf manuell pruefen.");
    }
  } else {
    console.log(
      `Kein offenes Fenster fuer "${vault}" gefunden. In Obsidian oeffnen (z. B. ueber ` +
        `"Open folder as vault" oder aus einem anderen Fenster via ` +
        `window.electron.ipcRenderer.sendSync("vault-open", ${JSON.stringify(vaultDir)}, false)), ` +
        `dann erneut mit --section starten.`,
    );
  }
}

// ── Vault-Snapshot/Restore (Notizen) — funktioniert fuer jeden Abschnitt gleich ────────────
async function snapshotVault(cdp: Cdp): Promise<Record<string, string>> {
  return cdp.evaluate<Record<string, string>>(
    `
    const out = {};
    for (const f of app.vault.getMarkdownFiles()) out[f.path] = await app.vault.cachedRead(f);
    return out;
  `,
  );
}

async function restoreVault(cdp: Cdp, snapshot: Record<string, string>): Promise<void> {
  await cdp.evaluate(`
    const snap = ${JSON.stringify(snapshot)};
    const current = app.vault.getMarkdownFiles();
    for (const f of current) {
      if (!(f.path in snap)) await app.fileManager.trashFile(f);
    }
    for (const path of Object.keys(snap)) {
      const f = app.vault.getAbstractFileByPath(path);
      if (f) {
        const cur = await app.vault.cachedRead(f);
        if (cur !== snap[path]) await app.vault.modify(f, snap[path]);
      } else {
        await app.vault.create(path, snap[path]);
      }
    }
    return true;
  `);
}

async function snapshotState(cdp: Cdp): Promise<string[]> {
  return cdp.evaluate<string[]>(
    `
    const dir = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].manifest.dir + "/state";
    if (!(await app.vault.adapter.exists(dir))) return [];
    const listing = await app.vault.adapter.list(dir);
    return listing.files ?? [];
  `,
  );
}

async function pruneNewState(cdp: Cdp, before: string[]): Promise<void> {
  await cdp.evaluate(`
    const dir = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].manifest.dir + "/state";
    if (await app.vault.adapter.exists(dir)) {
      const listing = await app.vault.adapter.list(dir);
      const before = ${JSON.stringify(before)};
      for (const f of listing.files ?? []) if (!before.includes(f)) await app.vault.adapter.remove(f);
    }
    return true;
  `);
}

// ── Konto + Discovery (P2) ──────────────────────────────────────────────────
async function seedAccount(cdp: Cdp, radicale: RunningServer): Promise<void> {
  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const account = {
      id: ${JSON.stringify(ACCOUNT_ID)},
      name: ${JSON.stringify(ACCOUNT_NAME)},
      baseUrl: ${JSON.stringify(radicale.baseUrl)},
      username: ${JSON.stringify(radicale.user)},
      secretId: ${JSON.stringify(SECRET_ID)},
    };
    plugin.settings = { ...plugin.settings, accounts: [...plugin.settings.accounts, account] };
    await plugin.saveSettings();
    app.secretStorage.setSecret(${JSON.stringify(SECRET_ID)}, ${JSON.stringify(radicale.pass)});
    return true;
  `);
}

interface DiscoverInfo {
  collections: number;
  warnings: number;
  calendarId: string;
  addressbookId: string;
}

async function discoverAndMerge(cdp: Cdp): Promise<DiscoverInfo> {
  return cdp.evaluate<DiscoverInfo>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const account = plugin.settings.accounts.find((a) => a.id === ${JSON.stringify(ACCOUNT_ID)});
    const result = await plugin.discoverAccount(account);
    plugin.settingTab.mergeDiscoveredCollections(account, result);
    const cal = plugin.settings.collections.find((c) => c.accountId === account.id && c.kind === "calendar");
    const ab = plugin.settings.collections.find((c) => c.accountId === account.id && c.kind === "addressbook");
    return {
      collections: result.collections.length,
      warnings: result.warnings.length,
      calendarId: cal ? cal.id : "",
      addressbookId: ab ? ab.id : "",
    };
  `,
  );
}

// ── P1: Laden ────────────────────────────────────────────────────────────
async function checkP1(cdp: Cdp): Promise<void> {
  try {
    const cmds = await cdp.evaluate<string[]>(
      `return Object.keys(app.commands.commands).filter((k) => k.startsWith(${JSON.stringify(PLUGIN_ID + ":")})).sort();`,
    );
    const headings = await cdp.evaluate<(string | undefined)[] | null>(
      `
      const tab = app.setting?.pluginTabs?.find?.((t) => t.id === ${JSON.stringify(PLUGIN_ID)});
      if (!tab || typeof tab.getSettingDefinitions !== "function") return null;
      return tab.getSettingDefinitions().map((d) => d.heading);
    `,
    );
    // Nicht jede Definition traegt eine Ueberschrift: Einzel-Settings zwischen den Gruppen
    // liefern `undefined`/`null`. Verglichen werden deshalb nur die BENANNTEN Gruppen, in ihrer
    // Reihenfolge — sonst scheitert der Vergleich schon an der Laenge und sagt nichts ueber die
    // Namen aus (gemessen 2026-08-30: 8 Definitionen, davon 6 benannt).
    const named = Array.isArray(headings) ? headings.filter((h): h is string => typeof h === "string" && h.length > 0) : null;
    const matchesOrder = (expected: string[]): boolean => named !== null && named.length === expected.length && expected.every((h, i) => named[i] === h);
    const headingsOk = matchesOrder(SETTING_HEADINGS_DE) || matchesOrder(SETTING_HEADINGS_EN);
    // Seit M4 (Task 6) kommen 5 weitere Kommandos dazu (run-on-note/new-event/new-contact/
    // undo-last-change/push-hand-edits, s. main.ts registerCommands()) — 5 aus M1-M3 + 5 neu = 10.
    const ok = cmds.length === 10 && headingsOk;
    record("P1", "Laden", ok, `${cmds.length} Kommandos, benannte Settings-Gruppen: ${JSON.stringify(named)} (erwartet DE ${JSON.stringify(SETTING_HEADINGS_DE)} oder EN ${JSON.stringify(SETTING_HEADINGS_EN)})`);
  } catch (e) {
    record("P1", "Laden", false, e instanceof Error ? e.message : String(e));
  }
}

// ── P2: Konto + Discovery ────────────────────────────────────────────────
async function checkP2(info: DiscoverInfo, variant: "generic" | "pallas"): Promise<void> {
  const ok = info.collections === 2 && info.warnings === 0 && info.calendarId !== "" && info.addressbookId !== "";
  record("P2", `Konto+Discovery (${variant})`, ok, `${info.collections} Sammlungen, ${info.warnings} Warnungen`);
}

// ── P3: Adoption (nur --section pallas) ─────────────────────────────────
interface ProfileIds {
  contact: string;
  event: string;
}

async function createPallasProfiles(cdp: Cdp): Promise<ProfileIds> {
  return cdp.evaluate<ProfileIds>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const alex = app.vault.getAbstractFileByPath(${JSON.stringify(ALEX_PATH)});
    const zahn = app.vault.getAbstractFileByPath(${JSON.stringify(ZAHN_PATH)});
    if (!alex || !zahn) throw new Error("Fixture-Notizen fehlen (Pallas Alex Aguado / Zahnärztin) — --setup gelaufen?");
    await plugin.createProfileFromNote("contact", alex);
    await plugin.createProfileFromNote("event", zahn);
    const profiles = plugin.settings.profiles;
    return { contact: profiles[profiles.length - 2].id, event: profiles[profiles.length - 1].id };
  `,
  );
}

async function wirePallasCollections(cdp: Cdp, ids: ProfileIds): Promise<void> {
  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    plugin.settings = {
      ...plugin.settings,
      collections: plugin.settings.collections.map((c) => ({
        ...c,
        enabled: true,
        profileId: c.kind === "addressbook" ? ${JSON.stringify(ids.contact)} : ${JSON.stringify(ids.event)},
      })),
    };
    await plugin.saveSettings();
    return true;
  `);
}

/** Oeffnet die AdoptionModal fuer eine Sammlung und bestaetigt sie mit den VORBELEGTEN
 *  Aktionen (sure/likely -> link, weak -> skip, s. `defaultAction` in adoption-modal.ts) —
 *  ohne Dropdowns umzustellen, klickt also exakt das, was ein Mensch mit "Verknuepfen" ohne
 *  weitere Eingriffe bekaeme. */
async function runAdoption(cdp: Cdp, collectionId: string): Promise<void> {
  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    await plugin.startAdoption(${JSON.stringify(collectionId)});
    return true;
  `);
  const opened = await pollUntil<boolean>(cdp, `return !!document.querySelector(".modal-container .mod-cta") || null;`, 15_000, 300);
  if (!opened) throw new Error(`Adoptions-Modal fuer Sammlung ${collectionId} ist nicht erschienen`);
  await cdp.evaluate(`document.querySelector(".modal-container .mod-cta").click(); return true;`);
  const closed = await pollUntil<boolean>(cdp, `return !document.querySelector(".modal-container") || null;`, 8_000, 200);
  if (!closed) throw new Error("Adoption-Modal schließt nicht (8 s)");
}

async function readFrontmatter(cdp: Cdp, path: string): Promise<Record<string, unknown>> {
  return cdp.evaluate<Record<string, unknown>>(
    `
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    if (!f) return {};
    return app.metadataCache.getFileCache(f)?.frontmatter ?? {};
  `,
  );
}

async function checkP3(cdp: Cdp, info: DiscoverInfo): Promise<void> {
  await runAdoption(cdp, info.addressbookId);
  const noticesAfterContacts = await notices(cdp);
  await runAdoption(cdp, info.calendarId);
  const noticesAfterEvents = await notices(cdp);

  const alex = await readFrontmatter(cdp, ALEX_PATH);
  const adac = await readFrontmatter(cdp, ADAC_PATH);
  const zahn = await readFrontmatter(cdp, ZAHN_PATH);

  // Auf den TATSAECHLICHEN Server-UID-Wert pruefen, nicht nur auf Schluesselpraesenz — Alex
  // Aguado.md traegt im Fixture (Plan-Vorgabe) bereits ein `vcard_uid`, das NICHT der echten
  // c4.vcf-UID entspricht; ein reiner Schluessel-Check waere hier ein falsches Gruen.
  const alexLinked = alex["vcard_uid"] === "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001" || alex["dav_uid"] === "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001";
  const zahnLinked = zahn["dav_uid"] === "simple-1@test";
  const adacUntouched = !Object.keys(adac).some((k) => k.startsWith("dav_") || k === "vcard_uid");
  const noErrors = !/fail|fehlgeschlagen|failed/i.test(noticesAfterContacts) && !/fail|fehlgeschlagen|failed/i.test(noticesAfterEvents);

  const ok = alexLinked && zahnLinked && adacUntouched && noErrors;
  record(
    "P3",
    "Adoption (pallas)",
    ok,
    `Alex verknuepft=${alexLinked}, Zahnärztin verknuepft=${zahnLinked}, ADAC unberuehrt=${adacUntouched}; ` +
      `Notices: "${noticesAfterContacts}" | "${noticesAfterEvents}"`,
  );

  // Sync danach: Alex/Zahnärztin werden AKTUALISIERT, nicht neu angelegt — freier Body bleibt.
  // "Nicht neu angelegt" heisst konkret: die Markdown-Dateizahl unter den beiden Pallas-Ordnern
  // aendert sich nicht (ein Fehlschlag der Verknuepfung wuerde sonst eine Datei mit
  // Suffix — "Alex Aguado 1.md" — anlegen, ohne dass alexExists/zahnExists das je bemerken).
  const countFn = `
    const countMd = (folder) => app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + "/")).length;
  `;
  const before = await cdp.evaluate<{ kontakteCount: number; anstehendCount: number; zahnBody: string }>(
    `
    ${countFn}
    const zahn = app.vault.getAbstractFileByPath(${JSON.stringify(ZAHN_PATH)});
    return {
      kontakteCount: countMd(${JSON.stringify(KONTAKTE_FOLDER)}),
      anstehendCount: countMd(${JSON.stringify(ANSTEHEND_FOLDER)}),
      zahnBody: zahn ? await app.vault.cachedRead(zahn) : "",
    };
  `,
  );
  const sync = await cdp.evaluate<{ created: number; updated: number; ok: boolean }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll();
    return {
      created: r.collections.reduce((n, c) => n + c.counts.created, 0),
      updated: r.collections.reduce((n, c) => n + c.counts.updated, 0),
      ok: r.collections.every((c) => c.ok),
    };
  `,
  );
  const after = await cdp.evaluate<{ kontakteCount: number; anstehendCount: number; zahnBody: string }>(
    `
    ${countFn}
    const zahn = app.vault.getAbstractFileByPath(${JSON.stringify(ZAHN_PATH)});
    return {
      kontakteCount: countMd(${JSON.stringify(KONTAKTE_FOLDER)}),
      anstehendCount: countMd(${JSON.stringify(ANSTEHEND_FOLDER)}),
      zahnBody: zahn ? await app.vault.cachedRead(zahn) : "",
    };
  `,
  );
  // Die drei UNVERKNUEPFTEN Server-Objekte (Florian Brandes, Weihnachten, Teamrunde) legen
  // legitim neue Notizen an — und zwar in genau diesen beiden Ordnern (das Profil aus
  // `createProfileFromNote` uebernimmt den Ordner der Beispielnotiz woertlich). Ein flaches
  // "Anzahl bleibt gleich" waere hier ein falsches Rot. Die scharfe Kondition ist: der
  // Gesamtzuwachs ueber beide Ordner entspricht GENAU `sync.created` — jede zusaetzliche
  // Datei (z. B. "Alex Aguado 1.md" durch einen fehlgeschlagenen Link) würde die Summe ueber
  // diese erwartete Zahl hinaus treiben.
  const kontakteDelta = after.kontakteCount - before.kontakteCount;
  const anstehendDelta = after.anstehendCount - before.anstehendCount;
  const noExtraFileForLinked = kontakteDelta + anstehendDelta === sync.created;
  const bodyKept = after.zahnBody.includes("Vorbereitung");
  const syncOk = sync.ok && sync.updated >= 2 && noExtraFileForLinked && bodyKept;
  record(
    "P3b",
    "Sync nach Adoption aktualisiert statt neu anzulegen",
    syncOk,
    `created=${sync.created} updated=${sync.updated}, Dateizahl Kontakte ${before.kontakteCount}→${after.kontakteCount} (Δ${kontakteDelta}), ` +
      `Anstehend ${before.anstehendCount}→${after.anstehendCount} (Δ${anstehendDelta}), Summe Δ == created=${noExtraFileForLinked}, ` +
      `Body "Vorbereitung…" erhalten=${bodyKept}`,
  );
}

// ── P4-P7: Trockenlauf/Sync/Update/Loeschung/2. Discovery (--section generic) ────────
async function checkP4(cdp: Cdp): Promise<void> {
  const dry = await cdp.evaluate<{ created: number; ok: boolean }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll({ dryRun: true });
    return { created: r.collections.reduce((n, c) => n + c.counts.created, 0), ok: r.collections.every((c) => c.ok) };
  `,
  );
  record("P4a", "Trockenlauf (3+2 creates)", dry.created === 5 && dry.ok, `${dry.created} creates im Trockenlauf`);

  const real = await cdp.evaluate<{ created: number; ok: boolean }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll();
    return { created: r.collections.reduce((n, c) => n + c.counts.created, 0), ok: r.collections.every((c) => c.ok) };
  `,
  );
  const files = await cdp.evaluate<{ events: number; contacts: number; fmKeys: string[] }>(
    `
    const ev = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Events/") && f.basename !== "_index");
    const co = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Contacts/") && f.basename !== "_index");
    const fm = ev[0] ? Object.keys(app.metadataCache.getFileCache(ev[0])?.frontmatter ?? {}) : [];
    return { events: ev.length, contacts: co.length, fmKeys: fm };
  `,
  );
  const ok = real.created === 5 && real.ok && files.events === 3 && files.contacts === 2;
  record(
    "P4b",
    "Sync legt Dateien mit Frontmatter an",
    ok,
    `${real.created} creates, Events/=${files.events} Contacts/=${files.contacts}, FM-Keys: ${files.fmKeys.join(", ")}`,
  );
}

function davAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function davPut(radicale: RunningServer, relPath: string, body: string, contentType: string): Promise<number> {
  const url = new URL(relPath, radicale.baseUrl).toString();
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType, Authorization: davAuthHeader(radicale.user, radicale.pass) },
    body,
  });
  return res.status;
}

async function davDelete(radicale: RunningServer, relPath: string): Promise<number> {
  const url = new URL(relPath, radicale.baseUrl).toString();
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: davAuthHeader(radicale.user, radicale.pass) } });
  return res.status;
}

async function davGet(radicale: RunningServer, relPath: string): Promise<{ status: number; body: string }> {
  const url = new URL(relPath, radicale.baseUrl).toString();
  const res = await fetch(url, { headers: { Authorization: davAuthHeader(radicale.user, radicale.pass) } });
  return { status: res.status, body: await res.text() };
}

const UPDATED_SIMPLE_1 = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//DE
BEGIN:VEVENT
UID:simple-1@test
DTSTAMP:20260801T100000Z
DTSTART;TZID=Europe/Berlin:20260901T113000
DTEND;TZID=Europe/Berlin:20260901T130000
SUMMARY:Zahnärztin Dr. Müller
LOCATION:Praxis am Markt\\, Hauptstraße 1
DESCRIPTION:Kontrolle NEU\\nBitte fruehzeitig kommen
URL:https://example.test/termin
STATUS:CONFIRMED
CATEGORIES:arzt,privat
SEQUENCE:3
LAST-MODIFIED:20260803T090000Z
X-CUSTOM-KEEP:ja
END:VEVENT
END:VCALENDAR
`;

async function checkP5(cdp: Cdp, radicale: RunningServer): Promise<void> {
  const status = await davPut(radicale, "test/kalender/simple-1.ics", UPDATED_SIMPLE_1, "text/calendar; charset=utf-8");
  if (status < 200 || status >= 300) {
    record("P5", "Update-Pfad (Server-PUT)", false, `PUT simple-1.ics → HTTP ${status}`);
    return;
  }
  const before = await cdp.evaluate<{ etag: string; body: string } | null>(
    `
    const ev = app.vault.getMarkdownFiles().find((f) => f.path.startsWith("Events/") && f.basename !== "_index" && f.basename.includes("Zahn"));
    if (!ev) return null;
    return { etag: String(app.metadataCache.getFileCache(ev)?.frontmatter?.["dav_etag"] ?? ""), body: await app.vault.cachedRead(ev) };
  `,
  );

  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    await plugin.runAll();
    return true;
  `);
  // `plugin.runAll()` ist im Browser bereits vollstaendig durchgelaufen, aber `metadataCache`
  // aktualisiert `dav_etag` ueber einen eigenen (asynchronen) Vault-Watcher-Zyklus — ein blindes
  // setTimeout(500) hat das geraten statt geprueft. Stattdessen: pollen, bis die Kondition
  // eintrifft (etag hat sich vom Vorher-Stand geloest), Ergebnis fliesst unten in `ok` ein.
  const etagSettled = await pollUntil<boolean>(
    cdp,
    `
    const ev = app.vault.getMarkdownFiles().find((f) => f.path.startsWith("Events/") && f.basename !== "_index" && f.basename.includes("Zahn"));
    const etag = ev ? String(app.metadataCache.getFileCache(ev)?.frontmatter?.["dav_etag"] ?? "") : "";
    return etag !== "" && etag !== ${JSON.stringify(before?.etag ?? "")} || null;
  `,
    5_000,
    200,
  );
  const noticesAfter = await notices(cdp);

  const after = await cdp.evaluate<{ etag: string; body: string; updated: number; handEdited: number } | null>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const last = plugin.service.lastResult();
    const ev = app.vault.getMarkdownFiles().find((f) => f.path.startsWith("Events/") && f.basename !== "_index" && f.basename.includes("Zahn"));
    if (!ev || !last) return null;
    return {
      etag: String(app.metadataCache.getFileCache(ev)?.frontmatter?.["dav_etag"] ?? ""),
      body: await app.vault.cachedRead(ev),
      updated: last.collections.reduce((n, c) => n + c.counts.updated, 0),
      handEdited: last.collections.reduce((n, c) => n + c.handEdited.length, 0),
    };
  `,
  );

  const etagChanged = !!before && !!after && before.etag !== after.etag && after.etag !== "";
  const bodyChanged = !!before && !!after && before.body !== after.body && /NEU/.test(after.body);
  const noErrorNotices = !/EXCEPTION|ERROR|fehlgeschlagen|failed/i.test(noticesAfter);
  const ok = !!etagSettled && !!after && etagChanged && bodyChanged && after.updated >= 1 && after.handEdited === 0 && noErrorNotices;
  record(
    "P5",
    "Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer)",
    ok,
    `etagSettled(pollUntil)=${!!etagSettled}, etag ${before?.etag ?? "?"} → ${after?.etag ?? "?"}, updated=${after?.updated ?? "?"}, handEdited=${after?.handEdited ?? "?"}, Notices: "${noticesAfter}"`,
  );
  record("P9", "Notices nach P5 ohne Fehler", noErrorNotices, `"${noticesAfter}"`);
}

async function checkP6(cdp: Cdp, radicale: RunningServer): Promise<void> {
  const before = await cdp.evaluate<number>( `return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Events/") && f.basename !== "_index").length;`);
  const status = await davDelete(radicale, "test/kalender/allday-1.ics");
  if (status < 200 || status >= 300) {
    record("P6", "Loeschung (Server-DELETE)", false, `DELETE allday-1.ics → HTTP ${status}`);
    return;
  }
  const planned = await cdp.evaluate<boolean>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll({ dryRun: true });
    return r.collections.some((c) => c.plans.some((p) => p.op === "delete" && p.mode === "trash"));
  `,
  );
  await cdp.evaluate(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    await plugin.service.runAll();
    return true;
  `,
  );
  const after = await cdp.evaluate<number>( `return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Events/") && f.basename !== "_index").length;`);
  const ok = planned && before - after === 1;
  record("P6", "Loeschung (Papierkorb, delete:trash im Plan)", ok, `Events/ ${before} → ${after}, delete:trash im Trockenlauf-Plan=${planned}`);
}

async function checkP7(cdp: Cdp): Promise<void> {
  const result = await cdp.evaluate<{ enabledBefore: number; enabledAfter: number; collections: number }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const account = plugin.settings.accounts.find((a) => a.id === ${JSON.stringify(ACCOUNT_ID)});
    const enabledBefore = plugin.settings.collections.filter((c) => c.accountId === account.id && c.enabled).length;
    const result = await plugin.discoverAccount(account);
    plugin.settingTab.mergeDiscoveredCollections(account, result);
    const enabledAfter = plugin.settings.collections.filter((c) => c.accountId === account.id && c.enabled).length;
    return { enabledBefore, enabledAfter, collections: result.collections.length };
  `,
  );
  const ok = result.collections === 2 && result.enabledBefore === result.enabledAfter && result.enabledAfter === 2;
  record("P7", "Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel)", ok, `aktiviert vorher=${result.enabledBefore} nachher=${result.enabledAfter}`);
}

// ── P10-P13: Kommandos ueber die Plugin-API (--section generic, Task 8) ─────────────────
// Alle vier laufen gegen dasselbe Objekt `simple-1@test` (die Zahnärztin-Termin-Notiz aus dem
// Fixture, bereits von P4 angelegt) — `source` wird aus der von P2 discoverten Kalender-Sammlung
// gebildet (`sourceOf` in src/core/settings.ts: `${accountId}/${collectionId}`), NICHT hart
// codiert, weil die Sammlungs-ID pro Lauf neu vergeben wird.

async function checkP10(cdp: Cdp, radicale: RunningServer, source: string): Promise<void> {
  const uid = "simple-1@test";
  const target = { uid, source };
  const result = await cdp.evaluate<{ planOk: boolean; planError?: string; execOk: boolean; execError?: string }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const plan = await plugin.api.plan("event.move", { start: "2026-09-03T09:00:00", end: "2026-09-03T10:00:00", tzid: "Europe/Berlin" }, ${JSON.stringify(target)});
    if ("error" in plan) return { planOk: false, planError: plan.error, execOk: false };
    const exec = await plugin.api.execute(plan);
    if ("error" in exec) return { planOk: true, execOk: false, execError: exec.error };
    return { planOk: true, execOk: !!exec.ok };
  `,
  );
  const get = await davGet(radicale, "test/kalender/simple-1.ics");
  const serverMoved = get.status === 200 && /DTSTART[^\n]*20260903T090000/.test(get.body);
  const fmMoved = await pollUntil<boolean>(
    cdp,
    `
    const ev = app.vault.getMarkdownFiles().find((f) => f.path.startsWith("Events/") && app.metadataCache.getFileCache(f)?.frontmatter?.["dav_uid"] === ${JSON.stringify(uid)});
    const start = ev ? String(app.metadataCache.getFileCache(ev)?.frontmatter?.["start"] ?? "") : "";
    return start.startsWith("2026-09-03") || null;
  `,
    5_000,
    200,
  );
  const ok = result.planOk && result.execOk && serverMoved && !!fmMoved;
  record(
    "P10",
    "Kommando via API (event.move)",
    ok,
    `plan=${result.planOk} exec=${result.execOk}${result.execError ? ` (${result.execError})` : ""}, Server-GET moved=${serverMoved} (HTTP ${get.status}), Frontmatter moved=${!!fmMoved}`,
  );
}

async function checkP11(cdp: Cdp, radicale: RunningServer, source: string): Promise<void> {
  const uid = "simple-1@test";
  const target = { uid, source };
  const result = await cdp.evaluate<{
    planOk: boolean;
    inviteRoute?: string;
    execOk: boolean;
    execError?: string;
    route?: string;
    icsHasMethod?: boolean;
    icsHasAttendee?: boolean;
    icsSample?: string;
  }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const plan = await plugin.api.plan("event.add-attendee", { email: "kim@example.test", name: "Kim" }, ${JSON.stringify(target)});
    if ("error" in plan) return { planOk: false, execOk: false, icsSample: "plan-error:" + plan.error };
    const exec = await plugin.api.execute(plan);
    if ("error" in exec) return { planOk: true, inviteRoute: plan.inviteRoute, execOk: false, execError: exec.error };
    const ics = exec.invite?.ics ?? "";
    return {
      planOk: true,
      inviteRoute: plan.inviteRoute,
      execOk: !!exec.ok,
      route: exec.invite?.route,
      icsHasMethod: ics.includes("METHOD:REQUEST"),
      // RFC5545-Zeilenfaltung entfalten (CRLF/LF + Leerzeichen/Tab) — eine lange ATTENDEE-Zeile
      // (CN + PARTSTAT + ROLE + RSVP) bricht bei 75 Oktetten oft genau vor "mailto:", die
      // E-Mail landet dann auf der naechsten physischen Zeile.
      icsHasAttendee: /ATTENDEE[^\\n]*kim@example\\.test/i.test(ics.replace(/\\r?\\n[ \\t]/g, "")),
      icsSample: ics,
    };
  `,
  );
  const get = await davGet(radicale, "test/kalender/simple-1.ics");
  const unfold = (ics: string): string => ics.replace(/\r?\n[ \t]/g, "");
  const serverHasAttendee = get.status === 200 && /ATTENDEE[^\n]*kim@example\.test/i.test(unfold(get.body));
  const ok =
    result.planOk &&
    result.execOk &&
    result.inviteRoute === "ics" &&
    result.route === "ics" &&
    !!result.icsHasMethod &&
    !!result.icsHasAttendee &&
    serverHasAttendee;
  if (!ok) console.log("DEBUG P11 icsSample:\n" + (result.icsSample ?? "") + "\nDEBUG P11 server body:\n" + get.body);
  record(
    "P11",
    "Einladung ohne Scheduling/Transport (Route ics)",
    ok,
    `plan.inviteRoute=${result.inviteRoute}, exec.invite.route=${result.route}, METHOD:REQUEST=${result.icsHasMethod}, ATTENDEE kim im .ics=${result.icsHasAttendee}, Server hat ATTENDEE=${serverHasAttendee}${result.execError ? `, execError=${result.execError}` : ""}`,
  );
}

/** Extrahiert den DTSTART-Zeitwert (Ganzzahl `YYYYMMDDTHHMMSS`) aus einem VEVENT — verwendet
 *  von P10/P12, um den Server-Stand VOR/NACH einer Aenderung zu vergleichen, ohne einen
 *  Fixture-Wert hart zu codieren (`simple-1@test` kann zu Laufzeitbeginn bereits vom
 *  frueher gelaufenen P5-Update abweichen, s. Kommentar bei `checkP12`). */
function extractDtstart(ics: string): string | undefined {
  // NUR innerhalb des VEVENT suchen — ein VTIMEZONE traegt in seinen STANDARD/DAYLIGHT-
  // Unterkomponenten ebenfalls ein `DTSTART` (die Regelbeginn-Zeit der Zeitzonenregel, z. B.
  // `DTSTART:20001029T040000`), das sonst als erstes trifft und die Fixture-DTSTART verdeckt.
  const vevent = /BEGIN:VEVENT[\s\S]*?END:VEVENT/.exec(ics)?.[0] ?? ics;
  return /DTSTART[^\n]*:(\d{8}T\d{6})/.exec(vevent)?.[1];
}

// P12 (Undo): seit Fix-Runde 1 (Punkt 0, `src/core/commands/undo.ts::UNDO_LAST_COMMAND`) ist
// `undo.last` ein regulaerer Registry-Eintrag und damit ueber `plugin.api.plan("undo.last", …)`
// erreichbar — kein Sonderpfad mehr noetig. Laeuft bewusst DIREKT NACH P10 (nicht nach P11):
// P10 verschiebt `simple-1@test`, wodurch `state.objects[…].history[0]` genau den
// VOR-P10-Stand traegt — der Undo-Plan stellt den VOR-P10-DTSTART wieder her. `beforeDtstart`
// wird vom Aufrufer VOR `checkP10` gemessen (nicht aus der Fixture geraten): P5 laeuft in
// derselben Sektion vorher und aendert `simple-1.ics` bereits einmal serverseitig — die
// Fixture-Zeit `20260901T100000` ist zum Zeitpunkt von P10/P12 also NICHT mehr der Ist-Stand.
// Liefe P12 erst NACH P11 (Teilnehmer-Zusage), waere das letzte Verlauf-Element die
// Attendee-Aenderung, nicht mehr die Verschiebung — der Test bliebe gueltig, aber "DTSTART
// zurueck auf VOR-P10" nicht mehr die richtige Formulierung.
async function checkP12(cdp: Cdp, radicale: RunningServer, source: string, beforeDtstart: string | undefined): Promise<void> {
  const uid = "simple-1@test";
  const target = { uid, source };
  const result = await cdp.evaluate<{ planOk: boolean; planError?: string; execOk: boolean; execError?: string }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const plan = await plugin.api.plan("undo.last", {}, ${JSON.stringify(target)});
    if ("error" in plan) return { planOk: false, planError: plan.error, execOk: false };
    const exec = await plugin.api.execute(plan);
    if ("error" in exec) return { planOk: true, execOk: false, execError: exec.error };
    return { planOk: true, execOk: !!exec.ok };
  `,
  );
  const get = await davGet(radicale, "test/kalender/simple-1.ics");
  const serverRestored = get.status === 200 && beforeDtstart !== undefined && get.body.includes(beforeDtstart);
  if (!serverRestored) console.log(`DEBUG P12 beforeDtstart=${beforeDtstart} get.body:\n` + get.body);
  // "20260901T113000" → "2026-09-01" (Frontmatter-`start` ist ISO, der Server-Wert Basic-Format).
  const beforeDatePrefix = beforeDtstart ? `${beforeDtstart.slice(0, 4)}-${beforeDtstart.slice(4, 6)}-${beforeDtstart.slice(6, 8)}` : undefined;
  const fmRestored = await pollUntil<boolean>(
    cdp,
    `
    const ev = app.vault.getMarkdownFiles().find((f) => f.path.startsWith("Events/") && app.metadataCache.getFileCache(f)?.frontmatter?.["dav_uid"] === ${JSON.stringify(uid)});
    const start = ev ? String(app.metadataCache.getFileCache(ev)?.frontmatter?.["start"] ?? "") : "";
    return (${JSON.stringify(beforeDatePrefix)} && start.startsWith(${JSON.stringify(beforeDatePrefix)})) || null;
  `,
    5_000,
    200,
  );
  if (!fmRestored) {
    const dbg = await cdp.evaluate<string>(`
      const ev = app.vault.getMarkdownFiles().find((f) => f.path.startsWith("Events/") && app.metadataCache.getFileCache(f)?.frontmatter?.["dav_uid"] === ${JSON.stringify(uid)});
      return JSON.stringify({ path: ev?.path, fm: ev ? app.metadataCache.getFileCache(ev)?.frontmatter : null });
    `);
    console.log(`DEBUG P12 beforeDatePrefix=${beforeDatePrefix} fm=` + dbg);
  }
  const ok = result.planOk && result.execOk && serverRestored && !!fmRestored;
  record(
    "P12",
    "Undo (Letzte Änderung zurücknehmen) — DTSTART zurueck auf Vor-P10-Stand",
    ok,
    `plan=${result.planOk} exec=${result.execOk}${result.execError ? ` (${result.execError})` : ""}, Server-GET restored=${serverRestored} (HTTP ${get.status}), Frontmatter restored=${!!fmRestored}`,
  );
}

async function checkP13(cdp: Cdp): Promise<void> {
  const result = await cdp.evaluate<{
    eventsHasSimple1: boolean;
    contactsHasBrandes: boolean;
    toolCount: number;
    commandCount: number;
    toolNamesHaveDot: boolean;
  }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const events = await plugin.api.events({ from: "2026-09-01", to: "2026-09-30" });
    const contacts = await plugin.api.contacts({ query: "Brandes" });
    const tools = plugin.api.tools();
    const commands = plugin.api.commands();
    return {
      eventsHasSimple1: Array.isArray(events) && events.some((e) => e.uid === "simple-1@test"),
      contactsHasBrandes: Array.isArray(contacts) && contacts.some((c) => /florian brandes/i.test(c.data?.fn ?? "")),
      toolCount: Array.isArray(tools) ? tools.length : -1,
      commandCount: Array.isArray(commands) ? commands.length : -1,
      toolNamesHaveDot: Array.isArray(tools) && tools.some((t) => t.name.includes(".")),
    };
  `,
  );
  const ok =
    result.eventsHasSimple1 &&
    result.contactsHasBrandes &&
    result.toolCount === result.commandCount &&
    result.toolCount > 0 &&
    !result.toolNamesHaveDot;
  record(
    "P13",
    "API-Lesen (events/contacts/tools==commands, keine Punkte in Tool-Namen)",
    ok,
    `events hat simple-1=${result.eventsHasSimple1}, contacts hat Florian Brandes=${result.contactsHasBrandes}, tools=${result.toolCount} commands=${result.commandCount}, Tool-Name mit Punkt=${result.toolNamesHaveDot}`,
  );
}

// ── P8: Settings-UI (nur --focus) ───────────────────────────────────────
async function checkP8(port: number, vault: string): Promise<void> {
  const workspace = await attachTo("workspace", port, vault);
  if (!workspace) {
    record("P8", "Settings-UI", false, "Workspace-Fenster nicht gefunden");
    return;
  }
  try {
    await workspace.evaluate(`app.setting.open(); app.setting.openTabById(${JSON.stringify(PLUGIN_ID)}); return true;`);
  } finally {
    workspace.close();
  }
  const settingsCdp = await (async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const c = await attachTo("settings", port).catch(() => null);
      if (c) return c;
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  })();
  if (!settingsCdp) {
    record("P8", "Settings-UI", false, "Einstellungen-Fenster nicht gefunden");
    return;
  }
  try {
    await requireVisible(settingsCdp);
    const info = await settingsCdp.evaluate<{ hasPwLabel: boolean; hasDiscoverBtn: boolean; hasAccountRow: boolean }>(
      `
      const items = [...document.querySelectorAll(".setting-item")];
      const hasPwLabel = items.some((el) => /password|passwort/i.test(el.querySelector(".setting-item-name")?.textContent ?? ""));
      const discoverLabels = ${JSON.stringify(DISCOVER_BUTTON_LABELS)};
      const hasDiscoverBtn = [...document.querySelectorAll("button")].some((b) => discoverLabels.includes((b.textContent ?? "").trim()));
      const hasAccountRow = items.some((el) => (el.textContent ?? "").includes(${JSON.stringify(ACCOUNT_NAME)}));
      return { hasPwLabel, hasDiscoverBtn, hasAccountRow };
    `,
    );
    const shotsDir = join(REPO_ROOT, "docs/smoke/shots");
    let shotDetail = "";
    try {
      const png = await capture(settingsCdp);
      shotDetail = await writeShot(settingsCdp, "settings.png", png, { outDir: shotsDir, captureWidth: 1200, thumbWidth: 400, thumb: false });
    } catch (e) {
      shotDetail = `Screenshot fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
    }
    const ok = info.hasPwLabel && info.hasDiscoverBtn && info.hasAccountRow;
    record("P8", "Settings-UI (Konto-Unterseite, SecretComponent, Discovery-Button)", ok, `${JSON.stringify(info)}; ${shotDetail}`);
  } finally {
    settingsCdp.close();
  }
}

// ── main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const port = Number(arg("port", "9222"));
  const vault = arg("vault", "calendar-notes");
  const section = arg("section", "generic") as "generic" | "pallas";
  const keep = flag("keep");
  const focus = flag("focus");
  const setup = flag("setup");

  if (setup) {
    await runSetup(port, vault);
    return;
  }

  const cdp = await attachTo("workspace", port, vault);
  if (!cdp) {
    console.error(
      `Kein Fenster fuer Vault "${vault}" auf Port ${port} gefunden. Pruefen:\n` +
        `  - Obsidian laeuft mit --remote-debugging-port=${port}\n` +
        `  - Der Staging-Vault ist als Fenster offen (ggf. window.electron.ipcRenderer.sendSync("vault-open", <pfad>, false) aus einem ANDEREN Fenster)\n` +
        `  - NICHT das 10_Pallas-Fenster verwenden — dieser Treiber schreibt Testdaten.`,
    );
    process.exitCode = 1;
    return;
  }
  if (focus) await requireVisible(cdp);

  const cleanupFns: { label: string; run: () => Promise<void> }[] = [];
  let radicale: RunningServer | undefined;

  try {
    const pluginPresent = await cdp.evaluate<boolean>( `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`);
    if (!pluginPresent) throw new Error(`Plugin "${PLUGIN_ID}" ist im Fenster "${vault}" nicht geladen — deployt & aktiviert?`);

    const settingsSnapshot = await cdp.evaluate<string>( `return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings);`);
    const vaultSnapshot = await snapshotVault(cdp);
    const stateSnapshot = await snapshotState(cdp);
    if (!keep) {
      cleanupFns.push({
        label: "Settings zuruecksetzen",
        run: async () => {
          await cdp.evaluate(`
            const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
            plugin.settings = ${settingsSnapshot};
            await plugin.saveSettings();
            app.secretStorage.setSecret(${JSON.stringify(SECRET_ID)}, "");
            return true;
          `);
        },
      });
      cleanupFns.push({ label: "Vault-Notizen zuruecksetzen", run: () => restoreVault(cdp, vaultSnapshot) });
      cleanupFns.push({ label: "State-Dateien zuruecksetzen", run: () => pruneNewState(cdp, stateSnapshot) });
    }

    radicale = await startRadicale({
      port: RADICALE_PORT,
      fixtureDir: join(REPO_ROOT, "fixtures/radicale"),
      runDir: join(REPO_ROOT, ".radicale-run", String(RADICALE_PORT)),
    });
    console.log(`Radicale: ${radicale.baseUrl}`);

    await checkP1(cdp);
    await seedAccount(cdp, radicale);
    const discovery = await discoverAndMerge(cdp);
    await checkP2(discovery, section);

    if (section === "pallas") {
      const profileIds = await createPallasProfiles(cdp);
      await wirePallasCollections(cdp, profileIds);
      await checkP3(cdp, discovery);
    } else {
      await cdp.evaluate(`
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        plugin.settings = { ...plugin.settings, collections: plugin.settings.collections.map((c) => ({ ...c, enabled: true })) };
        await plugin.saveSettings();
        return true;
      `);
      await checkP4(cdp);
      await checkP5(cdp, radicale);
      await checkP6(cdp, radicale);
      await checkP7(cdp);

      const commandSource = `${ACCOUNT_ID}/${discovery.calendarId}`;
      // Vor-P10-DTSTART fuer P12 messen (nicht aus der Fixture raten — P5 hat den Server-Stand
      // von simple-1@test bereits einmal veraendert, s. Kommentar bei `checkP12`).
      const beforeMove = await davGet(radicale, "test/kalender/simple-1.ics");
      const beforeDtstart = beforeMove.status === 200 ? extractDtstart(beforeMove.body) : undefined;
      await checkP10(cdp, radicale, commandSource);
      // P12 laeuft bewusst HIER (direkt nach P10, vor P11) — s. Kommentar bei `checkP12`.
      await checkP12(cdp, radicale, commandSource, beforeDtstart);
      await checkP11(cdp, radicale, commandSource);
      await checkP13(cdp);
    }

    if (focus) await checkP8(port, vault);
  } catch (e) {
    record("FEHLER", "Lauf abgebrochen", false, e instanceof Error ? e.message : String(e));
  } finally {
    if (radicale) {
      await radicale.stop();
      console.log("Radicale gestoppt.");
    }
    for (const c of cleanupFns) {
      try {
        await c.run();
      } catch (e) {
        console.log(`Aufraeumen (${c.label}) fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (focus) await releaseAlwaysOnTop(cdp);
    cdp.close();
  }

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} Pruefpunkte gruen.`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
