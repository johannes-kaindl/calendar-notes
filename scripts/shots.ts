/**
 * Aufnahme-Treiber fuer die README-Bilder (Skill `readme-shots`) — faehrt den Vertrag aus
 * `docs/images/README.md` gegen ein LAUFENDES Obsidian, statt die fuenf Bilder von Hand zu
 * klicken. Teilt sich Bruecke, Aufnahme-Primitive und Fixture→Vault mit `scripts/gui-smoke.ts`
 * (zentral: `obsidian-plugins/tools/obsidian-cdp/`) und dasselbe Fixture (`fixtures/vault/`).
 *
 * ## Ablauf
 *
 * ⚠️ **Vor dem Quit koordinieren — Obsidian ist geteilte Infrastruktur.** Dieses Rezept
 * braucht den frischen Start (ein Bild pro Start, jeder Lauf hinterlaesst Zustand); Mitnutzen ist
 * hier keine Alternative. Aber Obsidian ist Single-Instance: der Quit trifft die Instanz, an der
 * moeglicherweise eine andere Session arbeitet, und zerstoert deren Zustand. Der eigene Lauf ist
 * danach sauber gruen; der Schaden faellt nicht auf.
 *
 * ```bash
 * lsof -nP -iTCP:9222 -sTCP:LISTEN >/dev/null && echo "belegt — erst fragen, wem"
 * ```
 *
 * Hoert der Port, haengt jemand dran: **erst fragen, dann quitten.** ⚠️ Und die Pruefung ersetzt die
 * Frage nicht — sie zeigt aktive CDP-Treiber, aber nicht, wer ein Fenster offen haelt oder auf den
 * Port wartet; am 2026-08-30 haette sie einen zwei Stunden alten Reindex nicht gezeigt, denn der
 * hing an Ollama, nicht am Port.
 *
 * ```bash
 * # STAGING_VAULTS_DIR steht in ~/.zshenv (Ort: obsidian-plugins/AGENTS.md § Staging-Vaults).
 * # Hier bewusst KEIN Beispielwert: ein Beispielort in der Doku ist ein zweiter Ort — genau
 * # diese Kommentar-Zeile war ein Glied der Kopier-Kette, die den Drift vom 2026-08-30 erzeugte.
 * npm run build && OBSIDIAN_PLUGIN_DIR="$STAGING_VAULTS_DIR/calendar-notes/.obsidian/plugins/calendar-notes" npm run deploy
 * npm run shots -- --setup                          # Vault aus dem Fixture bauen
 *
 * osascript -e 'quit app "Obsidian"'                # Handarbeit: Debug-Port
 * open -a Obsidian --args --remote-debugging-port=9222
 * #   ... den Aufnahme-Vault oeffnen und einmalig als vertrauenswuerdig bestaetigen
 *
 * npm run shots                                     # alles aufnehmen
 * npm run shots -- --only settings.png               # ein Bild nachziehen
 * npm run shots -- --list                            # Vertrag anzeigen
 * ```
 *
 * Braucht Fensterfokus (`Page.bringToFront`, echte Klicks) — nicht CI-faehig, nie automatisch
 * gestartet. Dieselbe Betriebsbedingung wie `scripts/gui-smoke.ts`: EIN Bild pro frischem
 * Obsidian-Start ist der sichere Weg (`--only`), ein Sammellauf ist nicht als stabil belegt.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, env, exit } from "node:process";

import {
  attachTo,
  Cdp,
  closeExtraLeaves,
  notices,
  openExisting,
  pollUntil,
  releaseAlwaysOnTop,
  requireVisible,
} from "../../tools/obsidian-cdp/cdp.js";
import {
  boxOf,
  capture,
  setWindowSize,
  writeShot,
  type Rect,
  type ShotOptions,
} from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
import { startRadicale, type RunningServer } from "./dav-server.js";

const PLUGIN_ID = "calendar-notes";
const REPO_NAME = "calendar-notes";
const OUT_DIR = "docs/images";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const PADDING = 12;
const FENSTER_BREITE = 1440;
const FENSTER_HOEHE = 900;
// Eigener Port: getrennt vom Default 5232 (scripts/dav-server.ts) und vom
// GUI-Smoke-Port 5298 (scripts/gui-smoke.ts) — dieser Treiber kann parallel zu beiden laufen.
const RADICALE_PORT = 5299;
const ACCOUNT_ID = "acc-shots";
const ACCOUNT_NAME = "Demo";
const SECRET_ID = `calendar-notes-${ACCOUNT_ID}`;
// `settings.accounts.collectionsHeading` aus src/i18n/strings.ts, DE + EN — dasselbe Muster
// wie `scripts/gui-smoke.ts::COLLECTION_PICKER_LABELS`, hier lokal, weil die beiden Treiber
// keine gemeinsame Konstantendatei teilen.
const COLLECTION_PICKER_LABELS = ["Found — what should be mirrored?", "Gefunden — was soll gespiegelt werden?"];

// --- Rezept ------------------------------------------------------------------

interface Shot {
  name: string;
  /** Klasse nach dem Bild-Standard — steuert, ob ein Vorschaubild entsteht. */
  klasse: "hero" | "feature" | "detail";
  /** Stellt den Zustand her und liefert den Bildausschnitt (null = nicht aufnehmbar). */
  run(cdp: Cdp, radicale: RunningServer): Promise<Rect | null>;
}

/** Konto anlegen + Passwort im Schluesselbund hinterlegen — Zustand fuer settings.png
 *  UND Voraussetzung fuer Discovery/Sync in den folgenden Bildern. */
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

/** Discovery + Merge — legt die zwei Sammlungen (Kalender/Adressbuch) an und aktiviert sie,
 *  damit Sync/Adoption in den folgenden Bildern etwas zu tun haben. */
async function discoverAndEnable(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const account = plugin.settings.accounts.find((a) => a.id === ${JSON.stringify(ACCOUNT_ID)});
    const result = await plugin.discoverAccount(account);
    plugin.settingTab.mergeDiscoveredCollections(account, result);
    plugin.settings = {
      ...plugin.settings,
      collections: plugin.settings.collections.map((c) => ({ ...c, enabled: true })),
    };
    await plugin.saveSettings();
    // Deklarativer Tab (getSettingDefinitions): zeigt den Stand des letzten update() —
    // ein Setzen von plugin.settings am Tab vorbei ist fuer ihn unsichtbar (gemessen
    // 2026-08-23: settings.png zeigte "Noch keine Konten" bei gesetztem Konto).
    plugin.settingTab.update();
    return true;
  `);
}

/** Fuer adoption.png: eigene Profile aus den Pallas-Fixture-Notizen ableiten (wie
 *  `scripts/gui-smoke.ts::createPallasProfiles`) und die Sammlungen darauf umstellen, DAMIT
 *  die Adoption ueberhaupt Kandidaten findet (Notizen ohne `dav_source`). */
async function wirePallasForAdoption(cdp: Cdp): Promise<string> {
  return cdp.evaluate<string>(`
    const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
    const alex = app.vault.getAbstractFileByPath(
      "Pallas/50_Ressourcen/10_Reference/10_Kontakte/Alex Aguado.md");
    const zahn = app.vault.getAbstractFileByPath(
      "Pallas/30_Chronos/70_Termine/10_Anstehend/2026-09-01 Zahnärztin.md");
    if (!alex || !zahn) throw new Error("Pallas-Fixture-Notizen fehlen — --setup gelaufen?");
    await plugin.createProfileFromNote("contact", alex);
    await plugin.createProfileFromNote("event", zahn);
    const profiles = plugin.settings.profiles;
    const contactProfileId = profiles[profiles.length - 2].id;
    const eventProfileId = profiles[profiles.length - 1].id;
    plugin.settings = {
      ...plugin.settings,
      collections: plugin.settings.collections.map((c) => ({
        ...c,
        enabled: true,
        profileId: c.kind === "addressbook" ? contactProfileId : eventProfileId,
      })),
    };
    await plugin.saveSettings();
    const calendarCollection = plugin.settings.collections.find((c) => c.kind === "calendar");
    return calendarCollection.id;
  `);
}

/** Offene Modals schliessen — jedes Bild startet sonst unter dem Overlay des vorigen
 *  (preview → PreviewModal, adoption → AdoptionModal bleiben offen; gemessen 2026-08-23:
 *  drei Modals uebereinander, event-note.png waere abgedunkelt gewesen). */
async function closeModals(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    for (const m of Array.from(document.querySelectorAll(".modal-container"))) {
      const btn = m.querySelector(".modal-close-button");
      if (btn) btn.click(); else m.remove();
    }
    await new Promise((r) => setTimeout(r, 300));
    return true;
  `);
}

const SHOTS: Shot[] = [
  {
    name: "settings.png",
    klasse: "detail",
    async run(cdp, radicale) {
      await seedAccount(cdp, radicale);
      // Discovery + Sammlungen aktivieren — Voraussetzung fuer preview/event-note/adoption/
      // command-form; ohne aktivierte Sammlung hat der Sync nichts zu tun, die Adoption keinen
      // Kalender und das Formular keine Auswahl (gemessen 2026-08-23: 3 von 5 Bildern leer).
      await discoverAndEnable(cdp);
      // Einstellungen-Tab: eigenes Fenster seit Obsidian 1.13 (URL about:blank), s.
      // docs/SMOKE.md P8. Wird unten in main() ueber attachTo("settings", …) fotografiert,
      // nicht hier — dieser Shot liefert nur den Zustand, den main() dann aufnimmt.
      return null;
    },
  },
  {
    name: "preview.png",
    klasse: "feature",
    async run(cdp) {
      // Kommando statt privater Methode: "Preview sync (dry run)" fuehrt runAll({dryRun:true})
      // aus und oeffnet die PreviewModal selbst.
      await cdp.evaluate(`
        await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:sync-preview`)});
        return true;
      `);
      const da = await pollUntil<boolean>(cdp, `
        return !!document.querySelector(".modal-container .modal-content");
      `, 15_000, 300);
      if (!da) return null;
      return boxOf(cdp, ".modal-container .modal", PADDING);
    },
  },
  {
    name: "event-note.png",
    klasse: "feature",
    async run(cdp) {
      // Echter Sync-Lauf legt die Notizen erst an — vorher gibt es unter Events/ nur den
      // Fixture-Platzhalter _index.md.
      await cdp.evaluate(`
        await app.commands.executeCommandById(${JSON.stringify(`${PLUGIN_ID}:sync-all`)});
        return true;
      `);
      const gefunden = await pollUntil<string | null>(cdp, `
        const f = app.vault.getMarkdownFiles()
          .find((f) => f.path.startsWith("Events/") && f.path.includes("Teamrunde"));
        return f ? f.path : null;
      `, 20_000, 500);
      if (!gefunden) return null;
      if (!(await openExisting(cdp, gefunden, "preview"))) return null;
      await closeExtraLeaves(cdp);
      return boxOf(cdp, ".workspace-leaf.mod-active .markdown-reading-view", PADDING);
    },
  },
  {
    name: "adoption.png",
    klasse: "feature",
    async run(cdp) {
      const collectionId = await wirePallasForAdoption(cdp);
      await cdp.evaluate(`
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        await plugin.startAdoption(${JSON.stringify(collectionId)});
        return true;
      `);
      const da = await pollUntil<boolean>(cdp, `
        return !!document.querySelector(".modal-container .modal-content");
      `, 15_000, 300);
      if (!da) return null;
      return boxOf(cdp, ".modal-container .modal", PADDING);
    },
  },
  {
    name: "command-form.png",
    klasse: "detail",
    async run(cdp) {
      await cdp.evaluate(`
        const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
        plugin.commandFlow.newEvent();
        return true;
      `);
      // KindCollectionSuggestModal (Fuzzy-Suggest) zuerst — irgendeine aktivierte
      // Kalender-Sammlung waehlen, danach oeffnet sich das eigentliche Formular.
      const gewaehlt = await pollUntil<boolean>(cdp, `
        const item = document.querySelector(".suggestion-item");
        if (!item) return false;
        item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      `, 10_000, 300);
      if (!gewaehlt) return null;
      const da = await pollUntil<boolean>(cdp, `
        return !!document.querySelector(".modal-container .modal-content form, .modal-container .modal-content .setting-item");
      `, 10_000, 300);
      if (!da) return null;
      return boxOf(cdp, ".modal-container .modal", PADDING);
    },
  },
];

/** Der Einstellungen-Tab lebt in einem EIGENEN Fenster (Obsidian 1.13, URL about:blank) —
 *  dasselbe Muster wie in `3d-codeblocks/scripts/shots.ts::settingsBild`. Schliesst sich,
 *  sobald ein anderes Fenster den Fokus bekommt, deshalb passiert alles in einem Zug. */
async function settingsBild(port: number, opts: ShotOptions): Promise<string> {
  const werkspace = await attachTo("workspace", port, REPO_NAME);
  if (!werkspace) return "settings.png — kein Werkstatt-Fenster gefunden";
  // Mutation und Wartephase getrennt (Muster aus obsidian-plugins/AGENTS.md, Referenz
  // paperless-storage/scripts/gui-smoke.ts:201): dieser Aufruf loest nur das Oeffnen aus,
  // keine feste Frist mehr. Vorher stand hier `await new Promise((r) => setTimeout(r, 900))` —
  // reichte bei einem bereits existierenden Demo-Konto nicht, bis die Discovery-Zeilen
  // ("Gefunden — was soll gespiegelt werden?") gerendert waren; das Bild zeigte nur den
  // Konto-Teil, ohne die drei Schalter.
  await werkspace.evaluate(`
    app.setting.open();
    app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
    return true;
  `);
  werkspace.close();
  // Das Einstellungen-Fenster entsteht asynchron — eigene Wartephase fuer die
  // Fensterexistenz, getrennt von der Wartephase fuer den Inhalt weiter unten (Muster wie
  // scripts/gui-smoke.ts::checkP8SettingsUi).
  const fenster = await (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const c = await attachTo("settings", port, REPO_NAME).catch(() => null);
      if (c) return c;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  })();
  if (!fenster) return "settings.png — kein Einstellungen-Fenster gefunden";
  try {
    await requireVisible(fenster);
    // `.vertical-tab-content` scrollt bei Standardgroesse intern — `getBoundingClientRect`
    // liefert dann nur die SICHTBARE Hoehe (`clientHeight`), nicht `scrollHeight`. Ohne diese
    // Zeile schnitt der Screenshot die Discovery-Zeilen still ab, selbst wenn sie laengst
    // gerendert waren — gemessen an dieser Gegenprobe: mit reiner Timing-Korrektur, aber ohne
    // Resize, zeigte settings.png weiterhin nur den Konto-Teil. Muster + Wert aus
    // `3d-codeblocks/scripts/shots.ts::settingsBild` (dort seit 0.4.0 fuer denselben Effekt).
    await setWindowSize(fenster, 1100, 1500);
    await new Promise((r) => setTimeout(r, 600));
    // Wartephase: bis die Discovery-Zeilen (Checkbox je Sammlung) unter der Ueberschrift
    // gerendert sind — dasselbe Kriterium wie P8 in scripts/gui-smoke.ts.
    const gerendert = await pollUntil<boolean>(
      fenster,
      `
      const pickerLabels = ${JSON.stringify(COLLECTION_PICKER_LABELS)};
      const items = [...document.querySelectorAll(".setting-item")];
      const nameOf = (el) => (el.querySelector(".setting-item-name")?.textContent ?? "").trim();
      const heading = items.find((el) => pickerLabels.includes(nameOf(el)));
      if (!heading) return false;
      for (let n = heading.nextElementSibling; n && !n.classList.contains("setting-item-heading"); n = n.nextElementSibling) {
        if (n.querySelector(".checkbox-container")) return true;
      }
      return false;
    `,
      10_000,
      300,
    );
    if (!gerendert) return "settings.png — Discovery-Zeilen nicht gerendert (Timeout)";
    const box = await boxOf(fenster, ".vertical-tab-content", 0)
      ?? await boxOf(fenster, ".modal-content", 0);
    if (!box) return "settings.png — kein Inhaltsbereich im Einstellungen-Fenster";
    const png = await capture(fenster, box);
    return await writeShot(fenster, "settings.png", png, { ...opts, thumb: true });
  } finally {
    await releaseAlwaysOnTop(fenster).catch(() => undefined);
    await fenster.evaluate("window.close(); return true;").catch(() => undefined);
    fenster.close();
  }
}

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(): Promise<void> {
  const repoRoot = cwd();
  const outDir = join(repoRoot, OUT_DIR);

  if (argv.includes("--list")) {
    for (const s of SHOTS) console.log(`  ${s.klasse.padEnd(8)} ${s.name}`);
    return;
  }

  if (argv.includes("--setup")) {
    const vaultDir = stagingVaultDir(REPO_NAME);
    console.log(`Aufnahme-Vault: ${vaultDir}`);
    for (const zeile of buildVault({
      repoRoot,
      vaultDir,
      fixtureDir: join(repoRoot, "fixtures/vault"),
      pluginId: PLUGIN_ID,
    })) {
      console.log(`  ${zeile}`);
    }
    console.log(
      "\n⚠️  Lief Obsidian waehrend dieses Setups, muss es JETZT neu starten. --setup hat\n" +
      "   Notizen, Layout und Plugin-Einstellungen ersetzt.\n" +
      "\n⚠️  Erst prüfen, ob schon ein Obsidian läuft — ein Quit zerstört den Zustand\n" +
      "    einer fremden Session, und der eigene Lauf ist danach trotzdem grün:\n" +
      "      lsof -nP -iTCP:9222 -sTCP:LISTEN\n" +
      "    Hört der Port, hängt jemand dran: erst fragen, dann quitten.\n" +
      "\nObsidian mit offenem Debug-Port starten und diesen Vault oeffnen:\n" +
      "  osascript -e 'quit app \"Obsidian\"'\n" +
      "  open -a Obsidian --args --remote-debugging-port=9222\n" +
      "Beim ersten Mal fragt Obsidian, ob es dem Vault-Autor vertraut — bestaetigen,\n" +
      "sonst laeuft das Plugin nicht.",
    );
    return;
  }

  const port = Number(flag("--port") ?? env.SHOTS_PORT ?? 9222);
  const nur = flag("--only");

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const radicale = await startRadicale({
    port: RADICALE_PORT,
    fixtureDir: join(repoRoot, "fixtures/radicale"),
    runDir: join(repoRoot, `.radicale-run/${RADICALE_PORT}`),
  });
  console.log(`Radicale (Fixture) auf ${radicale.baseUrl}.`);

  try {
    const cdp = await attachTo("workspace", port, REPO_NAME);
    if (!cdp) {
      throw new Error(
        `Kein Obsidian-Fenster mit dem Vault "${REPO_NAME}" auf Port ${port}.\n` +
        "Den Aufnahme-Vault oeffnen (er darf neben anderen Vaults offen sein):\n" +
        `  open -a Obsidian "$STAGING_VAULTS_DIR/${REPO_NAME}"`,
      );
    }
    console.log(`Verbunden auf Port ${port}.\n`);
    await requireVisible(cdp);
    await new Promise((r) => setTimeout(r, 2000));

    await setWindowSize(cdp, FENSTER_BREITE, FENSTER_HOEHE);

    let ok = 0;
    let fehlend = 0;
    for (const shot of SHOTS) {
      if (nur && shot.name !== nur) continue;
      // settings.png hat keinen eigenen Ausschnitt (eigenes Fenster) — Konto einmalig
      // anlegen und danach ueber settingsBild() aufnehmen.
      if (shot.name === "settings.png") {
        await shot.run(cdp, radicale);
        console.log(`  · ${await settingsBild(port, {
          outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH,
        })}`);
        continue;
      }
      try {
        await closeModals(cdp);
        const box = await shot.run(cdp, radicale);
        const png = box ? await capture(cdp, box) : null;
        if (!png) {
          console.log(`  ✗ ${shot.name} — Zustand kam nicht zustande`);
          fehlend++;
          continue;
        }
        console.log(`  ✓ ${await writeShot(cdp, shot.name, png, {
          outDir,
          captureWidth: CAPTURE_WIDTH,
          thumbWidth: THUMB_WIDTH,
          thumb: shot.klasse === "detail",
        })}`);
        ok++;
      } catch (err) {
        console.log(`  ✗ ${shot.name} — ${(err as Error).message}`);
        fehlend++;
      }
    }

    const meldungen = await notices(cdp);
    if (meldungen) console.log(`\nNotices waehrend des Laufs:\n${meldungen}`);

    cdp.close();
    console.log(`\n${ok} Bild(er) geschrieben, ${fehlend} offen.`);
    if (fehlend) exit(1);
  } finally {
    await radicale.stop();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  exit(1);
});
