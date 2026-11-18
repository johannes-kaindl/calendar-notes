/**
 * Mikrotest zur P11/P12-Flake (Task „GUI-Smoke P11 und P12 sind sporadisch rot“): liefert ein GET direkt nach einem
 * erfolgreichen PUT den alten Stand? Fragt Obsidians `requestUrl` im Fenster der Zweitinstanz (der Transport des Plugins)
 * gegen ein wegwerfbares Radicale, in zwei Armen: Standard-Header (wie das Plugin heute) und `Cache-Control: no-cache`.
 *
 * Je Zyklus: PUT (neuer Stand) → GET1 → PUT (Stand 2, If-Match) → Pause d → GET2. „Veraltet“ heißt: das Etag von GET2 ist
 * nicht das Etag, das der zweite PUT gemeldet hat. Dazu je GET der `Date`-Header (gleich dem von GET1 trotz zwischenliegendem
 * PUT = Treffer im HTTP-Cache) und `Last-Modified`.
 *
 * Aufruf (Zweitinstanz mit Staging-Vault wie beim Smoke, Lock davor):
 *   RUNNER=mikrotest über `tools/obsidian-cdp/messlauf.sh` oder
 *   npm run mikrotest -- --port <p> [--zyklen 150] [--pause-max 120]
 */
import { Buffer } from "node:buffer";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachTo, bereiteInstanzVor } from "../../tools/obsidian-cdp/cdp.js";
import { parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { startRadicale } from "./dav-server.js";

// esbuild schreibt die Ausgabe in den Repo-Root (wie in gui-smoke.ts): HERE ist schon die Wurzel.
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PLUGIN_ID = "calendar-notes";
const PROBE_ID = "mikrotest-probe";
const RADICALE_PORT = 5399;
const args = parseArgs(process.argv.slice(2));

interface Zyklus { stale: boolean; putEtag: string; get1Etag: string; get2Etag: string; get1Date: string; get2Date: string; get2Lm: string; pauseMs: number; sameSecond: boolean; grenze: boolean }

function skript(base: string, auth: string, arm: "standard" | "no-cache", n: number, pauseMax: number, praefix: string): string {
  return `
    const requestUrl = window.__mtRequestUrl;
    if (!requestUrl) throw new Error("Probe-Plugin hat requestUrl nicht herausgereicht");
    const base = ${JSON.stringify(base)};
    const headers = (extra) => Object.assign({ Authorization: ${JSON.stringify(auth)} }, ${arm === "no-cache" ? '{ "Cache-Control": "no-cache" }' : "{}"}, extra || {});
    const ics = (uid, seq, summary) => ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//mikrotest//EN","BEGIN:VEVENT","UID:"+uid,"DTSTAMP:20261118T000000Z","DTSTART:2026091"+(seq%9+1)+"T090000","SUMMARY:"+summary+seq,"END:VEVENT","END:VCALENDAR",""].join("\\r\\n");
    const ci = (h, k) => { for (const x of Object.keys(h)) if (x.toLowerCase() === k) return h[x]; return ""; };
    const pause = (ms) => new Promise((r) => window.setTimeout(r, ms));
    const out = [];
    for (let i = 0; i < ${n}; i++) {
      const uid = ${JSON.stringify(praefix)} + i;
      const url = base + uid + ".ics";
      const put1 = await requestUrl({ url, method: "PUT", headers: headers({ "Content-Type": "text/calendar", "If-None-Match": "*" }), body: ics(uid, 1, "a"), throw: false });
      const e1 = ci(put1.headers, "etag");
      // Pause vor GET1 zufaellig, damit die Sekundengrenze wechselnd getroffen wird
      await pause(Math.floor(Math.random() * 1100));
      const g1 = await requestUrl({ url, method: "GET", headers: headers(), throw: false });
      const put2 = await requestUrl({ url, method: "PUT", headers: headers({ "Content-Type": "text/calendar", "If-Match": ci(g1.headers, "etag") }), body: ics(uid, 2, "b"), throw: false });
      const putEtag = ci(put2.headers, "etag");
      const d = Math.floor(Math.random() * ${pauseMax});
      await pause(d);
      const g2 = await requestUrl({ url, method: "GET", headers: headers(), throw: false });
      const g1Date = ci(g1.headers, "date"), g2Date = ci(g2.headers, "date");
      out.push({ stale: ci(g2.headers, "etag") !== putEtag, putEtag, get1Etag: ci(g1.headers, "etag"), get2Etag: ci(g2.headers, "etag"), get1Date: g1Date, get2Date: g2Date, get2Lm: ci(g2.headers, "last-modified"), pauseMs: d, sameSecond: g1Date === g2Date, status: [put1.status, g1.status, put2.status, g2.status], etag1: e1 });
    }
    return out;
  `;
}

async function main(): Promise<void> {
  const portArg = args.value("port");
  if (portArg === undefined || !Number.isInteger(Number(portArg))) throw new Error("--port <n> fehlt.");
  const port = Number(portArg);
  const vault = args.value("vault") ?? "calendar-notes";
  const zyklen = Number(args.value("zyklen") ?? 150);
  const pauseMax = Number(args.value("pause-max") ?? 120);
  const cdp = await attachTo("workspace", port, vault);
  if (!cdp) throw new Error(`Kein Fenster fuer Vault "${vault}" auf Port ${port}.`);
  let radicale: Awaited<ReturnType<typeof startRadicale>> | undefined;
  let probeDir: string | undefined;
  try {
    await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: vault, sprache: "en" });
    // `require("obsidian")` gibt es im Renderer nicht (nur der Plugin-Lader reicht es durch): ein Wegwerf-Plugin im Staging-Vault holt
    // `requestUrl` aus dem echten Modul, dieselbe Funktion, die der Transport des Plugins benutzt.
    const ort = await cdp.evaluate<{ basePath: string; configDir: string }>(`return { basePath: app.vault.adapter.basePath, configDir: app.vault.configDir };`);
    probeDir = join(ort.basePath, ort.configDir, "plugins", PROBE_ID);
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, "manifest.json"), JSON.stringify({ id: PROBE_ID, name: "Mikrotest Probe", version: "0.0.1", minAppVersion: "1.0.0", description: "Wegwerf", author: "x", isDesktopOnly: true }));
    writeFileSync(join(probeDir, "main.js"), `const { Plugin, requestUrl } = require("obsidian"); module.exports = class extends Plugin { onload() { window.__mtRequestUrl = requestUrl; } };`);
    await cdp.evaluate(`await app.plugins.loadManifests(); await app.plugins.enablePlugin(${JSON.stringify(PROBE_ID)}); return !!window.__mtRequestUrl;`);
    radicale = await startRadicale({ port: RADICALE_PORT, fixtureDir: join(REPO_ROOT, "fixtures/radicale"), runDir: join(REPO_ROOT, ".radicale-run", String(RADICALE_PORT)) });
    const auth = "Basic " + Buffer.from("test:test").toString("base64");
    const base = `${radicale.baseUrl}test/kalender/`;
    const version = await cdp.evaluate<string>(`return navigator.userAgent`);
    console.log(`UA: ${version}`);
    for (const arm of ["standard", "no-cache"] as const) {
      const alle: Zyklus[] = [];
      for (let batch = 0; batch < Math.ceil(zyklen / 25); batch++) {
        const n = Math.min(25, zyklen - batch * 25);
        const r = await cdp.evaluate<Zyklus[]>(skript(base, auth, arm, n, pauseMax, `mt-${arm}-${batch}-`), { timeoutMs: 120_000 });
        alle.push(...r);
      }
      const stale = alle.filter((z) => z.stale);
      const gleichDate = alle.filter((z) => z.sameSecond);
      console.log(`ARM ${arm}: ${alle.length} Zyklen, veraltet=${stale.length}, GET1/GET2 mit gleichem Date=${gleichDate.length}`);
      for (const z of stale.slice(0, 6)) console.log("  VERALTET " + JSON.stringify(z));
      const fehl = alle.filter((z) => (z as unknown as { status: number[] }).status.some((s) => s >= 300));
      if (fehl.length) console.log(`  Statusfehler in ${fehl.length} Zyklen, erstes: ${JSON.stringify(fehl[0])}`);
    }
  } finally {
    await radicale?.stop();
    await cdp.evaluate(`try { await app.plugins.disablePlugin(${JSON.stringify(PROBE_ID)}); } catch (e) {} return true;`).catch(() => undefined);
    if (probeDir) rmSync(probeDir, { recursive: true, force: true });
    cdp.close();
  }
}

runDriver(main);
