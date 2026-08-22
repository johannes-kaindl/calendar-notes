// Startet ein wegwerfbares Radicale mit dem getrackten Fixture (Spec §6.2). Maintainer-lokal + CI.
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DavRequest, DavResponse, Transport } from "../src/core/dav/types";

export interface RunningServer { baseUrl: string; user: string; pass: string; dir: string; stop(): Promise<void> }

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const FIXTURE = resolve(HERE, "../fixtures/radicale");

export function nodeTransport(): Transport {
  return async (req: DavRequest): Promise<DavResponse> => {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, redirect: "manual" });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, headers, text: await res.text() };
  };
}

async function has(cmd: string): Promise<boolean> {
  return new Promise((ok) => { const r = spawn("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }); r.on("close", (c) => ok(c === 0)); });
}

export async function startRadicale(opts: { port?: number; fixtureDir?: string; runDir?: string } = {}): Promise<RunningServer> {
  const port = opts.port ?? 5232;
  const src = opts.fixtureDir ?? FIXTURE;
  // `HERE` zeigt nach dem esbuild-Buendeln (gui-smoke.ts importiert dieses Modul) auf die
  // Ausgabedatei im Repo-Root statt auf `scripts/` — `opts.runDir` laesst den Aufrufer den
  // tatsaechlichen Repo-Root explizit angeben, statt sich auf `import.meta.url` zu verlassen
  // (s. Kommentar am CLI-Modus unten fuer denselben Befund an anderer Stelle).
  const dir = opts.runDir ?? resolve(HERE, `../.radicale-run/${port}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(src, dir, { recursive: true });
  const cfg = readFileSync(join(src, "config"), "utf8").replace(/__DIR__/g, dir).replace(/hosts = .*/, `hosts = 127.0.0.1:${port}`);
  writeFileSync(join(dir, "config"), cfg);
  let child: ChildProcess;
  if (await has("radicale")) child = spawn("radicale", ["--config", join(dir, "config")], { stdio: ["ignore", "ignore", "pipe"] });
  else if (await has("uvx")) child = spawn("uvx", ["--from", "radicale", "radicale", "--config", join(dir, "config")], { stdio: ["ignore", "ignore", "pipe"] });
  else throw new Error("Weder `radicale` noch `uvx` gefunden — `pip install radicale` oder `brew install uv`.");
  let stderr = "";
  let spawnError: Error | undefined;
  child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
  child.on("error", (err) => { spawnError = err; });
  const baseUrl = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Radicale konnte nicht gestartet werden: ${spawnError.message}`);
    try { const r = await fetch(baseUrl, { method: "GET" }); if (r.status > 0) break; } catch { /* noch nicht da */ }
    if (child.exitCode !== null) throw new Error(`Radicale beendet (${child.exitCode}): ${stderr}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  if (spawnError) throw new Error(`Radicale konnte nicht gestartet werden: ${spawnError.message}`);
  if (Date.now() >= deadline) { child.kill(); throw new Error(`Radicale antwortet nicht auf ${baseUrl}: ${stderr}`); }
  return {
    baseUrl, user: "test", pass: "test", dir,
    stop: () => new Promise<void>((ok) => {
      if (child.exitCode !== null || spawnError) { ok(); return; }
      const killTimer = setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      child.once("exit", () => { clearTimeout(killTimer); ok(); });
      child.kill("SIGTERM");
    }),
  };
}

// CLI-Modus. Der zusaetzliche Namens-Check ist noetig, seit `gui-smoke.ts` dieses Modul
// importiert und per esbuild in EINE Datei buendelt: gebuendelt teilen sich alle Module
// dasselbe `import.meta.url` (das der Ausgabedatei) — ohne den Check wuerde der Vergleich
// `process.argv[1] === fileURLToPath(import.meta.url)` dann IMMER zutreffen (beide Seiten
// zeigen auf `.gui-smoke.mjs`) und ein zweites, unkontrolliertes Radicale auf dem
// Default-Port starten, noch bevor `main()` in gui-smoke.ts ueberhaupt laeuft.
if (
  /dav-server\.(ts|mjs|js)$/.test(fileURLToPath(import.meta.url)) &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const s = await startRadicale({ port: Number(process.env["RADICALE_PORT"] ?? 5232) });
  console.log(`Radicale läuft: ${s.baseUrl} (user ${s.user} / pass ${s.pass}) — Daten in ${s.dir}. Ctrl-C beendet.`);
  process.on("SIGINT", () => { void s.stop().then(() => process.exit(0)); });
  await new Promise(() => { /* läuft */ });
}
