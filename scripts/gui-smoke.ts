/**
 * GUI-Smoke-Treiber (Skill gui-smoke-setup, CORE-TEST-02 b): faehrt die Pruefpunkte aus
 * `docs/SMOKE.md` gegen ein LAUFENDES Obsidian ueber CDP — echtes Vault, echtes DAV
 * (Radicale, lokal gestartet), echtes `app.secretStorage`, echte Frontmatter-Schreibpfade.
 *
 * ⚠️ **Zuerst pruefen, wer sonst an Obsidian haengt.** Obsidian ist Single-Instance — ein
 * `quit` trifft die Instanz, an der moeglicherweise eine andere Session arbeitet, und zerstoert
 * deren Zustand. Der eigene Lauf ist danach sauber gruen; der Schaden entsteht woanders und
 * faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "laeuft bereits — NICHT beenden"
 * ```
 *
 * Hoert der Port schon, dann **mitnutzen statt neu starten**: ein eigenes Fenster per
 * `vault-open` ueber IPC oeffnen, dann `attachTo("workspace", port, vault)` — der Vault-Name
 * waehlt, nicht die Reihenfolge. ⚠️ Die Port-Pruefung ersetzt die Frage nicht: sie zeigt aktive
 * CDP-Treiber, aber nicht, wer ein Fenster offen haelt oder auf den Port wartet.
 *
 * Erst wenn nichts laeuft — oder nach Absprache mit dem, der es benutzt — gilt das Rezept unten.
 *
 * Voraussetzung (der eine Handgriff, der Handarbeit bleibt):
 *   osascript -e 'quit app "Obsidian"'; open -a Obsidian --args --remote-debugging-port=9222
 *   OBSIDIAN_PLUGIN_DIR="<vault>/.obsidian/plugins/calendar-notes" npm run deploy
 *
 * Aufruf:
 *   npm run smoke:gui -- --setup                  # baut den Staging-Vault aus dem Fixture neu
 *   npm run smoke:gui -- --section generic         # Standard-Profile (Contacts/Events)
 *   npm run smoke:gui -- --section pallas          # Profile aus Pallas-Notizen + Adoption
 *   npm run smoke:gui -- --section todo            # Aufgaben-Spiegel + Rueckschreiben (M6a/M6b)
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
  requireUntil,
  requireVisible,
} from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, requireEigenerBuild, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
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
// ⚠️ P8 laeuft NUR mit `--focus` und wird deshalb bei Umbenennungen leicht vergessen: bis
// 2026-08-30 standen hier die Labels von VOR der 0.1.9-Ueberarbeitung ("... & Sammlungen
// finden"), P8 waere also rot gewesen — gemerkt hat es niemand, weil der Normallauf ihn
// ueberspringt. Wer `settings.accounts.testButton` aendert, zieht hier nach.
const DISCOVER_BUTTON_LABELS = ["Test connection and find calendars", "Verbindung prüfen und Kalender suchen"];

// `settings.accounts.collectionsHeading` — die Auswahl „was spiegeln?" sitzt seit 2026-08-30
// auf der KONTO-Unterseite (B1 aus dem Erstkontakt-Befund). Der Unit-Test belegt, dass die
// Zeilen entstehen; dass sie im laufenden Obsidian auch DA sind, kann nur der Smoke sagen —
// genau die Haelfte, die eine strukturelle Pruefung nie erreicht.
const COLLECTION_PICKER_LABELS = ["Found — what should be mirrored?", "Gefunden — was soll gespiegelt werden?"];

const ACCOUNT_NAME = "Smoke";

// P2b geht den Weg des Nutzers durch die Oberflaeche — deshalb braucht er die Beschriftungen
// beider Sprachen (der Staging-Vault laeuft auf Englisch, ein fremder Rechner kann Deutsch
// stehen haben). Die Obsidian-EIGENEN Beschriftungen im Secret-Dialog ("Add secret…", "Save")
// folgen der APP-Sprache, nicht der Plugin-Sprache; sie werden deshalb tolerant per Regex
// gesucht und nicht gegen eine Liste geprueft.
const ADD_ACCOUNT_LABELS = ["Add account", "Konto hinzufügen"];
const FIELD_NAME_LABELS = ["Name"];
const FIELD_BASEURL_LABELS = ["Server address", "Server-Adresse"];
const FIELD_USERNAME_LABELS = ["Username", "Benutzername"];
const FIELD_PASSWORD_LABELS = ["Password", "Passwort"];
const UI_ACCOUNT_NAME = "Smoke-UI";
const UI_SECRET_ID = "calendar-notes-smoke-ui";

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

type Section = "generic" | "pallas" | "todo";

interface DiscoverInfo {
  collections: number;
  warnings: number;
  calendarId: string;
  addressbookId: string;
  todoId: string;
}

async function discoverAndMerge(cdp: Cdp): Promise<DiscoverInfo> {
  return cdp.evaluate<DiscoverInfo>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const account = plugin.settings.accounts.find((a) => a.id === ${JSON.stringify(ACCOUNT_ID)});
    const result = await plugin.discoverAccount(account);
    plugin.settingTab.mergeDiscoveredCollections(account, result);
    // NAMENTLICH waehlen, nicht ueber die Reihenfolge: seit dem VTODO-Fixture liegen ZWEI
    // Sammlungen mit kind === "calendar" im Home-Set (Termine und Aufgaben), und Radicale
    // sortiert nicht. Ein .find() auf kind allein zog hier mal die eine, mal die andere.
    // Derselbe Fehler stand im Integrationstest und wurde dort mit 299594e behoben; dieser
    // Zwilling blieb stehen, weil die Task-10-Review nur tests/ ansah.
    const mine = plugin.settings.collections.filter((c) => c.accountId === account.id);
    const cal = mine.find((c) => c.kind === "calendar" && c.displayName === "Kalender");
    const ab = mine.find((c) => c.kind === "addressbook");
    const todo = mine.find((c) => c.kind === "calendar" && c.displayName === "Aufgaben");
    return {
      collections: result.collections.length,
      warnings: result.warnings.length,
      calendarId: cal ? cal.id : "",
      addressbookId: ab ? ab.id : "",
      todoId: todo ? todo.id : "",
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
    // undo-last-change/push-hand-edits, s. main.ts registerCommands()) — 5 aus M1-M3 + 5 neu = 10,
    // seit M6b dazu `todo-sync` = 11. Die Zahl steht hier bewusst hart: sie ist der einzige
    // Punkt, an dem ein VERSEHENTLICH weggefallenes Kommando auffiele. Wer eines hinzufuegt,
    // zieht sie mit — der Baseline-Lauf vor der Erweiterung meldet das von selbst.
    const ok = cmds.length === 11 && headingsOk;
    record("P1", "Laden", ok, `${cmds.length} Kommandos, benannte Settings-Gruppen: ${JSON.stringify(named)} (erwartet DE ${JSON.stringify(SETTING_HEADINGS_DE)} oder EN ${JSON.stringify(SETTING_HEADINGS_EN)})`);
  } catch (e) {
    record("P1", "Laden", false, e instanceof Error ? e.message : String(e));
  }
}

// ── P2b: Auth ueber den echten UI-Weg ────────────────────────────────────
// Der Anlass ist derselbe wie bei P2a — der 401-Fehler vom 2026-08-25 —, aber die Luecke ist
// eine andere: P2a und P2 setzen `secretId` und das Geheimnis per `seedAccount` DIREKT, also
// auf einem Weg, den kein Nutzer geht. Genau dort sass der Defekt (0.1.4):
// `SecretComponent.onChange` liefert die ID des Schluesselbund-Eintrags, nicht dessen Wert —
// wer die ID als Passwort speichert, meldet sich mit dem Namen des Eintrags an und bekommt
// von jedem Server 401. `seedAccount` umgeht diesen Rueckruf und kann ihn deshalb nicht
// pruefen; die Zusicherung hier ist folglich NICHT "secretId ist gesetzt" (das waere beim
// 0.1.4-Stand ebenfalls wahr), sondern: **nach dem Weg durch die Oberflaeche antwortet die
// Discovery mit 207 statt 401.**
//
// Gemessen 2026-08-30 in der Gegenprobe (`onChange` auf den 0.1.4-Fehler zurueckgedreht,
// gebaut, deployt, Plugin neu geladen): P2b meldet dann `warf=true, "Zugang verweigert
// (401)", Sammlungen=0` — **bei korrekt gesetzter `secretId`**. Das ist der Beleg fuer die
// Wahl der Zusicherung: der Punkt "secretId ist gesetzt" waere in genau diesem Lauf gruen
// gewesen. P2a und P2 blieben beide gruen, weil sie ueber `seedAccount` laufen — die Luecke,
// um die es hier geht, ist also nicht theoretisch, sondern gemessen.
//
// Drei Dinge, die den Aufbau bestimmen und am 2026-08-30 gemessen wurden:
//   1. Der Tab ist DEKLARATIV (`getSettingDefinitions()`, kein `display()` — s. Kopf von
//      `settings-tab.ts`). Ein bereits offener Tab zeichnet einen neuen Kontostand nicht
//      nach, und `display()` ist wirkungslos. Deshalb wird hier geschlossen und neu geoeffnet.
//   2. Das Settings-DOM haengt zwar in einem EIGENEN Fenster (`ownerDocument !== document`),
//      ist aber ueber `plugin.settingTab.containerEl` aus dem Workspace-Target erreichbar.
//      Das erspart eine zweite Verbindung — und damit die Identitaetsfrage, welches von
//      mehreren Einstellungen-Fenstern man erwischt hat (`attachTo("settings")` trennt nach
//      Vault, nicht nach Fenster).
//   3. Der Secret-Dialog ist ein normales Obsidian-Modal (`.modal.mod-secret`, "Select
//      secret" → "Add secret" mit den Feldern ID und Secret), KEIN nativer Dialog: der
//      Renderer antwortet waehrend er offen steht. Das war vorher offen und ist der Grund,
//      warum dieser Pruefpunkt ueberhaupt baubar ist.
async function checkP2bUiAuth(cdp: Cdp, radicale: RunningServer): Promise<void> {
  const TAB = `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settingTab.containerEl`;
  const DOC = `${TAB}.ownerDocument`;
  const NAME_OF = `((el) => (el.querySelector(".setting-item-name") ? el.querySelector(".setting-item-name").textContent : "").trim())`;
  const ITEM_BY = (labels: string[]) =>
    `[...${TAB}.querySelectorAll(".setting-item")].find((el) => ${JSON.stringify(labels)}.includes(${NAME_OF}(el)))`;
  const MODAL = `${DOC}.querySelector(".modal-container")`;
  const MODAL_TITLE = `(${MODAL} && ${MODAL}.querySelector(".modal-title") ? ${MODAL}.querySelector(".modal-title").textContent.trim() : "")`;
  let angelegt = false;

  try {
    // (1) Einstellungen frisch aufbauen. Schliessen und Oeffnen sind getrennte Aufrufe mit
    //     einer Wartephase dazwischen — Mutation und Warten nicht im selben `evaluate`
    //     (Doktrin aus der Dach-AGENTS.md: warten gehoert auf die Node-Seite).
    // Vorbedingung: ein Schluesselbund-Eintrag dieser ID darf NICHT existieren. Sonst
    // kollidiert der Dialog "Add secret" mit ihm, die Verknuepfung unterbleibt still, und
    // das Konto faellt auf `secretIdFor(account)` zurueck — die Discovery meldet dann
    // "No keychain entry is linked to this account" statt 401. Gemessen 2026-08-30: der
    // erste Lauf war gruen, jeder weitere rot, weil das Aufraeumen den Eintrag nur GELEERT
    // statt geloescht hat. Vorher aufraeumen deckt zusaetzlich den abgebrochenen Vorlauf ab,
    // der nachher gar nicht mehr zum Aufraeumen kommt.
    await cdp.evaluate(`
      const ids = await app.secretStorage.listSecrets();
      if (ids.includes(${JSON.stringify(UI_SECRET_ID)})) await app.secretStorage.deleteSecret(${JSON.stringify(UI_SECRET_ID)});
      return true;
    `);
    await cdp.evaluate(`app.setting.close(); return true;`);
    await new Promise((r) => setTimeout(r, 400));
    await cdp.evaluate(`app.setting.open(); app.setting.openTabById(${JSON.stringify(PLUGIN_ID)}); return true;`);
    await requireUntil(cdp, ITEM_BY(["Accounts", "Konten"]), "Konten-Ueberschrift nicht gezeichnet");

    // (2) Konto ueber den "+"-Knopf anlegen. Er ist ein `.clickable-icon` mit `aria-label`,
    //     kein <button> — ein Suchen nach <button> geht hier ins Leere.
    const vorher = await cdp.evaluate<number>(`return app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.accounts.length;`);
    await cdp.evaluate(`
      const add = [...${TAB}.querySelectorAll(".clickable-icon")]
        .find((e) => ${JSON.stringify(ADD_ACCOUNT_LABELS)}.includes(e.getAttribute("aria-label")));
      if (!add) throw new Error("Knopf \\"Konto hinzufuegen\\" nicht gefunden");
      add.click();
      return true;
    `);
    angelegt = true;
    await requireUntil(cdp, `app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].settings.accounts.length > ${vorher}`, "Add-Knopf hat kein Konto angelegt");
    await requireUntil(cdp, ITEM_BY(FIELD_PASSWORD_LABELS), "Passwort-Zeile nicht gezeichnet");

    // (3) Name, Server-Adresse und Benutzername ueber die Textfelder setzen — mit
    //     `input`-Event, sonst laeuft der `onChange`-Rueckruf des Plugins nicht.
    await cdp.evaluate(`
      const setzen = (labels, wert) => {
        const item = [...${TAB}.querySelectorAll(".setting-item")].find((el) => labels.includes(${NAME_OF}(el)));
        if (!item) throw new Error("Feld nicht gefunden: " + labels[0]);
        const input = item.querySelector("input");
        if (!input) throw new Error("Kein Eingabefeld in: " + labels[0]);
        input.value = wert;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setzen(${JSON.stringify(FIELD_NAME_LABELS)}, ${JSON.stringify(UI_ACCOUNT_NAME)});
      setzen(${JSON.stringify(FIELD_BASEURL_LABELS)}, ${JSON.stringify(radicale.baseUrl)});
      setzen(${JSON.stringify(FIELD_USERNAME_LABELS)}, ${JSON.stringify(radicale.user)});
      return true;
    `);

    // (4) Passwort ueber die SecretComponent hinterlegen: "Link…" → "Add secret…" → ID+Wert
    //     → Save. Das ist der Rueckruf, den `seedAccount` ueberspringt.
    await cdp.evaluate(`
      const item = [...${TAB}.querySelectorAll(".setting-item")].find((el) => ${JSON.stringify(FIELD_PASSWORD_LABELS)}.includes(${NAME_OF}(el)));
      const btn = item.querySelector(".setting-item-control button");
      if (!btn) throw new Error("Kein Knopf an der Passwort-Zeile (SecretComponent nicht gezeichnet?)");
      btn.click();
      return true;
    `);
    await requireUntil(cdp, `${MODAL} && ${MODAL}.querySelector(".modal.mod-secret")`, "Secret-Dialog nicht geoeffnet");

    await cdp.evaluate(`
      const add = [...${MODAL}.querySelectorAll("button")].find((b) => /add secret|geheimnis hinzu/i.test(b.textContent || ""));
      if (!add) throw new Error("Knopf \\"Add secret…\\" nicht gefunden");
      add.click();
      return true;
    `);
    await requireUntil(cdp, `${MODAL} && ${MODAL}.querySelector('input[type="password"]')`, "Dialog \"Add secret\" nicht geoeffnet");

    await cdp.evaluate(`
      const m = ${MODAL};
      const id = m.querySelector('input[type="text"]');
      const wert = m.querySelector('input[type="password"]');
      if (!id || !wert) throw new Error("Felder ID/Secret nicht gefunden");
      id.value = ${JSON.stringify(UI_SECRET_ID)};
      id.dispatchEvent(new Event("input", { bubbles: true }));
      wert.value = ${JSON.stringify(radicale.pass)};
      wert.dispatchEvent(new Event("input", { bubbles: true }));
      const save = [...m.querySelectorAll("button")].find((b) => /^(save|speichern)$/i.test((b.textContent || "").trim()));
      if (!save) throw new Error("Speichern-Knopf im Dialog nicht gefunden");
      save.click();
      return true;
    `);

    // Nach dem Anlegen kehrt der Dialog zur Auswahl zurueck; dort muss die Wahl bestaetigt
    // werden. Steht der Dialog schon nicht mehr, ist die Verknuepfung bereits erfolgt —
    // beides ist zulaessig, deshalb wird auf den ZUSTAND gewartet, nicht auf einen Klick.
    await new Promise((r) => setTimeout(r, 600));
    await cdp.evaluate(`
      const m = ${MODAL};
      if (!m) return "kein Dialog mehr offen";
      const save = [...m.querySelectorAll("button")].find((b) => /^(save|speichern)$/i.test((b.textContent || "").trim()));
      if (save) { save.click(); return "Auswahl bestaetigt"; }
      return "Dialog offen, kein Speichern-Knopf";
    `);
    const secretGesetzt = await requireUntilSecret(cdp);

    // (5) Die eigentliche Zusicherung: Discovery ueber das UI-eingerichtete Konto.
    const r = await cdp.evaluate<{ threw: boolean; msg: string; collections: number; secretId: string }>(`
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const account = plugin.settings.accounts.find((a) => a.name === ${JSON.stringify(UI_ACCOUNT_NAME)});
      if (!account) throw new Error("UI-Konto nicht in den Einstellungen");
      let threw = false, msg = "", collections = 0;
      try {
        const result = await plugin.discoverAccount(account);
        collections = result.collections.length;
      } catch (e) {
        threw = true;
        msg = String((e && e.message) || e);
      }
      return { threw, msg, collections, secretId: account.secretId || "" };
    `);
    const ok = !r.threw && r.collections > 0 && r.secretId !== "";
    record(
      "P2b",
      "Konto ueber die Oberflaeche eingerichtet: Discovery antwortet (207, nicht 401)",
      ok,
      `warf=${r.threw}${r.msg ? `, Meldung: ${JSON.stringify(r.msg.slice(0, 160))}` : ""}, Sammlungen=${r.collections}, secretId=${JSON.stringify(r.secretId)}, Secret hinterlegt=${secretGesetzt}`,
    );
  } catch (e) {
    record("P2b", "Konto ueber die Oberflaeche eingerichtet: Discovery antwortet (207, nicht 401)", false, e instanceof Error ? e.message : String(e));
  } finally {
    // Aufraeumen im Pruefpunkt selbst, nicht erst am Laufende: das UI-Konto brauchte eine
    // eigene ID, und ein zweites Konto mit denselben Sammlungen wuerde P2 und alles danach
    // an DIESER Hinterlassenschaft scheitern lassen statt an ihrem eigenen Gegenstand.
    if (angelegt) {
      await cdp.evaluate(`
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const weg = plugin.settings.accounts.filter((a) => a.name === ${JSON.stringify(UI_ACCOUNT_NAME)}).map((a) => a.id);
        plugin.settings = {
          ...plugin.settings,
          accounts: plugin.settings.accounts.filter((a) => !weg.includes(a.id)),
          collections: plugin.settings.collections.filter((c) => !weg.includes(c.accountId)),
        };
        await plugin.saveSettings();
        const ids = await app.secretStorage.listSecrets();
        if (ids.includes(${JSON.stringify(UI_SECRET_ID)})) await app.secretStorage.deleteSecret(${JSON.stringify(UI_SECRET_ID)});
        const doc = plugin.settingTab.containerEl.ownerDocument;
        const close = doc.querySelector(".modal-container .modal-close-button");
        if (close) close.click();
        app.setting.close();
        return true;
      `).catch(() => undefined);
    }
  }
}

/** Wartet darauf, dass der SecretComponent-Rueckruf eine ID am Konto hinterlassen hat.
 *  Eigene Funktion, weil die Bedingung ueber das PLUGIN laeuft und nicht ueber das DOM —
 *  genau das ist der Unterschied zwischen "der Dialog sah gut aus" und "es ist angekommen". */
async function requireUntilSecret(cdp: Cdp): Promise<boolean> {
  const da = await pollUntil<boolean>(
    cdp,
    `const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
     const a = p.settings.accounts.find((a) => a.name === ${JSON.stringify(UI_ACCOUNT_NAME)});
     return Boolean(a && a.secretId);`,
    10_000,
    400,
  );
  return Boolean(da);
}

// ── P2a: Gegenprobe — falsches Passwort MUSS scheitern ───────────────────
// Anlass ist der 401-Fehler vom 2026-08-25 (SecretComponent.onChange liefert die Secret-ID,
// nicht das Passwort — Fix in 0.1.5/0.1.6): kein Test und kein Pruefpunkt hat ihn gesehen.
// Ein Pruefpunkt, der nur den Erfolgsfall kennt, haette auch den kaputten 0.1.4-Stand gruen
// gemeldet — er belegt nicht, dass Auth wirkt, sondern nur, dass irgendetwas antwortet.
// Die Fixture-Auth traegt das: `fixtures/radicale/config` faehrt `htpasswd` + `owner_only`,
// gemessen 2026-08-30 (ohne Header 401, falsches Passwort 401, falscher Benutzer 401,
// test:test 207). Geprueft wird zusaetzlich, dass die Meldung den Status NENNT — eine
// Fehlermeldung, die den Grund verschweigt, hat am 2026-08-29 einen ganzen Tag gekostet
// (s. _docs/LESSONS.md, "Wenn zwei direkte Wege scheitern …").
async function checkP2aAuth(cdp: Cdp, radicale: RunningServer): Promise<void> {
  try {
    const r = await cdp.evaluate<{ threw: boolean; msg: string }>(`
      const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
      const account = plugin.settings.accounts.find((a) => a.id === ${JSON.stringify(ACCOUNT_ID)});
      await app.secretStorage.setSecret(${JSON.stringify(SECRET_ID)}, "definitiv-falsches-passwort");
      let threw = false, msg = "";
      try {
        await plugin.discoverAccount(account);
      } catch (e) {
        threw = true;
        msg = String((e && e.message) || e);
      }
      // Richtiges Passwort zuruecksetzen, sonst scheitert jeder folgende Pruefpunkt an DIESER
      // Manipulation statt an seinem eigenen Gegenstand.
      await app.secretStorage.setSecret(${JSON.stringify(SECRET_ID)}, ${JSON.stringify(radicale.pass)});
      return { threw, msg };
    `);
    const nennt401 = /401/.test(r.msg);
    record("P2a", "Gegenprobe: falsches Passwort scheitert (401)", r.threw && nennt401, `warf=${r.threw}, Meldung nennt 401=${nennt401}, Meldung: ${JSON.stringify(r.msg.slice(0, 200))}`);
  } catch (e) {
    record("P2a", "Gegenprobe: falsches Passwort scheitert (401)", false, e instanceof Error ? e.message : String(e));
  }
}

// ── P2: Konto + Discovery ────────────────────────────────────────────────
async function checkP2(info: DiscoverInfo, variant: Section): Promise<void> {
  // DREI Sammlungen seit dem VTODO-Fixture: Kalender, Kontakte, Aufgaben. Die Zahl steht hier
  // ausgeschrieben und nicht als >= 2, damit eine im Fixture verlorene Sammlung auffaellt.
  const ok = info.collections === 3 && info.warnings === 0
    && info.calendarId !== "" && info.addressbookId !== "" && info.todoId !== "";
  record("P2", `Konto+Discovery (${variant})`, ok,
    `${info.collections} Sammlungen, ${info.warnings} Warnungen, Aufgaben-Sammlung ${info.todoId ? "erkannt" : "FEHLT"}`);
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
  // `.modal-container` ist Obsidians GETEILTE Modal-Wurzel, nicht unsere: jedes Plugin haengt
  // seine Modals dort ein. Dass die drei Zugriffe hier trotzdem treffen, ist eine Eigenschaft
  // der UMGEBUNG, nicht des Codes — im Staging-Vault ist nur calendar-notes aktiv, ein
  // Fremdmodal also praktisch ausgeschlossen. Waere beim Start eines offen, wuerde `opened`
  // sofort true liefern und dessen CTA klicken, und der `closed`-Check unten wuerde NIE true
  // (Meldung "Adoption-Modal schließt nicht", obwohl unseres laengst zu ist).
  // Das ist falsch-ROT, also laut und billig — deshalb bleibt es so. Wer diesen Treiber je gegen
  // einen Vault mit weiteren Plugins laufen laesst, muss vorher haerten: fremde Modals zaehlen,
  // `.pop()` statt des ersten Treffers, Titel pruefen (Referenzform koda-agent `e907f4c`).
  // Geprueft und so entschieden am 2026-08-30 mit der Dach-Session (Task "GUI-Smoke greift
  // geteilte Obsidian-DOM-Regionen").
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
  // DREI Sammlungen seit dem VTODO-Fixture (Kalender, Kontakte, Aufgaben), davon ZWEI
  // aktiviert: `generic` laesst die Aufgaben-Sammlung bewusst aus. Die eigentliche Aussage
  // des Pruefpunkts ist enabledBefore === enabledAfter — die Sammlungszahl steht daneben,
  // damit ein veraendertes Fixture hier auffaellt und nicht in der Merge-Regel gesucht wird.
  const ok = result.collections === 3 && result.enabledBefore === result.enabledAfter && result.enabledAfter === 2;
  record("P7", "Zweiter Discovery-Lauf haelt aktivierte Sammlungen (Merge-Regel)", ok,
    `aktiviert vorher=${result.enabledBefore} nachher=${result.enabledAfter}, Sammlungen=${result.collections}`);
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
// ── P20-P24: Aufgaben-Spiegel (--section todo, M6a Task 11) ────────────────────────────
//
// Gegenstand ist die Statusabbildung, nicht "es entsteht eine Datei". Ein Pruefpunkt auf
// blosse Existenz waere auch dann gruen, wenn `statusValue` gar nicht liefe — die Gegenprobe
// in docs/SMOKE.md baut genau diesen Defekt ein und muss P23 rot faerben.
//
// Geprueft wird gegen das FRONTMATTER, nicht gegen TaskNotes (Ruling 13): der Staging-Vault
// fuehrt kein TaskNotes, und die Spec zieht die Grenze bei "wir transportieren, TaskNotes
// verwaltet". Ob TaskNotes aus der Notiz eine Aufgabe macht, ist TaskNotes' Zusage.

const TODO_UID_OPEN = "radicale-todo-1@test";

async function enableOnlyTodo(cdp: Cdp, todoId: string): Promise<void> {
  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const todoId = ${JSON.stringify(todoId)};
    plugin.settings = { ...plugin.settings, collections: plugin.settings.collections.map((c) => ({ ...c, enabled: c.id === todoId })) };
    await plugin.saveSettings();
    return true;
  `);
}

async function checkP20(cdp: Cdp, info: DiscoverInfo): Promise<void> {
  const st = await cdp.evaluate<{ found: boolean; enabled: boolean; components: string[]; kind: string }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const c = plugin.settings.collections.find((x) => x.id === ${JSON.stringify(info.todoId)});
    if (!c) return { found: false, enabled: false, components: [], kind: "" };
    return { found: true, enabled: !!c.enabled, components: c.components ?? [], kind: c.kind };
  `,
  );
  const ok = st.found && st.enabled && st.kind === "calendar" && st.components.some((x) => x.toUpperCase() === "VTODO");
  record("P20", "Aufgaben-Sammlung erkannt und aktivierbar", ok,
    st.found ? `kind=${st.kind}, components=[${st.components.join(", ")}], enabled=${st.enabled}` : "Sammlung nicht in den Einstellungen");
}

async function checkP21(cdp: Cdp, info: DiscoverInfo): Promise<void> {
  const got = await cdp.evaluate<{ profileId: string; calProfileId: string }>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const t = plugin.settings.collections.find((x) => x.id === ${JSON.stringify(info.todoId)});
    const c = plugin.settings.collections.find((x) => x.id === ${JSON.stringify(info.calendarId)});
    return { profileId: t ? t.profileId : "", calProfileId: c ? c.profileId : "" };
  `,
  );
  // Die zweite Haelfte ist die Gegenprobe innerhalb des Pruefpunkts: bekaeme JEDE
  // Kalender-Sammlung "default-todo", saehe der erste Vergleich genauso gruen aus.
  const ok = got.profileId === "default-todo" && got.calProfileId === "default-event";
  record("P21", "Aufgaben-Profil automatisch zugewiesen", ok,
    `Aufgaben=${got.profileId || "—"}, Termine=${got.calProfileId || "—"}`);
}

interface TodoNote {
  path: string; uid: string; status: unknown; type: unknown; tags: unknown; total: number;
  // Das Sync-Ergebnis gehoert in den Pruefpunkt, nicht in eine Nebenmessung: ein rotes P22
  // soll selbst sagen, ob der Sync gar nicht lief, ob er warf, oder ob er lief und nichts
  // anlegte. Ohne das misst man danach den aufgeraeumten Zustand und sieht nichts.
  syncOk: boolean; created: number; syncDetail: string;
}

async function syncTodosAndRead(cdp: Cdp): Promise<TodoNote> {
  const sync = await cdp.evaluate<TodoNote>(
    `
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const r = await plugin.service.runAll();
    const created = r.collections.reduce((n, c) => n + c.counts.created, 0);
    const syncOk = r.collections.every((c) => c.ok);
    const syncDetail = r.collections
      .map((c) => c.collectionId + ": ok=" + c.ok + " created=" + c.counts.created
        + " skipped=" + (c.counts.skipped ?? "?") + (c.error ? " error=" + c.error : ""))
      .join(" | ") || "runAll lieferte KEINE Sammlung";
    const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Tasks/") && f.basename !== "_index");
    return { path: "", uid: "", status: null, type: null, tags: null, total: files.length, syncOk, created, syncDetail };
  `,
  );

  // MUTATION UND WARTEPHASE TRENNEN: der Sync oben schreibt die Dateien, aber
  // `metadataCache` indiziert sie erst danach — ein `getFileCache` im selben Ausdruck
  // liefert deshalb ein leeres Frontmatter, und der Pruefpunkt sieht rot aus, obwohl die
  // Notiz korrekt entstanden ist (gemessen 2026-09-03: Tasks/=2, created=2, dav_uid nicht
  // auffindbar). Das Warten laeuft auf der Node-Seite, nicht im Renderer.
  const found = await pollUntil<TodoNote>(
    cdp,
    `
    const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith("Tasks/") && f.basename !== "_index");
    for (const f of files) {
      const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      if (fm["dav_uid"] === ${JSON.stringify(TODO_UID_OPEN)}) {
        return { path: f.path, uid: fm["dav_uid"], status: fm["status"] ?? null, type: fm["type"] ?? null, tags: fm["tags"] ?? null, total: files.length, syncOk: true, created: 0, syncDetail: "" };
      }
    }
    return null;
  `,
    20_000,
    400,
  );

  // Die Sync-Diagnose stammt aus dem ersten Ausdruck und bleibt erhalten, auch wenn das
  // Warten scheitert — sonst verliert ein rotes P22 genau die Information, die es erklaert.
  return found
    ? { ...found, syncOk: sync.syncOk, created: sync.created, syncDetail: sync.syncDetail }
    : sync;
}

async function checkP22to24(cdp: Cdp, note: TodoNote): Promise<void> {
  // P22 haengt die Zusicherung an dav_uid, nicht an die Anzahl der Notizen: ob die ERLEDIGTE
  // Fixture-Aufgabe mitgespiegelt wird, entscheidet `todoInWindow` am heutigen Datum
  // (COMPLETED liegt im August 2026) — eine Zahl waere hier ein Prueferfolg mit Ablaufdatum.
  record("P22", "Sync legt Notiz fuer die offene Aufgabe an", note.path !== "" && note.uid === TODO_UID_OPEN,
    note.path
      ? `${note.path} (dav_uid=${note.uid}), ${note.total} Notiz(en) in Tasks/`
      : `keine Notiz mit dav_uid=${TODO_UID_OPEN}; Tasks/=${note.total}, Sync: ok=${note.syncOk} created=${note.created} — ${note.syncDetail}`);

  // DER Pruefpunkt dieses Abschnitts. Der Server sagt NEEDS-ACTION, das Profil bildet auf
  // "open" ab. Steht hier der Rohwert, ist die Abbildung ausgefallen.
  record("P23", "Frontmatter traegt den ABGEBILDETEN Status", note.status === "open",
    `status=${JSON.stringify(note.status)} (Server: NEEDS-ACTION, erwartet: "open")`);

  // Die Sichtbarkeitsmarkierung ist `type`, nicht `tags`: das Profil setzt sie ueber
  // onCreate ({ type: "task" }), waehrend `tags` auf das Server-Feld CATEGORIES gemappt ist
  // und bei dieser Aufgabe "Finanzen, Privat" traegt.
  const tagsInfo = Array.isArray(note.tags) ? `[${(note.tags as string[]).join(", ")}]` : JSON.stringify(note.tags);
  record("P24", "Notiz traegt die Sichtbarkeitsmarkierung", note.type === "task",
    `type=${JSON.stringify(note.type)}, tags=${tagsInfo}`);
}

// ── P25-P30: Aufgaben ZURUECKSCHREIBEN (--section todo, M6b Task 11) ────────────────────
//
// P20-P24 oben messen die Hinrichtung (Server → Notiz). Hier geht es um die Rueckrichtung,
// und die hat einen anderen Gegenstand: nicht "es wurde etwas geschrieben", sondern "es
// wurde GENAU das geschrieben, was der Nutzer im Modal gesehen hat" — inklusive dessen,
// was NICHT geschrieben werden darf (P29).

const TODO_UID_CANCELLED = "radicale-todo-3@test";
const TODO_CMD = `${PLUGIN_ID}:todo-sync`;
const TODO_NEUE_NOTIZ = "Tasks/Fahrrad reparieren.md";

/** Das Auswahl-Modal — ueber den Titel identifiziert, nicht ueber "das oberste Modal": ein
 *  stehengebliebener fremder Dialog machte den Punkt sonst rot mit einer Meldung ueber
 *  fehlende Tabellenzeilen, und die Ursache stuende nicht drin. DE und EN, wie bei P8. */
const TODO_MODAL = `[...document.querySelectorAll(".modal-container .modal")]`
  + `.find((m) => /aufgaben mit dem server|sync tasks with the server/i.test(((m.querySelector(".modal-title") || {}).textContent) || ""))`;

const GRUPPE = {
  vaultOnly: /im vault geändert|im vault geaendert|changed in the vault/i,
  neu: /noch nicht auf dem server|not on the server yet/i,
  konflikt: /auf beiden seiten|changed on both sides/i,
};

interface ModalZeile { path: string; felder: string; wahl: string }
interface ModalSicht { gruppen: { label: string; zeilen: ModalZeile[] }[]; cta: string }

function zeilenVon(s: ModalSicht, re: RegExp): ModalZeile[] {
  return s.gruppen.filter((g) => re.test(g.label)).flatMap((g) => g.zeilen);
}

/** Die Zahl im CTA-Knopf. `-1` heisst "keine gefunden" und ist damit von einer echten 0
 *  unterscheidbar — die 0 ist bei P30 ein ERWARTETER Wert, kein Fehlerfall. */
function ctaZahl(s: string): number {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : -1;
}

async function leseTodoModal(cdp: Cdp): Promise<ModalSicht> {
  const sicht = await cdp.evaluate<ModalSicht | null>(`
    const m = ${TODO_MODAL};
    if (!m) return null;
    const gruppen = [];
    let aktuell = null;
    // Reihenfolge im DOM traegt die Zuordnung: jede Ueberschrift eroeffnet eine Gruppe, die
    // folgende Tabelle gehoert zu ihr. Leere Gruppen zeichnet das Modal gar nicht.
    for (const el of m.querySelectorAll("h3, table.calendar-notes-diff-table")) {
      if (el.tagName === "H3") { aktuell = { label: (el.textContent || "").trim(), zeilen: [] }; gruppen.push(aktuell); continue; }
      if (!aktuell) continue;
      for (const tr of el.querySelectorAll("tbody tr")) {
        const td = tr.querySelectorAll("td");
        const sel = tr.querySelector("select");
        aktuell.zeilen.push({
          path: ((td[0] || {}).textContent || "").trim(),
          felder: ((td[1] || {}).textContent || "").trim(),
          wahl: sel ? sel.value : "",
        });
      }
    }
    const cta = m.querySelector("button.mod-cta");
    return { gruppen, cta: cta ? (cta.textContent || "").trim() : "" };
  `);
  if (!sicht) throw new Error("Auswahl-Modal ist nicht (mehr) offen");
  return sicht;
}

async function oeffneTodoModal(cdp: Cdp): Promise<ModalSicht> {
  await cdp.evaluate(`app.commands.executeCommandById(${JSON.stringify(TODO_CMD)}); return true;`);
  // Das Kommando laeuft ueber `fireAndForget` und holt vorher den Serverstand (ein REPORT je
  // Sammlung) — das Modal ist also NICHT im selben Tick da.
  await requireUntil(cdp, TODO_MODAL, "Auswahl-Modal ist nicht aufgegangen", 30_000);
  return leseTodoModal(cdp);
}

/** Eine Zeile im Modal auf eine Entscheidung stellen — ueber das SICHTBARE Dropdown, damit
 *  der Weg derselbe ist wie beim Nutzer (`change`-Ereignis inklusive). */
async function setzeWahl(cdp: Cdp, path: string, wahl: string): Promise<void> {
  await cdp.evaluate(`
    const m = ${TODO_MODAL};
    if (!m) throw new Error("Auswahl-Modal nicht offen");
    const tr = [...m.querySelectorAll("tbody tr")].find((r) => ((r.querySelector("td") || {}).textContent || "").trim() === ${JSON.stringify(path)});
    if (!tr) throw new Error("Zeile nicht im Modal: " + ${JSON.stringify(path)});
    const sel = tr.querySelector("select");
    if (!sel) throw new Error("Zeile ohne Dropdown: " + ${JSON.stringify(path)});
    sel.value = ${JSON.stringify(wahl)};
    sel.dispatchEvent(new Event("change"));
    return true;
  `);
}

async function klickeImModal(cdp: Cdp, muster: RegExp, was: string): Promise<void> {
  await cdp.evaluate(`
    const m = ${TODO_MODAL};
    if (!m) throw new Error("Auswahl-Modal nicht offen");
    const b = [...m.querySelectorAll(".modal-button-container button")].find((x) => ${muster}.test((x.textContent || "").trim()));
    if (!b) throw new Error("Knopf nicht gefunden: " + ${JSON.stringify(was)});
    b.click();
    return true;
  `);
}

/** Senden = der CTA-Knopf. Er traegt keinen festen Text (die Zahl steckt drin), deshalb
 *  ueber die Klasse — dieselbe, die `setCta()` setzt. */
async function sendeTodoModal(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const m = ${TODO_MODAL};
    if (!m) throw new Error("Auswahl-Modal nicht offen");
    const b = m.querySelector("button.mod-cta");
    if (!b) throw new Error("Senden-Knopf nicht gefunden");
    b.click();
    return true;
  `);
  await requireUntil(cdp, `!(${TODO_MODAL})`, "Modal hat sich nach dem Senden nicht geschlossen");
}

async function setzeFrontmatter(cdp: Cdp, path: string, key: string, wert: string): Promise<void> {
  await cdp.evaluate(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    if (!f) throw new Error("Notiz nicht gefunden: " + ${JSON.stringify(path)});
    await app.fileManager.processFrontMatter(f, (fm) => { fm[${JSON.stringify(key)}] = ${JSON.stringify(wert)}; });
    return true;
  `);
  // MUTATION UND WARTEPHASE TRENNEN (s. `syncTodosAndRead`): das Kommando liest das
  // Frontmatter aus dem `metadataCache`, und der laeuft dem Schreibvorgang hinterher.
  await requireUntil(
    cdp,
    `((app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(path)})) || {}).frontmatter || {})[${JSON.stringify(key)}] === ${JSON.stringify(wert)}`,
    `Frontmatter-Aenderung (${key}) ist im metadataCache nicht angekommen`,
  );
}

async function frontmatterVon(cdp: Cdp, path: string): Promise<Record<string, unknown>> {
  return cdp.evaluate<Record<string, unknown>>(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
    if (!f) return {};
    return (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
  `);
}

/** Notiz zu einer dav_uid — der Pfad haengt am Titel und wird deshalb nicht geraten. */
async function notizMitUid(cdp: Cdp, uid: string): Promise<string> {
  const p = await pollUntil<string>(cdp, `
    for (const f of app.vault.getMarkdownFiles()) {
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (fm["dav_uid"] === ${JSON.stringify(uid)}) return f.path;
    }
    return null;
  `, 20_000, 400);
  if (!p) throw new Error(`Keine Notiz mit dav_uid=${uid} — wurde sie gespiegelt?`);
  return p;
}

/** RFC5545-Zeilenfaltung entfalten, bevor irgendetwas gesucht wird — eine SUMMARY bricht bei
 *  75 Oktetten, und der gesuchte Text stuende dann auf zwei physischen Zeilen. */
function entfalte(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, "");
}

/** Node-seitig auf einen Serverzustand warten. Der PUT laeuft asynchron im Renderer; ein
 *  sofortiges GET misst den Stand davor. Praedikat statt Regex, weil die gesuchten Titel
 *  Klammern tragen — als Regex waeren das Gruppen, und `(geprueft)` matchte auch ohne sie. */
async function warteAufServer(
  radicale: RunningServer,
  relPath: string,
  passt: (body: string) => boolean,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let body = "";
  while (Date.now() < deadline) {
    body = entfalte((await davGet(radicale, relPath)).body);
    if (passt(body)) return body;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  return body;
}

/** Die Ressourcen-Namen einer Sammlung, direkt vom Server (PROPFIND Depth: 1). Der Name der
 *  neu angelegten Aufgabe leitet sich aus einer im Plugin erzeugten UID ab — er ist von
 *  aussen nicht vorhersagbar, und ihn aus dem Plugin zu lesen hiesse, den Pruefling nach dem
 *  Ergebnis zu fragen. */
async function davNamen(radicale: RunningServer, relPath: string): Promise<string[]> {
  const url = new URL(relPath, radicale.baseUrl).toString();
  const res = await fetch(url, {
    method: "PROPFIND",
    headers: { Authorization: davAuthHeader(radicale.user, radicale.pass), Depth: "1", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`,
  });
  const text = await res.text();
  return [...text.matchAll(/<[^>]*href[^>]*>([^<]*\.ics)<\/[^>]*href[^>]*>/gi)].map((m) => (m[1] ?? "").split("/").pop() ?? "");
}

async function checkP25(cdp: Cdp): Promise<void> {
  const r = await cdp.evaluate<{ vorhanden: boolean; mit: boolean; ohne: boolean }>(`
    const cmd = app.commands.commands[${JSON.stringify(TODO_CMD)}];
    if (!cmd || typeof cmd.checkCallback !== "function") return { vorhanden: false, mit: false, ohne: true };
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const vorher = plugin.settings;
    const mit = !!cmd.checkCallback(true);
    // Gegenprobe IM Pruefpunkt (wie bei P21): ohne aktive Aufgaben-Sammlung darf das Kommando
    // NICHT anbietbar sein. Ohne diese Haelfte waere ein checkCallback, das stumpf true
    // liefert, genauso gruen. Nur der Speicher-Zustand wird angefasst, nicht saveSettings —
    // die Einstellungen auf der Platte bleiben unberuehrt.
    let ohne = true;
    try {
      plugin.settings = { ...vorher, collections: vorher.collections.map((c) => ({ ...c, enabled: false })) };
      ohne = !!cmd.checkCallback(true);
    } finally {
      plugin.settings = vorher;
    }
    return { vorhanden: true, mit, ohne };
  `);
  record("P25", "Kommando nur bei aktiver Aufgaben-Sammlung anbietbar", r.vorhanden && r.mit && !r.ohne,
    r.vorhanden ? `mit Sammlung=${r.mit}, ohne Sammlung=${r.ohne} (erwartet: true/false)` : `Kommando ${TODO_CMD} nicht registriert`);
}

/**
 * P26 (Gruppierung), P30 (die Zahl im Senden-Knopf) und P27 (der Schreibvorgang) haengen an
 * EINEM Szenario: die gespiegelte offene Aufgabe wird im Vault abgehakt. Sie zu trennen
 * hiesse, dreimal denselben Zustand herzustellen.
 */
async function checkP26P30P27(cdp: Cdp, radicale: RunningServer, notePath: string): Promise<void> {
  const vorher = await frontmatterVon(cdp, notePath);
  await setzeFrontmatter(cdp, notePath, "status", "done");

  const sicht = await oeffneTodoModal(cdp);
  const imVault = zeilenVon(sicht, GRUPPE.vaultOnly);
  const uebrige = zeilenVon(sicht, GRUPPE.neu).length + zeilenVon(sicht, GRUPPE.konflikt).length;
  record("P26", "Modal fuehrt genau die geaenderte Notiz unter „im Vault geaendert“",
    imVault.length === 1 && imVault[0]?.path === notePath && uebrige === 0,
    `vault-only=[${imVault.map((z) => `${z.path} (${z.felder})`).join(" | ")}], neu+konflikt=${uebrige}, `
      + `Gruppen=[${sicht.gruppen.map((g) => g.label).join(" | ")}]`);

  // P30: die Beschriftung wird nach JEDER Aenderung neu gezogen — Einzel-Dropdown UND
  // Sammelknopf. Kein Unit-Test faengt das: entfernt man `aktualisiereSendenKnopf()` aus
  // `onChange`, bleiben alle Tests gruen (gemessen in Task 8).
  const start = ctaZahl(sicht.cta);
  await setzeWahl(cdp, notePath, "skip");
  const nachSkip = ctaZahl((await leseTodoModal(cdp)).cta);
  await klickeImModal(cdp, /alle auswählen|alle auswaehlen|select all/i, "Alle auswaehlen");
  const nachAlle = await leseTodoModal(cdp);
  const zeileNachAlle = zeilenVon(nachAlle, GRUPPE.vaultOnly)[0];
  record("P30", "Senden-Knopf zaehlt mit — bei Einzelwahl und Sammelknopf",
    start === 1 && nachSkip === 0 && ctaZahl(nachAlle.cta) === 1 && zeileNachAlle?.wahl === "vault",
    `Start=${start}, nach „Überspringen“=${nachSkip}, nach „Alle auswählen“=${ctaZahl(nachAlle.cta)} `
      + `(Dropdown steht auf "${zeileNachAlle?.wahl ?? "—"}")`);

  await sendeTodoModal(cdp);
  const body = await warteAufServer(radicale, "test/aufgaben/t1.ics", (b) => b.includes("STATUS:COMPLETED"));
  const etagVorher = String(vorher["dav_etag"] ?? "");
  const nachher = await pollUntil<Record<string, unknown>>(cdp, `
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    const fm = f ? ((app.metadataCache.getFileCache(f) || {}).frontmatter || {}) : {};
    return String(fm["dav_etag"] || "") !== ${JSON.stringify(etagVorher)} ? fm : null;
  `, 30_000, 500) ?? await frontmatterVon(cdp, notePath);
  const etagNeu = String(nachher["dav_etag"] ?? "");
  // Beide Haelften gehoeren in EINEN Punkt: ein neues ETag ohne Serveraenderung waere ein
  // Resync von irgendetwas, ein COMPLETED ohne neues ETag hiesse, die Notiz kennt den
  // Stand nicht, den sie selbst ausgeloest hat.
  record("P27", "Senden schreibt auf den Server und zieht die Notiz nach",
    /STATUS:COMPLETED/.test(body) && etagNeu !== "" && etagNeu !== etagVorher,
    `Server: ${(body.match(/STATUS:[A-Z-]+/) ?? ["kein STATUS"])[0]}, dav_etag ${etagVorher || "—"} → ${etagNeu || "—"}`);
}

async function checkP28(cdp: Cdp, radicale: RunningServer): Promise<void> {
  await cdp.evaluate(`
    const p = ${JSON.stringify(TODO_NEUE_NOTIZ)};
    if (!app.vault.getAbstractFileByPath(p)) {
      await app.vault.create(p, "---\\ntype: task\\ntitle: Fahrrad reparieren\\nstatus: open\\ndue: 2026-10-01\\n---\\n\\nSchlauch flicken.\\n");
    }
    return true;
  `);
  await requireUntil(
    cdp,
    `((app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(TODO_NEUE_NOTIZ)})) || {}).frontmatter || {})["title"] === "Fahrrad reparieren"`,
    "Neue Aufgaben-Notiz ist im metadataCache nicht angekommen",
  );

  const sicht = await oeffneTodoModal(cdp);
  const neu = zeilenVon(sicht, GRUPPE.neu);
  const inListe = neu.some((z) => z.path === TODO_NEUE_NOTIZ);
  await klickeImModal(cdp, /auswahl aufheben|clear selection/i, "Auswahl aufheben");
  await setzeWahl(cdp, TODO_NEUE_NOTIZ, "vault");
  await sendeTodoModal(cdp);

  // Der Server ist die eine Haelfte: eine neue Ressource mit dem Titel muss entstehen.
  const deadline = Date.now() + 30_000;
  let gefunden = "";
  while (Date.now() < deadline && gefunden === "") {
    for (const name of await davNamen(radicale, "test/aufgaben/")) {
      const r = await davGet(radicale, `test/aufgaben/${name}`);
      if (entfalte(r.body).includes("SUMMARY:Fahrrad reparieren")) { gefunden = name; break; }
    }
    if (gefunden === "") await new Promise((r2) => setTimeout(r2, 500));
  }

  // Die andere Haelfte ist der Punkt: die AUSGANGSNOTIZ muss danach zum Server-Objekt
  // gehoeren. Tut sie es nicht, ist sie beim naechsten Lauf wieder "neu" — und legt die
  // Aufgabe ein zweites Mal an.
  const fm = await pollUntil<Record<string, unknown>>(cdp, `
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(TODO_NEUE_NOTIZ)});
    const c = f ? ((app.metadataCache.getFileCache(f) || {}).frontmatter || {}) : {};
    return c["dav_uid"] ? c : null;
  `, 20_000, 500) ?? await frontmatterVon(cdp, TODO_NEUE_NOTIZ);
  const dubletten = await cdp.evaluate<string[]>(`
    const out = [];
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith("Tasks/")) continue;
      const c = (app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (c["title"] === "Fahrrad reparieren") out.push(f.path);
    }
    return out;
  `);
  record("P28", "Im Vault entstandene Aufgabe wird angelegt UND gehoert danach dem Server",
    inListe && gefunden !== "" && !!fm["dav_uid"] && dubletten.length === 1,
    `in Gruppe „neu“=${inListe}, Server-Ressource=${gefunden || "keine"}, `
      + `dav_uid der Ausgangsnotiz=${JSON.stringify(fm["dav_uid"] ?? null)}, Notizen mit diesem Titel=[${dubletten.join(" | ")}]`);
}

/**
 * P29 — die Bewahrungsprobe, und der Punkt, der einen Defekt faengt statt einen Erfolg zu
 * bestaetigen.
 *
 * Gegenstand ist die nutzersichtbare Zusage aus der Spec: **eine abgebrochene Aufgabe wird
 * nicht zu einer erledigten umgedeutet.** Server: `STATUS:CANCELLED`; das Default-Profil
 * bildet CANCELLED **und** COMPLETED auf `done` ab. Geaendert wird nur der Titel — der
 * Status bleibt in der Notiz, was er ist.
 *
 * ⚠️ Die Gegenprobe dazu ist NICHT „die Bewahrungsregel in `reverseStatus` auskommentieren“,
 * wie der Plan sie vorsah. Gemessen beim Bau: auf diesem Weg ist `status` gar kein
 * geaenderter Schluessel, `planTodoHandEdits` erzeugt fuer ihn also keine Mutation, und der
 * Punkt bliebe auch ohne die Regel gruen. Der Defekt, den er faengt, sitzt eine Ebene
 * darueber: eine Fassung, die alle unterstuetzten Felder mutiert statt nur der geaenderten
 * (die naheliegende Alternative — „schreib die Notiz auf den Server“). Genau die Fassung
 * braeuchte die Bewahrungsregel, und genau die faerbt diesen Punkt rot. Das Rezept steht in
 * `docs/SMOKE.md`.
 */
async function checkP29(cdp: Cdp, radicale: RunningServer): Promise<void> {
  const path = await notizMitUid(cdp, TODO_UID_CANCELLED);
  const neuerTitel = "Umzug nach Bremen (geprueft)";
  await setzeFrontmatter(cdp, path, "title", neuerTitel);

  const sicht = await oeffneTodoModal(cdp);
  const zeile = zeilenVon(sicht, GRUPPE.vaultOnly).find((z) => z.path === path);
  await klickeImModal(cdp, /auswahl aufheben|clear selection/i, "Auswahl aufheben");
  await setzeWahl(cdp, path, "vault");
  await sendeTodoModal(cdp);

  const body = await warteAufServer(radicale, "test/aufgaben/t3.ics", (b) => b.includes(`SUMMARY:${neuerTitel}`));
  const status = (body.match(/STATUS:[A-Z-]+/) ?? ["kein STATUS"])[0];
  record("P29", "Titel-Aenderung an einer ABGEBROCHENEN Aufgabe laesst CANCELLED stehen",
    zeile !== undefined && body.includes(`SUMMARY:${neuerTitel}`) && status === "STATUS:CANCELLED",
    `Zeile im Modal=${zeile ? `ja (${zeile.felder})` : "nein"}, Server: ${status}, `
      + `SUMMARY=${(body.match(/SUMMARY:.*/) ?? ["—"])[0].trim()}`);
}

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
      const c = await attachTo("settings", port, PLUGIN_ID).catch(() => null);
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
    const info = await settingsCdp.evaluate<{ hasPwLabel: boolean; hasDiscoverBtn: boolean; hasAccountRow: boolean; hasCollectionPicker: boolean }>(
      `
      const items = [...document.querySelectorAll(".setting-item")];
      const nameOf = (el) => (el.querySelector(".setting-item-name")?.textContent ?? "").trim();
      const hasPwLabel = items.some((el) => /password|passwort/i.test(nameOf(el)));
      const discoverLabels = ${JSON.stringify(DISCOVER_BUTTON_LABELS)};
      const hasDiscoverBtn = [...document.querySelectorAll("button")].some((b) => discoverLabels.includes((b.textContent ?? "").trim()));
      const hasAccountRow = items.some((el) => (el.textContent ?? "").includes(${JSON.stringify(ACCOUNT_NAME)}));
      // Die Auswahl-Zeilen stehen zwischen der Ueberschrift und der naechsten Ueberschrift.
      // Geprueft wird ein echter Schalter (.checkbox-container), nicht die blosse Ueberschrift:
      // eine Ueberschrift ohne Zeilen darunter waere genau der Fehlstand, der gruen aussieht.
      const pickerLabels = ${JSON.stringify(COLLECTION_PICKER_LABELS)};
      const heading = items.find((el) => pickerLabels.includes(nameOf(el)));
      let hasCollectionPicker = false;
      for (let n = heading?.nextElementSibling; n && !n.classList.contains("setting-item-heading"); n = n.nextElementSibling) {
        if (n.querySelector(".checkbox-container")) { hasCollectionPicker = true; break; }
      }
      return { hasPwLabel, hasDiscoverBtn, hasAccountRow, hasCollectionPicker };
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
    const ok = info.hasPwLabel && info.hasDiscoverBtn && info.hasAccountRow && info.hasCollectionPicker;
    record("P8", "Settings-UI (Konto-Unterseite: SecretComponent, Discovery-Button, Sammlungs-Auswahl)", ok, `${JSON.stringify(info)}; ${shotDetail}`);
  } finally {
    settingsCdp.close();
  }
}

// ── main ─────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const port = Number(arg("port", "9222"));
  const vault = arg("vault", "calendar-notes");
  const section = arg("section", "generic") as Section;
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

  // HERKUNFT DES BUILDS, bevor irgendetwas gemessen wird — und bevor der try-Block den ersten
  // Zustand anfasst (Snapshots, Radicale, Sidebars). Ein Abbruch hier hinterlaesst nichts zum
  // Aufraeumen, deshalb steht er ausserhalb.
  //
  // Der Ort wird aus dem Fenster gelesen, an dem wir tatsaechlich haengen, nicht aus
  // `resolveVaultDir()`: `--vault` waehlt das Fenster ueber den Namen, und geprueft gehoert,
  // was gemessen wird. Faellt beides auseinander (offenes Fenster auf einem anderen Pfad als
  // der erwartete Staging-Vault), zeigt die Fehlermeldung den echten Pfad.
  //
  // Das zweite Argument ist nicht optional, sondern der ganze Punkt: einarmig bliebe nur das
  // `nosourcemap`-Suffix als Indiz, und das FEHLT beim haeufigsten Fehlfall — einem alten
  // eigenen Deploy. Der Guard warnte dann `ungeklaert` und liesse den Fehllauf durch.
  // Setzt voraus, dass `main.js` frisch gebaut ist (`npm run deploy` tut beides).
  //
  // ⚠️ Er ersetzt den Plugin-Reload weiter unten NICHT und wird von ihm nicht ersetzt: dies
  // hier belegt, dass der richtige Build auf der PLATTE liegt, der Reload, dass der PROZESS
  // ihn geladen hat. Beide Luecken sind real und keine deckt die andere ab.
  const ort = await cdp.evaluate<{ basePath: string; configDir: string }>(`
    return { basePath: app.vault.adapter.basePath, configDir: app.vault.configDir };
  `);
  requireEigenerBuild(
    join(ort.basePath, ort.configDir, "plugins", PLUGIN_ID, "main.js"),
    join(REPO_ROOT, "main.js"),
  );

  const cleanupFns: { label: string; run: () => Promise<void> }[] = [];
  let radicale: RunningServer | undefined;

  try {
    const pluginPresent = await cdp.evaluate<boolean>( `return !!app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];`);
    if (!pluginPresent) throw new Error(`Plugin "${PLUGIN_ID}" ist im Fenster "${vault}" nicht geladen — deployt & aktiviert?`);

    // Das Plugin NEU LADEN, bevor irgendetwas gemessen wird. Ein offenes Fenster haelt den
    // Bundle, der beim Oeffnen im Speicher landete — ein frisch deployter `main.js` wird
    // nicht von selbst uebernommen. Ohne diesen Schritt misst der Lauf den ALTEN Stand, und
    // zwar unauffaellig: die Pruefpunkte bleiben gruen, sie sagen nur nichts ueber den Build,
    // den man gerade gebaut hat. Am teuersten faellt das bei der GEGENPROBE auf — ein
    // absichtlich eingebauter Defekt liegt dann gar nicht im laufenden Plugin, die Gegenprobe
    // bleibt gruen und sieht aus wie eine, die nichts findet.
    // (Anstoss von markdown-presentation-87 am 2026-09-03. Diese Stelle fuehrte deren
    // Lagebeschreibung zunaechst als falsch — das war eine Fehllesung: sie schrieb, ihr
    // Treiber tue das "hier" bereits, und "hier" meinte IHR Repo, wo es stimmt. Ich las es
    // als Aussage ueber diesen Treiber. Beide Saetze waren wahr; ein Deiktikon zeigt beim
    // Absender auf sein Repo und beim Empfaenger auf dessen. Vier Woerter mehr — das Repo
    // benennen statt zu zeigen — haetten es verhindert.)
    // Randnotiz: `requireEigenerBuild` (oben, vor dem try) belegt per sha1 die HERKUNFT des
    // Builds, nicht dass der Prozess ihn geladen hat — es ersetzt diesen Reload also nicht,
    // und dieser Reload ersetzt es nicht. Bis 2026-09-04 stand hier "Dieser Treiber nutzt es
    // bislang ohnehin nicht"; seitdem tut er es.
    const reloaded = await cdp.evaluate<string>(`
      const id = ${JSON.stringify(PLUGIN_ID)};
      const before = app.plugins.plugins[id];
      await app.plugins.disablePlugin(id);
      await app.plugins.enablePlugin(id);
      const after = app.plugins.plugins[id];
      if (!after) return "FEHLER: Plugin nach dem Neuladen nicht aktiv";
      return (after === before ? "unveraendert (verdaechtig)" : "frisch geladen") + ", Version " + after.manifest.version;
    `);
    console.log(`Plugin neu geladen: ${reloaded}`);

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
    // P2b VOR `seedAccount`: er richtet sein eigenes Konto ueber die Oberflaeche ein und
    // raeumt es selbst wieder weg. Danach erst die Abkuerzung fuer alles Weitere — die
    // restlichen Pruefpunkte haben einen anderen Gegenstand als die Einrichtung.
    await checkP2bUiAuth(cdp, radicale);
    await seedAccount(cdp, radicale);
    // Gegenprobe VOR der echten Discovery: sie stellt das richtige Passwort selbst wieder her,
    // und P2 belegt danach den Erfolgsfall — erst beide zusammen sagen etwas ueber Auth aus.
    await checkP2aAuth(cdp, radicale);
    const discovery = await discoverAndMerge(cdp);
    await checkP2(discovery, section);

    if (section === "pallas") {
      const profileIds = await createPallasProfiles(cdp);
      await wirePallasCollections(cdp, profileIds);
      await checkP3(cdp, discovery);
    } else if (section === "todo") {
      // P21 misst die Zuweisung aus der Discovery — VOR jeder eigenen Aenderung, sonst
      // prueft er den selbst gesetzten Zustand.
      await checkP21(cdp, discovery);
      await enableOnlyTodo(cdp, discovery.todoId);
      await checkP20(cdp, discovery);
      const note = await syncTodosAndRead(cdp);
      await checkP22to24(cdp, note);
      // M6b (Rueckrichtung). Reihenfolge ist Absicht: P26 zaehlt die Zeilen im Modal, also
      // darf die neue Notiz aus P28 zu dem Zeitpunkt noch nicht existieren.
      await checkP25(cdp);
      if (note.path === "") recordSkip("P26/P27/P30", "Rueckschreiben", "keine gespiegelte Aufgaben-Notiz (s. P22)");
      else await checkP26P30P27(cdp, radicale, note.path);
      await checkP28(cdp, radicale);
      await checkP29(cdp, radicale);
    } else {
      // Die Aufgaben-Sammlung bleibt in `generic` AUS. Sie hat ihren eigenen Abschnitt, und
      // die Zahlen hier (5 creates, Events/=3, Contacts/=2) sind Aussagen ueber Termine und
      // Kontakte — wer die Aufgaben mitlaufen laesst, macht aus jeder davon eine Summe, die
      // nichts mehr benennt.
      await cdp.evaluate(`
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        const todoId = ${JSON.stringify(discovery.todoId)};
        plugin.settings = { ...plugin.settings, collections: plugin.settings.collections.map((c) => ({ ...c, enabled: c.id !== todoId })) };
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
