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
    // "Bereits verknuepft" heisst: der Plugin-Marker dav_source (profile.sourceField) ist gesetzt —
    // NICHT irgendein Wert in uidField. Handgemachte Notizen (z. B. Pallas-Kontakte) tragen oft
    // schon ein legacy uidField (Hash statt Server-UID), das die Adoption erst noch ueberschreiben
    // soll; solche Notizen bleiben Kandidat, solange sourceField fehlt.
    const sourceVal = n.frontmatter[profile.sourceField];
    if (sourceVal !== undefined && sourceVal !== null && sourceVal !== "") return false;
    if (requiredType !== undefined && n.frontmatter["type"] !== requiredType) return false;
    return true;
  });
}

/** Zaehlt Notizen, die `candidateNotes` NUR wegen eines abweichenden `type` ausschliesst
 *  (im Profil-Ordner, ohne `sourceField`, `onCreate.type` gesetzt, Notiz-Typ weicht ab).
 *  Das Adoptions-Modal zeigt diese Zahl an, damit sie nicht stillschweigend uebergangen
 *  werden (Controller-Entscheidung: sichtbar machen statt automatisch pruefen). */
export function countTypeExcluded(notes: CandidateNote[], profile: MappingProfile): number {
  const prefix = profile.folder.length > 0 ? `${profile.folder}/` : "";
  const onCreateType = profile.onCreate["type"];
  const requiredType = typeof onCreateType === "string" && onCreateType.length > 0 ? onCreateType : undefined;
  if (requiredType === undefined) return 0;
  return notes.filter((n) => {
    if (prefix.length > 0 && !n.path.startsWith(prefix)) return false;
    const sourceVal = n.frontmatter[profile.sourceField];
    if (sourceVal !== undefined && sourceVal !== null && sourceVal !== "") return false;
    return n.frontmatter["type"] !== requiredType;
  }).length;
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

/** Ein Name WIDERSPRICHT dem Server-Namen nur, wenn er weder aehnlich (>= 0.7) noch ein Teilname ist: „Florian“
 *  gegen „Dr. Florian Brandes“ ist unvollstaendig, „Unknown“ gegen „Johannes Kaindl“ ein Widerspruch. */
const NAME_CONSISTENT_MIN = 0.7;

function nameIsSubset(a: string, b: string): boolean {
  const ta = withoutHonorifics(nameTokens(normalizeName(a)));
  const tb = withoutHonorifics(nameTokens(normalizeName(b)));
  if (ta.length === 0 || tb.length === 0) return false;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const bigSet = new Set(big);
  return small.every((t) => bigSet.has(t));
}

function nameCandidates(note: CandidateNote, aliasesKey: string): string[] {
  const out: string[] = [note.basename];
  const title = note.frontmatter["title"];
  if (typeof title === "string") out.push(title);
  collectStrings(note.frontmatter[aliasesKey], out);
  return out;
}

function nameConsistent(name: string, note: CandidateNote, aliasesKey: string, sim: number): boolean {
  return sim >= NAME_CONSISTENT_MIN || nameCandidates(note, aliasesKey).some((c) => nameIsSubset(name, c));
}

// Termin-Notizen sind haeufig datumsgepraegt benannt ("2026-09-01 Zahnärztin.md" bzw. mit Uhrzeit
// "2026-09-01T09-00 Zahnärztin.md") — das Datum/die Uhrzeit gehoert nicht zum Titel und wuerde den
// Namensvergleich sonst unnoetig verwaessern.
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}[:-]\d{2})?[ _-]*/;

function stripDatePrefix(s: string): string {
  return s.replace(DATE_PREFIX_RE, "");
}

function bestTitleSim(title: string, note: CandidateNote): number {
  const stripped = stripDatePrefix(note.basename);
  const candidates: string[] = [note.basename];
  if (stripped !== note.basename && stripped.length > 0) candidates.push(stripped);
  for (const key of ["title", "titel"]) {
    const t = note.frontmatter[key];
    if (typeof t === "string") candidates.push(t);
  }
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

interface ContactSignals {
  /** Gemeinsame Merkmale in Praezedenz E-Mail vor Telefon, mit Praefix als Zaehlschluessel. */
  hits: { reason: "email" | "phone"; value: string }[];
  nameSim: number;
  nameConsistent: boolean;
}

function contactSignals(item: ServerItem, note: CandidateNote, ctx: MatchCtx): ContactSignals | null {
  const c = item.data as ContactData;
  const hits: ContactSignals["hits"] = [];
  const nEmails = noteEmails(note, ctx.profile);
  for (const e of c.emails.map((x) => x.value.toLowerCase()).filter((v) => v.length > 0)) {
    if (nEmails.includes(e)) hits.push({ reason: "email", value: e });
  }
  const nTels = noteTels(note, ctx.profile);
  for (const t of c.tels.map((x) => normalizePhone(x.value)).filter((v): v is string => v !== null)) {
    if (nTels.includes(t)) hits.push({ reason: "phone", value: t });
  }
  const nameSim = bestNameSim(c.fn, note, ctx.aliasesKey);
  if (hits.length === 0 && nameSim < 0.7) return null;
  return { hits, nameSim, nameConsistent: nameConsistent(c.fn, note, ctx.aliasesKey, nameSim) };
}

interface EventMatch {
  reason: MatchReason;
  confidence: MatchConfidence;
  detail: string;
  score: number;
}

function computeEventMatch(item: ServerItem, note: CandidateNote, ctx: MatchCtx): EventMatch | null {
  const e = item.data as EventData;
  const noteMoment = noteEventMoment(note, ctx.profile);
  const serverMoment = parseEventMoment(e.start);
  if (!noteMoment || !serverMoment || noteMoment.date !== serverMoment.date) return null;
  if (e.allDay) {
    const titleSim = bestTitleSim(e.summary, note);
    if (titleSim >= 0.6) return { reason: "start+title", confidence: "likely", detail: titleSim.toFixed(2), score: titleSim };
    return { reason: "start+title", confidence: "weak", detail: titleSim.toFixed(2), score: titleSim };
  }
  if (noteMoment.minutes === null || serverMoment.minutes === null) return null;
  const diff = Math.abs(noteMoment.minutes - serverMoment.minutes);
  if (diff === 0) {
    const titleSim = bestTitleSim(e.summary, note);
    if (titleSim >= 0.6) return { reason: "start+title", confidence: "likely", detail: titleSim.toFixed(2), score: titleSim };
    return { reason: "start+title", confidence: "weak", detail: titleSim.toFixed(2), score: titleSim };
  }
  if (diff <= START_TOLERANCE_MINUTES) return { reason: "start+title", confidence: "weak", detail: `Δ${diff}min`, score: 0 };
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
  /** Namensaehnlichkeit (Kontakte) bzw. Titelaehnlichkeit (Termine): Tie-Break innerhalb einer Konfidenzstufe. */
  score: number;
}

/** Zaehlt je Merkmalswert, wie viele verschiedene Server-Eintraege und Notizen ihn tragen. Ein Merkmal, das
 *  mehr als einer Seite gehoert (Sammel-Mailbox, gemeinsames Festnetz), identifiziert niemanden. */
function holderCounts(signals: { item: ServerItem; note: CandidateNote; sig: ContactSignals }[]): Map<string, { items: Set<ServerItem>; notes: Set<CandidateNote> }> {
  const out = new Map<string, { items: Set<ServerItem>; notes: Set<CandidateNote> }>();
  for (const { item, note, sig } of signals) {
    for (const h of sig.hits) {
      const key = `${h.reason}:${h.value}`;
      const e = out.get(key) ?? { items: new Set(), notes: new Set() };
      e.items.add(item);
      e.notes.add(note);
      out.set(key, e);
    }
  }
  return out;
}

const NAME_SURE = 0.95;

function contactConfidences(
  all: { item: ServerItem; itemIdx: number; note: CandidateNote; noteIdx: number; sig: ContactSignals }[],
  nameThreshold: number,
): Pair[] {
  const holders = holderCounts(all);
  // Mehrdeutiger Name: derselbe Name steht bei mehreren Eintraegen bzw. Notizen (Dubletten).
  const sureNameItemsPerNote = new Map<CandidateNote, number>();
  const sureNameNotesPerItem = new Map<ServerItem, number>();
  for (const { item, note, sig } of all) {
    if (sig.nameSim < NAME_SURE) continue;
    sureNameItemsPerNote.set(note, (sureNameItemsPerNote.get(note) ?? 0) + 1);
    sureNameNotesPerItem.set(item, (sureNameNotesPerItem.get(item) ?? 0) + 1);
  }
  const out: Pair[] = [];
  for (const { item, itemIdx, note, noteIdx, sig } of all) {
    let best: { reason: MatchReason; confidence: MatchConfidence; detail: string } | null = null;
    const consider = (c: { reason: MatchReason; confidence: MatchConfidence; detail: string }): void => {
      if (best === null || CONFIDENCE_RANK[c.confidence] > CONFIDENCE_RANK[best.confidence]) best = c;
    };
    for (const h of sig.hits) {
      const held = holders.get(`${h.reason}:${h.value}`);
      const unique = held !== undefined && held.items.size === 1 && held.notes.size === 1;
      const confidence: MatchConfidence = unique ? (sig.nameConsistent ? "sure" : "likely") : sig.nameConsistent ? "likely" : "weak";
      consider({ reason: h.reason, confidence, detail: h.value });
    }
    if (sig.nameSim >= NAME_SURE) {
      const mehrdeutig = (sureNameItemsPerNote.get(note) ?? 0) > 1 || (sureNameNotesPerItem.get(item) ?? 0) > 1;
      consider({ reason: "name", confidence: mehrdeutig ? "likely" : "sure", detail: sig.nameSim.toFixed(2) });
    } else if (sig.nameSim >= nameThreshold) consider({ reason: "name", confidence: "likely", detail: sig.nameSim.toFixed(2) });
    else if (sig.nameSim >= 0.7) consider({ reason: "name", confidence: "weak", detail: sig.nameSim.toFixed(2) });
    if (best === null) continue;
    const b: { reason: MatchReason; confidence: MatchConfidence; detail: string } = best;
    out.push({ item, itemIdx, note, noteIdx, reason: b.reason, confidence: b.confidence, detail: b.detail, score: sig.nameSim });
  }
  return out;
}

export function matchItems(
  items: ServerItem[],
  notes: CandidateNote[],
  opts: MatchOptions,
): { suggestions: AdoptionSuggestion[]; unmatchedItems: ServerItem[]; unmatchedNotes: CandidateNote[] } {
  const ctx: MatchCtx = { profile: opts.profile, nameThreshold: opts.nameThreshold ?? 0.85, aliasesKey: opts.aliasesKey ?? "aliases" };
  const pairs: Pair[] = [];
  const contactSigs: { item: ServerItem; itemIdx: number; note: CandidateNote; noteIdx: number; sig: ContactSignals }[] = [];
  items.forEach((item, itemIdx) => {
    notes.forEach((note, noteIdx) => {
      if (item.kind === "contact") {
        const sig = contactSignals(item, note, ctx);
        if (sig) contactSigs.push({ item, itemIdx, note, noteIdx, sig });
      } else {
        const m = computeEventMatch(item, note, ctx);
        if (m) pairs.push({ item, itemIdx, note, noteIdx, ...m });
      }
    });
  });
  pairs.push(...contactConfidences(contactSigs, ctx.nameThreshold));
  // Beste Konfidenz gewinnt zuerst; innerhalb einer Stufe der aehnlichere Name (so entsteht bei gemeinsamen
  // Merkmalen kein Ring: jede Notiz bekommt zuerst den Eintrag, dessen Namen sie traegt), danach die Reihenfolge.
  pairs.sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || b.score - a.score || a.itemIdx - b.itemIdx || a.noteIdx - b.noteIdx);
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
