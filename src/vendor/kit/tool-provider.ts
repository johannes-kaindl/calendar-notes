// vendored from obsidian-kit@0.63.0, src/pure/tool-provider.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Vertrag `tool-provider` — ein Plugin bietet seine Fähigkeiten als LLM-Werkzeuge an, ein Wirt mit
 *  Agenten-Loop (koda-agent, später vault-crews) montiert sie, statt sie nachzubauen. Stern statt Netz:
 *  N Anbieter, 2 Wirte, ein Vertrag. Muster `pure/endpoint-source.ts`: EINE Quelle, der Anbieter
 *  hängt die Methoden an sein `plugin.api`, der Wirt prüft die Form (`isToolProviderApi`), nicht eine
 *  gespiegelte Versionszahl (LESSONS 2026-09-25).
 *
 *  Herkunft: Wirtsseite koda-agent `src/core/tools/provider.ts` (Spike 2026-09-25), Anbieterseite
 *  vault-rag `feat/tool-provider` (Vertragsstand 92c6c4d) und calendar-notes `src/core/api/types.ts`.
 *  Das Lesen aus `app.plugins` steht in `obsidian/tool-providers.ts`.
 *
 *  Festlegungen (Cockpit-Task „Werkzeug-Anbieter-Vertrag“, 2026-09-25, plus die vier des Kit-Zugs):
 *  (a) Der Name ist die Wire-Identität: montiert wird unverändert, nie umbenannt. Kollisionen werden
 *      NICHT montiert, sondern gemeldet — der Wirt gewinnt gegen jeden Anbieter, unter Anbietern der
 *      zuerst gelesene. Ein stilles Überschreiben schickte `executeTool(name)` an den falschen Anbieter.
 *  (b) Die Sprache nennt der Wirt (`tools({ lang })`), den Text liefert der Anbieter.
 *  (c) `content`/`message` sind der Text, den das Modell sieht; `data` ist für die Oberfläche des Wirts.
 *  (d) `writes` steht an der Definition; ein schreibendes Werkzeug ruft `confirm` mit einer
 *      nebenwirkungsfreien Vorschau und endet ohne `confirm` oder bei `false` mit `needs-confirm`.
 *      Das Kennzeichen geht NICHT auf den Draht (`mountProviderTools`): das Modell braucht es nicht,
 *      und ein fremdes Feld in der Function-Definition lehnen manche Server ab.
 *  (e) **EIN Schritt `executeTool(name, args, opts)`, kein `plan`/`execute(plan)` im Vertrag.** calendar-notes
 *      kennt zwei Schritte, weil `plan()` dort ein typisiertes Objekt (`ApiPlan` mit Notiz-Operationen
 *      und Ziel-Referenz) liefert, das der Aufrufer hält und später zurückgibt. Das ist Plugin-Zustand
 *      und gehört nicht über die Plugin-Grenze: ein Wirt, der ihn hielte, müsste die Typen jedes
 *      Anbieters kennen. Der Anbieter macht `plan → confirm(Vorschau) → execute` INTERN.
 *      **Die Vorschau ist verbindlich, nicht Auskunft:** `paths` ist die vollständige Obergrenze der
 *      Vault-Pfade, die der Aufruf berührt, der Anbieter schreibt nirgends sonst und ruft `confirm`
 *      genau einmal vor dem ersten Schreiben. Das ist, was ein Wirt mit festem Ablauf (vault-crews)
 *      braucht: sein `confirm` prüft `paths` gegen den `write_scope`, legt den Snapshot an und
 *      antwortet; die Argumente validiert er VOR `executeTool` gegen `parameters` (einen Validator
 *      hält die Bibliothek nicht, siehe Gegenleser-Befund in der Meldung). Wirkungen außerhalb des
 *      Vaults (Server, Mail) stehen in `outside`, damit auch sie vor der Entscheidung sichtbar sind.
 *      Weigert sich der Wirt (`confirm` liefert `false`), antwortet der Anbieter `needs-confirm`; der
 *      Wirt kennt seinen Grund selbst, ein eigener Fehlergrund „abgelehnt“ brächte ihm nichts.
 *  (f) **Der Methodenname ist `executeTool`, nicht `execute`** (gemessen am Gegenleser 2026-10-14): ein Anbieter
 *      hängt die Methoden an sein `plugin.api`, und calendar-notes trägt dort `execute(plan: ApiPlan)` bereits
 *      (`src/core/api/types.ts:143`, in `docs/API.md` den Crews als `plan`+`execute` empfohlen). Derselbe
 *      Schlüssel hieße zwei Dinge; ein Wirt riefe `execute("event_move", args, opts)` auf dem Plan-Schritt
 *      und bekäme ein `{ error }` statt eines `ProviderResult`. Eine Umbenennung dort bräche deren dokumentierte
 *      API, die Umbenennung des Vertrags kostet koda-agent und vault-rag (`feat/tool-provider`, ungemergt) je
 *      eine Zeile. `tools()` kollidiert nicht (calendar-notes' `tools()` ist dieselbe Sache mit weniger Feldern).
 *  (g) **Feldname `version`, nicht `apiVersion`** (Entscheidung Johannes 2026-10-12, REGISTRY Z37):
 *      `version` heißt „Vertrag aus der Bibliothek“, `apiVersion` bleibt der eigene Vertrag des
 *      Plugins. Ein Anbieter wie vault-rag trägt beide an einem Objekt.
 *  (h) Kein `status()` im Vertrag (die REGISTRY-Zeile nannte es): die Wirte brauchen es nicht — ein
 *      Anbieter, dessen Werkzeuge gerade nicht laufen können, liefert in `tools()` eine leere Liste
 *      (vault-rag ohne Index), und ein Wirt, der sonst nach einem „läuft es?“ fragte, riefe `tools()`
 *      ohnehin. `status()` bleibt, was es ist: eine plugin-eigene Methode.
 *
 *  Fehler sind Werte, nie Ausnahmen — der Wirt glaubt das aber nicht: `callProviderTool` fängt, was
 *  ein fremdes Plugin trotzdem wirft. */
export const TOOL_PROVIDER_API_VERSION = 1;

export type ToolLang = "de" | "en";

export interface ProviderToolDef {
  name: string;
  description: string;
  /** JSON-Schema des Objekts der Argumente (`{ type: "object", properties, required }`). Bewusst `object`
   *  statt `Record<string, unknown>`: ein als `interface` deklariertes Schema (vault-rag, calendar-notes)
   *  hat keine Index-Signatur und passte sonst nicht hinein. */
  parameters: object;
  /** Pflicht. Ein Anbieter ohne dieses Kennzeichen fällt durch den Form-Guard: ein Wirt, der rät,
   *  montierte zwanzig Schreibkommandos ohne Kennzeichen. */
  writes: boolean;
}

/** Nebenwirkungsfreie Vorschau eines Schreibvorgangs: `summary` für die Bestätigung, `paths` für
 *  die Prüfung gegen eine Schreibgrenze (vault-crews `write_scope`), `outside` für alles jenseits des Vaults. */
export interface ProviderConfirmPreview {
  summary: string;
  /** Vollständige Obergrenze der Vault-Pfade, die dieser Aufruf berührt (Festlegung (e)). */
  paths: string[];
  /** Wirkungen außerhalb des Vaults, je eine Zeile für den Menschen („CalDAV-Server: Termin löschen“,
   *  „Einladung per Mail an 2 Personen“). Fehlt oder leer: keine. */
  outside?: string[];
}

export interface ProviderCallOptions {
  lang?: ToolLang;
  /** Pflicht für jedes `writes:true`-Werkzeug — ohne sie oder bei `false` endet der Anbieter mit
   *  `needs-confirm`. Der Wirt entscheidet, was Bestätigen heißt. */
  confirm?: (preview: ProviderConfirmPreview) => Promise<boolean>;
}

/** Fehlergründe nach dem GEGENSTAND der Aussage geschnitten (Werkzeug, Argument, Anbieter,
 *  Bestätigung), nicht nach Fehlerquelle — Vertragsstand 92c6c4d. `unavailable.detail` ist ein freier
 *  String des Anbieters (vault-rag: `no-index`, `offline`); `not-indexed` bleibt ein eigener Grund,
 *  damit der Wirt einen Satz VOR die message setzen kann, ohne eine Notiz zu lesen. */
export type ProviderResult =
  | { ok: true; content: string; data?: unknown }
  | { ok: false; reason: "unknown-tool"; message: string }
  | { ok: false; reason: "bad-args"; field: string; message: string }
  | { ok: false; reason: "failed"; message: string }
  | { ok: false; reason: "needs-confirm"; message: string }
  | { ok: false; reason: "unavailable"; detail: string; message: string }
  | { ok: false; reason: "not-indexed"; path: string; message: string };

export interface ToolProviderApi {
  /** Vertrag aus der Bibliothek (`TOOL_PROVIDER_API_VERSION`). */
  version: 1;
  /** Synchron und netzfrei, ohne Nebenwirkung — der Wirt baut seine Werkzeugliste synchron, und der
   *  Form-Guard ruft `tools()` einmal. Leer, solange der Anbieter nichts anbieten kann. */
  tools(opts?: { lang?: ToolLang }): ProviderToolDef[];
  /** Führt ein Werkzeug aus. Wirft nie: erwartbare Zustände und unbrauchbare Argumente sind Werte. */
  executeTool(name: string, args: Record<string, unknown>, opts?: ProviderCallOptions): Promise<ProviderResult>;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

type DefField = "name" | "description" | "parameters" | "writes";

/** Das erste Feld einer Definition, das den Vertrag verfehlt; `null`, wenn sie vollständig ist. */
function defProblem(x: unknown): DefField | null {
  if (!isRecord(x)) return "name";
  if (typeof x.name !== "string" || x.name.trim() === "") return "name";
  if (typeof x.description !== "string") return "description";
  if (!isRecord(x.parameters)) return "parameters";
  if (typeof x.writes !== "boolean") return "writes";
  return null;
}

/** Warum `isToolProviderApi` ein Objekt ablehnt — der Guard selbst schweigt, und ein Anbieter ohne `version` (vault-rag vor
 *  Welle 22) oder ohne `writes` (calendar-notes 0.2.1) verschwände sonst ohne Spur aus der Werkzeugliste des Wirts. */
export type ToolProviderRejection =
  | { reason: "not-an-object" }
  | { reason: "version"; found: unknown }
  | { reason: "missing-method"; method: "tools" | "executeTool" }
  | { reason: "tools-threw" }
  | { reason: "tools-not-array" }
  | { reason: "bad-definition"; index: number; field: DefField };

/** `null`, wenn `x` den Vertrag erfüllt, sonst der erste Grund. **Die einzige Stelle der Prüfung:** `isToolProviderApi` ist
 *  `toolProviderRejection(x) === null`, die beiden können nicht auseinanderlaufen. Ruft wie der Guard `tools()` einmal. */
export function toolProviderRejection(x: unknown): ToolProviderRejection | null {
  if (!isRecord(x)) return { reason: "not-an-object" };
  if (x.version !== TOOL_PROVIDER_API_VERSION) return { reason: "version", found: x.version };
  if (typeof x.tools !== "function") return { reason: "missing-method", method: "tools" };
  if (typeof x.executeTool !== "function") return { reason: "missing-method", method: "executeTool" };
  let defs: unknown;
  try {
    defs = (x.tools as () => unknown)();
  } catch {
    return { reason: "tools-threw" };
  }
  if (!Array.isArray(defs)) return { reason: "tools-not-array" };
  for (let index = 0; index < defs.length; index++) {
    const field = defProblem(defs[index]);
    if (field !== null) return { reason: "bad-definition", index, field };
  }
  return null;
}

/** Form prüfen, nicht Vorhandensein: `version` 1, `tools` und `executeTool` müssen Funktionen sein, und
 *  `tools()` muss ein Array vollständiger Definitionen liefern — auch leer (ein Anbieter ohne Index
 *  bietet nichts an, ist aber ein Anbieter). `tools()` wird dafür einmal gerufen. Den Grund einer Ablehnung
 *  nennt `toolProviderRejection`. */
export function isToolProviderApi(x: unknown): x is ToolProviderApi {
  return toolProviderRejection(x) === null;
}

/** Werkzeug im Wire-Format der Wirte (OpenAI-Function-Calling, ohne den `type: "function"`-Mantel). */
export interface WireToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderOffer { id: string; tools: ProviderToolDef[] }

export interface MountedTools {
  /** Wirts-Werkzeuge zuerst, dann die montierten — in Lesereihenfolge der Anbieter. */
  defs: WireToolDef[];
  /** Werkzeugname → Anbieter-Id; Wirts-Werkzeuge stehen nicht darin. */
  routes: Map<string, string>;
  /** Montierte Werkzeuge mit `writes: true`. */
  writes: Set<string>;
  skipped: { name: string; providerId: string; reason: "collision-host" | "collision-provider" }[];
}

/** Montiert die Werkzeuge der Anbieter hinter die des Wirts. **Die Menge, die den Draht baut, liefert
 *  auch die Route** — der Runner führt nach `routes` aus, nie nach dem Namen (koda-Spike: die erste
 *  Fassung routete nach Kodas Namen und schickte das montierte `related_notes` ins Leere). */
export function mountProviderTools(host: readonly WireToolDef[], providers: readonly ProviderOffer[]): MountedTools {
  const defs: WireToolDef[] = host.map((d) => ({ ...d }));
  const routes = new Map<string, string>();
  const writes = new Set<string>();
  const skipped: MountedTools["skipped"] = [];
  const hostNames = new Set(host.map((d) => d.name));
  for (const p of providers) {
    for (const t of p.tools) {
      if (hostNames.has(t.name)) { skipped.push({ name: t.name, providerId: p.id, reason: "collision-host" }); continue; }
      if (routes.has(t.name)) { skipped.push({ name: t.name, providerId: p.id, reason: "collision-provider" }); continue; }
      // `parameters` ist vom Form-Guard als Objekt (kein Array) geprüft; das Wire-Format will einen Record.
      defs.push({ name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> });
      routes.set(t.name, p.id);
      if (t.writes) writes.add(t.name);
    }
  }
  return { defs, routes, writes, skipped };
}

/** Tool-Ergebnis des Agent-Loops: Text fürs Modell oder ein Fehlertext. */
export type ProviderOutcome = { ok: true; content: string } | { ok: false; error: string };

/** Anbieter-Ergebnis → Tool-Ergebnis des Loops. Bei `not-indexed` darf der Wirt einen Satz VOR die
 *  message setzen (er kennt die Notiz, der Anbieter soll sie für eine Fehlermeldung nicht lesen
 *  müssen); ersetzt wird nie. Defensiv gegen eine Antwort, die den Vertrag verfehlt: lieber ein
 *  generischer Satz als eine Ausnahme mitten in der Runde. */
export function outcomeFromProvider(
  r: ProviderResult,
  opts: { notIndexedPrefix?: (path: string) => string } = {},
): ProviderOutcome {
  if (!isRecord(r)) return { ok: false, error: "Anbieter-Werkzeug lieferte keine Antwort" };
  if (r.ok === true) return { ok: true, content: typeof r.content === "string" ? r.content : "" };
  const reason = typeof r.reason === "string" ? r.reason : "unbekannt";
  const message = typeof r.message === "string" && r.message !== "" ? r.message : `Anbieter-Werkzeug fehlgeschlagen (${reason})`;
  if (r.reason === "not-indexed" && opts.notIndexedPrefix && typeof r.path === "string") {
    return { ok: false, error: `${opts.notIndexedPrefix(r.path)} ${message}` };
  }
  return { ok: false, error: message };
}

/** Ruft `executeTool` und hält den Vertrag „Fehler sind Werte“ auch gegen einen Anbieter durch, der ihn
 *  bricht: eine Ausnahme (synchron oder asynchron) wird zu `failed`, nie zu einem Absturz der Runde. */
export async function callProviderTool(
  api: ToolProviderApi,
  name: string,
  args: Record<string, unknown>,
  opts?: ProviderCallOptions,
): Promise<ProviderResult> {
  try {
    return await api.executeTool(name, args, opts);
  } catch (e) {
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}
