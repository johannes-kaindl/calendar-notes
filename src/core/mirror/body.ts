import type { ContactData } from "../vcard/contact";
import type { EventData, Attendee } from "../ical/event";
import { formatAddress } from "./fields";
import { neutralizeMarkers, splitZone, wrapZone, type ZoneMarkers, type ZoneSplit } from "../../vendor/code-kit/marker-zone";

export const BLOCK_BEGIN = "%% dav:begin %%";
export const BLOCK_END = "%% dav:end %%";
const MARKERS: ZoneMarkers = { begin: BLOCK_BEGIN, end: BLOCK_END };

/** Die Zone der Notiz ist beschaedigt (BEGIN ohne END, oder ein BEGIN vor der eigentlichen Zone): der Sync schreibt diese Notiz nicht,
 *  weil jede Reparatur raet und Nutzertext ueberschreiben koennte. `message` nennt, was zu tun ist. */
export class BrokenZoneError extends Error {
  constructor(readonly reason: "begin-without-end" | "nested-begin") {
    super(reason === "begin-without-end"
      ? `${BLOCK_BEGIN} ohne ${BLOCK_END} in der Notiz — nichts geschrieben; ${BLOCK_END} unter den Block setzen oder ${BLOCK_BEGIN} entfernen`
      : `ein zweites ${BLOCK_BEGIN} vor der Zone in der Notiz — nichts geschrieben; das zitierte ${BLOCK_BEGIN} entfernen`);
    this.name = "BrokenZoneError";
  }
}

function zoneOf(body: string): Extract<ZoneSplit, { kind: "none" | "zone" }> {
  const z = splitZone(body, MARKERS);
  if (z.kind === "broken") throw new BrokenZoneError(z.reason);
  if (z.kind === "zone" && z.nestedBegins > 0) throw new BrokenZoneError("nested-begin");
  return z;
}

export function splitBody(body: string): { before: string; block: string | null; after: string } {
  const z = zoneOf(body);
  return z.kind === "none" ? { before: z.before, block: null, after: "" } : { before: z.before, block: z.block, after: z.after };
}

/** Der Text des Nutzers ausserhalb der Zone. Bei beschaedigter Zone der ganze Text: nichts davon gilt als „Zone“, und ein leerer
 *  Rueckgabewert wuerde `planRemoval` in den Papierkorb legen lassen. */
export function userContent(body: string): string {
  try {
    const { before, after } = splitBody(body);
    return `${before}${after}`.trim();
  } catch (e) {
    if (e instanceof BrokenZoneError) return body.trim();
    throw e;
  }
}

/** Zeilenumbrueche am Ende bzw. Anfang entfernen — per Schleife statt Regex (`\n+$` ist auf langen Nicht-Treffern quadratisch). */
function stripEnd(t: string): string {
  let n = t.length;
  while (n > 0 && (t[n - 1] === "\n" || t[n - 1] === "\r")) n--;
  return t.slice(0, n);
}
function stripStart(t: string): string {
  let n = 0;
  while (n < t.length && (t[n] === "\n" || t[n] === "\r")) n++;
  return t.slice(n);
}

/** Wirft `BrokenZoneError`, wenn die Zone der Notiz beschaedigt ist (nur im Modus `block`). */
export function mergeBody(existing: string, block: string, mode: "block" | "none"): string {
  if (mode === "none") return existing;
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  // Serverinhalt kann die Marker enthalten und die Zone aufbrechen: entschaerfen, bevor er hineingeht.
  const wrapped = wrapZone(neutralizeMarkers(block, MARKERS), MARKERS, eol);
  const parts = splitBody(existing);
  if (parts.block === null) {
    if (block === "") return existing;
    const head = existing.trimEnd();
    return head.length ? `${head}${eol}${eol}${wrapped}${eol}` : `${wrapped}${eol}`;
  }
  if (block === "") {
    // Block entfernen: Newlines nur an der Nahtstelle zusammenziehen, nie ueber den ganzen
    // Nutzertext hinweg (der Nutzertext vor/nach dem Block bleibt sonst unangetastet).
    const before = stripEnd(parts.before) === parts.before ? parts.before : `${stripEnd(parts.before)}${eol}`;
    const after = stripStart(parts.after) === parts.after ? parts.after : `${eol}${stripStart(parts.after)}`;
    const joined = `${before}${after}`;
    return parts.before === "" ? stripStart(joined) : joined;
  }
  return `${parts.before}${wrapped}${parts.after}`;
}

function att(a: Attendee): string {
  const who = a.name ? `${a.name} <${a.email}>` : a.email;
  return a.partstat ? `${who} · ${a.partstat}` : who;
}

export function renderEventBlock(e: EventData): string {
  const lines: string[] = [];
  if (e.description) lines.push(e.description.trim());
  if (e.attendees.length) { lines.push("", "**Teilnehmer:innen:**", ...e.attendees.map((a) => `- ${att(a)}`)); }
  if (e.organizer) lines.push("", `**Organisator:in:** ${att({ ...e.organizer })}`);
  if (e.url) lines.push("", `**Link:** ${e.url}`);
  return lines.join("\n").replace(/^\n+/, "").trim();
}

export function renderContactBlock(c: ContactData): string {
  const lines: string[] = [];
  if (c.note) lines.push(`**Notiz:** ${c.note}`);
  const typed = (icon: string, xs: { value: string; types: string[]; pref: boolean }[]) =>
    xs.map((x) => `- ${icon} ${x.types.length ? x.types.join("/") : "—"}${x.pref ? " ★" : ""}: ${x.value}`);
  const channels = [...typed("📧", c.emails), ...typed("📞", c.tels), ...typed("🔗", c.urls)];
  if (channels.length) lines.push(...(lines.length ? [""] : []), ...channels);
  const adrs = c.adrs.map((a) => `- 📍 ${a.types.length ? a.types.join("/") : "—"}: ${formatAddress(a)}`);
  if (adrs.length) lines.push(...(lines.length ? [""] : []), ...adrs);
  if (c.photo && (c.photo.data || c.photo.uri)) lines.push(...(lines.length ? [""] : []), "📷 Foto vorhanden (auf dem Server)");
  return lines.join("\n").trim();
}
