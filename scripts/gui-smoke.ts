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
import { homedir } from "node:os";
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
import { buildVault } from "../../tools/obsidian-cdp/vault.js";
import { capture, writeShot } from "../../tools/obsidian-cdp/shot.js";
import { startRadicale, type RunningServer } from "./dav-server.js";

const PLUGIN_ID = "calendar-notes";
const RADICALE_PORT = 5298;
const ACCOUNT_ID = "acc-smoke";
const SECRET_ID = `calendar-notes-${ACCOUNT_ID}`;

// `import.meta.url` zeigt nach dem esbuild-Buendeln auf `.gui-smoke.mjs` — das liegt im
// Repo-Root (esbuild schreibt dorthin, `outfile` ohne Pfadpraefix), NICHT in `scripts/`.
// Ein `resolve(HERE, "..")` waere deshalb ein Verzeichnis zu hoch (wie bei `dav-server.ts`s
// eigenem `import.meta.url`, s. Kommentar dort) — hier reicht HERE direkt als Repo-Wurzel.
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

const ALEX_PATH = "Pallas/50_Ressourcen/10_Reference/10_Kontakte/Alex Aguado.md";
const ADAC_PATH = "Pallas/50_Ressourcen/10_Reference/10_Kontakte/ADAC.md";
const ZAHN_PATH = "Pallas/30_Chronos/70_Termine/10_Anstehend/2026-09-01 Zahnärztin.md";

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

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v ?? def;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function resolveVaultDir(): string {
  const explicit = arg("vault-dir", "");
  if (explicit) return explicit;
  const env = process.env["STAGING_VAULTS_DIR"];
  if (env) return join(env, "calendar-notes");
  const fallback = join(homedir(), "StagingVaults", "calendar-notes");
  console.log(
    `Hinweis: STAGING_VAULTS_DIR ist nicht gesetzt — verwende Default ${fallback}. ` +
      `Mit --vault-dir <pfad> ueberschreibbar, mit export STAGING_VAULTS_DIR=… dauerhaft setzbar.`,
  );
  return fallback;
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

async function evalJson<T>(cdp: Cdp, body: string): Promise<T> {
  return cdp.evaluate<T>(body);
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
  return evalJson<Record<string, string>>(
    cdp,
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
  return evalJson<string[]>(
    cdp,
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
      name: "Smoke",
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
  return evalJson<DiscoverInfo>(
    cdp,
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
    const cmds = await evalJson<string[]>(
      cdp,
      `return Object.keys(app.commands.commands).filter((k) => k.startsWith(${JSON.stringify(PLUGIN_ID + ":")})).sort();`,
    );
    const headings = await evalJson<(string | undefined)[] | null>(
      cdp,
      `
      const tab = app.setting?.pluginTabs?.find?.((t) => t.id === ${JSON.stringify(PLUGIN_ID)});
      if (!tab || typeof tab.getSettingDefinitions !== "function") return null;
      return tab.getSettingDefinitions().map((d) => d.heading);
    `,
    );
    const ok = cmds.length === 5 && Array.isArray(headings) && headings.length === 5 && headings.every((h) => typeof h === "string");
    record("P1", "Laden", ok, `${cmds.length} Kommandos, ${Array.isArray(headings) ? headings.length : 0} Settings-Gruppen: ${JSON.stringify(headings)}`);
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
  return evalJson<ProfileIds>(
    cdp,
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
  await pollUntil<boolean>(cdp, `return !document.querySelector(".modal-container") || null;`, 8_000, 200);
}

async function readFrontmatter(cdp: Cdp, path: string): Promise<Record<string, unknown>> {
  return evalJson<Record<string, unknown>>(
    cdp,
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
  const before = await evalJson<{ alexExists: boolean; zahnExists: boolean; zahnBody: string }>(
    cdp,
    `
    const zahn = app.vault.getAbstractFileByPath(${JSON.stringify(ZAHN_PATH)});
    return {
      alexExists: !!app.vault.getAbstractFileByPath(${JSON.stringify(ALEX_PATH)}),
      zahnExists: !!zahn,
      zahnBody: zahn ? await app.vault.cachedRead(zahn) : "",
    };
  `,
  );
  const sync = await evalJson<{ created: number; updated: number; ok: boolean }>(
    cdp,
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
  const after = await evalJson<{ alexExists: boolean; zahnExists: boolean; zahnBody: string }>(
    cdp,
    `
    const zahn = app.vault.getAbstractFileByPath(${JSON.stringify(ZAHN_PATH)});
    return {
      alexExists: !!app.vault.getAbstractFileByPath(${JSON.stringify(ALEX_PATH)}),
      zahnExists: !!zahn,
      zahnBody: zahn ? await app.vault.cachedRead(zahn) : "",
    };
  `,
  );
  const noNewFileForLinked = before.alexExists === after.alexExists && before.zahnExists === after.zahnExists;
  const bodyKept = after.zahnBody.includes("Vorbereitung");
  const syncOk = sync.ok && sync.updated >= 2 && noNewFileForLinked && bodyKept;
  record(
    "P3b",
    "Sync nach Adoption aktualisiert statt neu anzulegen",
    syncOk,
    `created=${sync.created} updated=${sync.updated}, Alex/Zahnärztin unveraendert vorhanden=${noNewFileForLinked}, ` +
      `Body "Vorbereitung…" erhalten=${bodyKept}`,
  );
}

// ── P4-P7: Trockenlauf/Sync/Update/Loeschung/2. Discovery (--section generic) ────────
async function checkP4(cdp: Cdp): Promise<void> {
  const dry = await evalJson<{ created: number; ok: boolean }>(
    cdp,
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll({ dryRun: true });
    return { created: r.collections.reduce((n, c) => n + c.counts.created, 0), ok: r.collections.every((c) => c.ok) };
  `,
  );
  record("P4a", "Trockenlauf (3+2 creates)", dry.created === 5 && dry.ok, `${dry.created} creates im Trockenlauf`);

  const real = await evalJson<{ created: number; ok: boolean }>(
    cdp,
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll();
    return { created: r.collections.reduce((n, c) => n + c.counts.created, 0), ok: r.collections.every((c) => c.ok) };
  `,
  );
  const files = await evalJson<{ events: number; contacts: number; fmKeys: string[] }>(
    cdp,
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
  const before = await evalJson<{ etag: string; body: string } | null>(
    cdp,
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
  await new Promise((r) => setTimeout(r, 500));
  const noticesAfter = await notices(cdp);

  const after = await evalJson<{ etag: string; body: string; updated: number; handEdited: number } | null>(
    cdp,
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
  const ok = !!after && etagChanged && bodyChanged && after.updated >= 1 && after.handEdited === 0 && noErrorNotices;
  record(
    "P5",
    "Update-Pfad (Server-PUT → Frontmatter+Body neu, handEdited leer)",
    ok,
    `etag ${before?.etag ?? "?"} → ${after?.etag ?? "?"}, updated=${after?.updated ?? "?"}, handEdited=${after?.handEdited ?? "?"}, Notices: "${noticesAfter}"`,
  );
  record("P9", "Notices nach P5 ohne Fehler", noErrorNotices, `"${noticesAfter}"`);
}

async function checkP6(cdp: Cdp, radicale: RunningServer): Promise<void> {
  const before = await evalJson<number>(cdp, `return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Events/") && f.basename !== "_index").length;`);
  const status = await davDelete(radicale, "test/kalender/allday-1.ics");
  if (status < 200 || status >= 300) {
    record("P6", "Loeschung (Server-DELETE)", false, `DELETE allday-1.ics → HTTP ${status}`);
    return;
  }
  const planned = await evalJson<boolean>(
    cdp,
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll({ dryRun: true });
    return r.collections.some((c) => c.plans.some((p) => p.op === "delete" && p.mode === "trash"));
  `,
  );
  await evalJson(
    cdp,
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    await plugin.service.runAll();
    return true;
  `,
  );
  const after = await evalJson<number>(cdp, `return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Events/") && f.basename !== "_index").length;`);
  const ok = planned && before - after === 1;
  record("P6", "Loeschung (Papierkorb, delete:trash im Plan)", ok, `Events/ ${before} → ${after}, delete:trash im Trockenlauf-Plan=${planned}`);
}

async function checkP7(cdp: Cdp): Promise<void> {
  const result = await evalJson<{ enabledBefore: number; enabledAfter: number; collections: number }>(
    cdp,
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

// ── P8: Settings-UI (nur --focus) ───────────────────────────────────────
async function checkP8(port: number): Promise<void> {
  const workspace = await attachTo("workspace", port);
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
    const info = await evalJson<{ hasPwLabel: boolean; hasDiscoverBtn: boolean; hasAccountRow: boolean }>(
      settingsCdp,
      `
      const items = [...document.querySelectorAll(".setting-item")];
      const hasPwLabel = items.some((el) => /password|passwort/i.test(el.querySelector(".setting-item-name")?.textContent ?? ""));
      const hasDiscoverBtn = [...document.querySelectorAll("button")].some((b) => /discover|verbindung|test/i.test(b.textContent ?? ""));
      const hasAccountRow = items.length > 0;
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
    const pluginPresent = await evalJson<boolean>(cdp, `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`);
    if (!pluginPresent) throw new Error(`Plugin "${PLUGIN_ID}" ist im Fenster "${vault}" nicht geladen — deployt & aktiviert?`);

    const settingsSnapshot = await evalJson<string>(cdp, `return JSON.stringify(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings);`);
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
    }

    if (focus) await checkP8(port);
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
