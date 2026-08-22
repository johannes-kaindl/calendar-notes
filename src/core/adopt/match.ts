import type { ContactData } from "../vcard/contact";
import type { EventData } from "../ical/event";
import { fmKeyFor, type MappingProfile } from "../mirror/profile";
import { normalizePhone } from "./phone";

export interface ServerItem {
  uid: string;
  href: string;
  kind: "contact" | "event";
  data: ContactData | EventData;
  raw: string;
  etag: string;
}

export interface CandidateNote {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export type MatchReason = "email" | "phone" | "name" | "start+title";
export type MatchConfidence = "sure" | "likely" | "weak";

export interface AdoptionSuggestion {
  item: ServerItem;
  note: CandidateNote;
  reason: MatchReason;
  confidence: MatchConfidence;
  detail: string;
}

export interface MatchOptions {
  profile: MappingProfile;
  nameThreshold?: number; // default 0.85
  aliasesKey?: string; // default "aliases"
}

const NAME_STOPLIST = new Set(["dr", "prof", "herr", "frau", "mr", "mrs", "ms"]);

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(s: string): string[] {
  return s.length > 0 ? s.split(" ") : [];
}

/** Titel/Anreden ("Dr.", "Prof.") verzerren den Token-Vergleich stark ("Dr. Florian Brandes" vs.
 * "Florian Brandes" läge sonst nur bei Jaccard 2/3 ≈ 0.67). Sie fallen deshalb vor dem Vergleich raus —
 * außer sie sind (nach Filterung) alles, was übrig bleibt, dann zählen sie doch mit. */
function withoutHonorifics(tokens: string[]): string[] {
  const filtered = tokens.filter((t) => !NAME_STOPLIST.has(t));
  return filtered.length > 0 ? filtered : tokens;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : inter / union;
}

function bigrams(s: string): string[] {
  const chars = s.replace(/\s+/g, "");
  if (chars.length < 2) return chars.length > 0 ? [chars] : [];
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) out.push(chars.slice(i, i + 2));
  return out;
}

function dice(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const bag = new Map<string, number>();
  for (const x of a) bag.set(x, (bag.get(x) ?? 0) + 1);
  let common = 0;
  for (const x of b) {
    const c = bag.get(x) ?? 0;
    if (c > 0) {
      common++;
      bag.set(x, c - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

/** 0..1, case-/diakritik-insensitiv: max(Token-Jaccard, Bigramm-Dice) auf den normalisierten Namen. */
export function nameSimilarity(a: string, b: string): number {
  const ta = withoutHonorifics(nameTokens(normalizeName(a)));
  const tb = withoutHonorifics(nameTokens(normalizeName(b)));
  const j = jaccard(ta, tb);
  const d = dice(bigrams(ta.join(" ")), bigrams(tb.join(" ")));
  return Math.max(j, d);
}

export function candidateNotes(notes: CandidateNote[], profile: MappingProfile): CandidateNote[] {
  const prefix = profile.folder.length > 0 ? `${profile.folder}/` : "";
  const onCreateType = profile.onCreate["type"];
  const requiredType = typeof onCreateType === "string" && onCreateType.length > 0 ? onCreateType : undefined;
  return notes.filter((n) => {
    if (prefix.length > 0 && !n.path.startsWith(prefix)) return false;
    const uidVal = n.frontmatter[profile.uidField];
    if (uidVal !== undefined && uidVal !== null && uidVal !== "") return false;
    if (requiredType !== undefined && n.frontmatter["type"] !== requiredType) return false;
    return true;
  });
}

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === "string" && v.length > 0) out.push(v);
  else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x.length > 0) out.push(x);
}

const FALLBACK_EMAIL_KEYS = ["email", "mail"];
const FALLBACK_TEL_KEYS = ["telefon", "mobil", "phone", "tel"];

function noteEmails(note: CandidateNote, profile: MappingProfile): string[] {
  const keys = new Set<string>();
  for (const f of ["email", "email_home", "email_work"]) {
    const k = fmKeyFor(profile, f);
    if (k) keys.add(k);
  }
  for (const k of FALLBACK_EMAIL_KEYS) keys.add(k);
  const out: string[] = [];
  for (const k of keys) collectStrings(note.frontmatter[k], out);
  return out.map((s) => s.toLowerCase());
}

function noteTels(note: CandidateNote, profile: MappingProfile): string[] {
  const keys = new Set<string>();
  for (const f of ["tel_cell", "tel_home", "tel_work"]) {
    const k = fmKeyFor(profile, f);
    if (k) keys.add(k);
  }
  for (const k of FALLBACK_TEL_KEYS) keys.add(k);
  const raw: string[] = [];
  for (const k of keys) collectStrings(note.frontmatter[k], raw);
  const out: string[] = [];
  for (const r of raw) {
    const n = normalizePhone(r);
    if (n) out.push(n);
  }
  return out;
}

function bestNameSim(name: string, note: CandidateNote, aliasesKey: string): number {
  const candidates: string[] = [note.basename];
  const title = note.frontmatter["title"];
  if (typeof title === "string") candidates.push(title);
  collectStrings(note.frontmatter[aliasesKey], candidates);
  return candidates.reduce((max, c) => Math.max(max, nameSimilarity(name, c)), 0);
}

function bestTitleSim(title: string, note: CandidateNote): number {
  const candidates: string[] = [note.basename];
  const t = note.frontmatter["title"];
  if (typeof t === "string") candidates.push(t);
  return candidates.reduce((max, c) => Math.max(max, nameSimilarity(title, c)), 0);
}

/** Datum + optional Uhrzeit (Minutenauflösung) — Sekunden/Zeitzonen-Suffixe werden verworfen.
 * Kein Uhrzeit-Anteil (All-Day) → `minutes: null`. */
interface EventMoment {
  date: string;
  minutes: number | null;
}

function parseEventMoment(raw: string): EventMoment | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/.exec(raw);
  if (!m) return null;
  const [, date, hh, mm] = m;
  if (date === undefined) return null;
  const minutes = hh !== undefined && mm !== undefined ? Number(hh) * 60 + Number(mm) : null;
  return { date, minutes };
}

function noteEventMoment(note: CandidateNote, profile: MappingProfile): EventMoment | null {
  const startKey = fmKeyFor(profile, "start");
  for (const k of [startKey, "termin_start", "start"]) {
    if (!k) continue;
    const v = note.frontmatter[k];
    if (typeof v === "string" && v.length > 0) return parseEventMoment(v);
  }
  const datum = note.frontmatter["datum"];
  if (typeof datum === "string" && datum.length > 0) {
    const uhrzeit = note.frontmatter["uhrzeit"];
    const combined = typeof uhrzeit === "string" && uhrzeit.length > 0 ? `${datum}T${uhrzeit}` : datum;
    return parseEventMoment(combined);
  }
  return null;
}

/** Toleranzfenster für "vermutlich dieselbe Uhrzeit, nur mit Zeitzonen-Versatz" (z. B. Notiz in
 * Lokalzeit vs. Server-`start` in UTC): bis zu 2h Differenz am selben Tag zählt noch als `weak`. */
const START_TOLERANCE_MINUTES = 120;

interface MatchCtx {
  profile: MappingProfile;
  nameThreshold: number;
  aliasesKey: string;
}

function computeMatch(item: ServerItem, note: CandidateNote, ctx: MatchCtx): { reason: MatchReason; confidence: MatchConfidence; detail: string } | null {
  if (item.kind === "contact") {
    const c = item.data as ContactData;
    const itemEmails = c.emails.map((e) => e.value.toLowerCase()).filter((v) => v.length > 0);
    const nEmails = noteEmails(note, ctx.profile);
    for (const e of itemEmails) if (nEmails.includes(e)) return { reason: "email", confidence: "sure", detail: e };
    const itemTels = c.tels.map((t) => normalizePhone(t.value)).filter((v): v is string => v !== null);
    const nTels = noteTels(note, ctx.profile);
    for (const t of itemTels) if (nTels.includes(t)) return { reason: "phone", confidence: "sure", detail: t };
    const sim = bestNameSim(c.fn, note, ctx.aliasesKey);
    if (sim >= 0.95) return { reason: "name", confidence: "sure", detail: sim.toFixed(2) };
    if (sim >= ctx.nameThreshold) return { reason: "name", confidence: "likely", detail: sim.toFixed(2) };
    if (sim >= 0.7) return { reason: "name", confidence: "weak", detail: sim.toFixed(2) };
    return null;
  }
  const e = item.data as EventData;
  const noteMoment = noteEventMoment(note, ctx.profile);
  const serverMoment = parseEventMoment(e.start);
  if (!noteMoment || !serverMoment || noteMoment.date !== serverMoment.date) return null;
  if (e.allDay) {
    const titleSim = bestTitleSim(e.summary, note);
    if (titleSim >= 0.6) return { reason: "start+title", confidence: "likely", detail: titleSim.toFixed(2) };
    return { reason: "start+title", confidence: "weak", detail: titleSim.toFixed(2) };
  }
  if (noteMoment.minutes === null || serverMoment.minutes === null) return null;
  const diff = Math.abs(noteMoment.minutes - serverMoment.minutes);
  if (diff === 0) {
    const titleSim = bestTitleSim(e.summary, note);
    if (titleSim >= 0.6) return { reason: "start+title", confidence: "likely", detail: titleSim.toFixed(2) };
    return { reason: "start+title", confidence: "weak", detail: titleSim.toFixed(2) };
  }
  if (diff <= START_TOLERANCE_MINUTES) return { reason: "start+title", confidence: "weak", detail: `Δ${diff}min` };
  return null;
}

const CONFIDENCE_RANK: Record<MatchConfidence, number> = { sure: 3, likely: 2, weak: 1 };

interface Pair {
  item: ServerItem;
  itemIdx: number;
  note: CandidateNote;
  noteIdx: number;
  reason: MatchReason;
  confidence: MatchConfidence;
  detail: string;
}

export function matchItems(
  items: ServerItem[],
  notes: CandidateNote[],
  opts: MatchOptions,
): { suggestions: AdoptionSuggestion[]; unmatchedItems: ServerItem[]; unmatchedNotes: CandidateNote[] } {
  const ctx: MatchCtx = { profile: opts.profile, nameThreshold: opts.nameThreshold ?? 0.85, aliasesKey: opts.aliasesKey ?? "aliases" };
  const pairs: Pair[] = [];
  items.forEach((item, itemIdx) => {
    notes.forEach((note, noteIdx) => {
      const m = computeMatch(item, note, ctx);
      if (m) pairs.push({ item, itemIdx, note, noteIdx, ...m });
    });
  });
  // Beste Konfidenz gewinnt zuerst; bei gleicher Konfidenz entscheidet die Item-Reihenfolge.
  pairs.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || a.itemIdx - b.itemIdx || a.noteIdx - b.noteIdx);
  const usedItems = new Set<ServerItem>();
  const usedNotes = new Set<CandidateNote>();
  const chosen: Pair[] = [];
  for (const p of pairs) {
    if (usedItems.has(p.item) || usedNotes.has(p.note)) continue;
    usedItems.add(p.item);
    usedNotes.add(p.note);
    chosen.push(p);
  }
  chosen.sort((a, b) => a.itemIdx - b.itemIdx);
  const suggestions: AdoptionSuggestion[] = chosen.map((p) => ({ item: p.item, note: p.note, reason: p.reason, confidence: p.confidence, detail: p.detail }));
  const unmatchedItems = items.filter((i) => !usedItems.has(i));
  const unmatchedNotes = notes.filter((n) => !usedNotes.has(n));
  return { suggestions, unmatchedItems, unmatchedNotes };
}
