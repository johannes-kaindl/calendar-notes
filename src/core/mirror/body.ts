import type { ContactData } from "../vcard/contact";
import type { EventData, Attendee } from "../ical/event";
import { formatAddress } from "./fields";

export const BLOCK_BEGIN = "%% dav:begin %%";
export const BLOCK_END = "%% dav:end %%";

export function splitBody(body: string): { before: string; block: string | null; after: string } {
  const i = body.indexOf(BLOCK_BEGIN);
  if (i < 0) return { before: body, block: null, after: "" };
  const j = body.indexOf(BLOCK_END, i + BLOCK_BEGIN.length);
  if (j < 0) return { before: body, block: null, after: "" };
  const inner = body.slice(i + BLOCK_BEGIN.length, j);
  const block = inner.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return { before: body.slice(0, i), block, after: body.slice(j + BLOCK_END.length) };
}

export function userContent(body: string): string {
  const { before, after } = splitBody(body);
  return `${before}${after}`.trim();
}

export function mergeBody(existing: string, block: string, mode: "block" | "none"): string {
  if (mode === "none") return existing;
  const wrapped = `${BLOCK_BEGIN}\n${block}\n${BLOCK_END}`;
  const parts = splitBody(existing);
  if (parts.block === null) {
    if (block === "") return existing;
    const head = existing.trimEnd();
    return head.length ? `${head}\n\n${wrapped}\n` : `${wrapped}\n`;
  }
  if (block === "") {
    // Block samt genau einer umgebenden Leerzeile entfernen
    const before = parts.before.replace(/\n\n$/, "\n");
    const after = parts.after.replace(/^\n\n/, "\n");
    const joined = `${before}${after}`;
    return joined.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
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
