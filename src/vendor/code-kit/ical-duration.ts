// vendored from code-kit@0.77.0, src/ts/pure/ical-duration.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: obsidian-plugins `calendar-notes/src/core/commands/event-commands.ts` (`DURATION` and `isAlarmTrigger`, calendar-notes@48cfd61, Welle 35:
// the check for the alarms of `event.create`), generalised: the name says what it checks, and `parseIcalDuration` returns the parts. The grammar is
// the same; the regular expression of the original became a plain walk over the string so the parts come out of it.
//
// The `dur-value` of RFC 5545 section 3.3.6, with a sign (the form a VALARM `TRIGGER` takes: `-P1D` one day before, `-PT15M` fifteen minutes
// before, a positive value triggers AFTER the start):
//
//   dur-value  = (["+"] / "-") "P" (dur-date / dur-time / dur-week)
//   dur-date   = dur-day [dur-time]        dur-time = "T" (dur-hour / dur-minute / dur-second)
//   dur-week   = 1*DIGIT "W"               dur-hour = 1*DIGIT "H" [dur-minute]
//   dur-day    = 1*DIGIT "D"               dur-minute = 1*DIGIT "M" [dur-second]       dur-second = 1*DIGIT "S"
//
// So: weeks stand ALONE (`P1W` yes, `P1W2D` no); a time part needs its `T` and at least one number after it; the units run in the fixed order
// D, H, M, S and may stop at any one of them but not skip (`PT1H30S` is no duration, `PT1H30M` is); no fraction (`PT1.5H`), no empty `P` or `PT`.
//
// Stricter than `ICAL.Duration.fromString` (ical.js), which turns `P` and `-PT` into a zero duration without a word; an alarm that never rings or
// rings at once is a silent error, so this refuses them. What it does NOT do, on purpose:
// - no trimming and no case folding: ` -P1D` and `p1d` are refused (RFC 5234 reads a quoted ABNF string as case-insensitive, but every writer of
//   iCalendar emits capitals and a lowercase trigger is far more likely a typo than a feed; the caller trims what comes from a field);
// - no sum: `PT90M` stays 90 minutes, nothing is carried over into hours; the parts are as written;
// - a number beyond `Number.MAX_SAFE_INTEGER` is refused by BOTH functions (the RFC has no bound, but no alarm is that far away, and a part that
//   cannot be held exactly would be a wrong number without a word). The two functions always agree: `isIcalDuration(s)` is `parseIcalDuration(s) !== null`.

/** The parts of a duration, each as written; `sign` is `-1` for a leading `-` (before the start) and `1` for `+` or no sign. Parts that were not
 *  written are `0`. A `P1W` has `weeks: 1` and nothing else (weeks never come together with days or a time). */
export interface IcalDuration {
  sign: 1 | -1;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** `1*DIGIT` + `unit` at the start of `s`: the number and the rest, or `null` (no digits, wrong unit, unsafe number). */
function takeNumber(s: string, unit: string): { n: number; rest: string } | null {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;
  if (i === 0 || s.charAt(i) !== unit) return null;
  const n = Number(s.slice(0, i));
  if (!Number.isSafeInteger(n)) return null;
  return { n, rest: s.slice(i + 1) };
}

/** `dur-time` after the `T`: hours, then minutes, then seconds, each optional but at least one, none skipped after a later one. */
function parseTime(s: string): { hours: number; minutes: number; seconds: number } | null {
  const h = takeNumber(s, "H");
  if (h !== null) {
    if (h.rest === "") return { hours: h.n, minutes: 0, seconds: 0 };
    const m = takeNumber(h.rest, "M");
    if (m === null) return null;
    if (m.rest === "") return { hours: h.n, minutes: m.n, seconds: 0 };
    const sec = takeNumber(m.rest, "S");
    return sec !== null && sec.rest === "" ? { hours: h.n, minutes: m.n, seconds: sec.n } : null;
  }
  const m = takeNumber(s, "M");
  if (m !== null) {
    if (m.rest === "") return { hours: 0, minutes: m.n, seconds: 0 };
    const sec = takeNumber(m.rest, "S");
    return sec !== null && sec.rest === "" ? { hours: 0, minutes: m.n, seconds: sec.n } : null;
  }
  const sec = takeNumber(s, "S");
  return sec !== null && sec.rest === "" ? { hours: 0, minutes: 0, seconds: sec.n } : null;
}

/** The parts of an RFC 5545 `dur-value` (see the header), or `null` when `s` is none. Linear in the length of `s`. */
export function parseIcalDuration(s: string): IcalDuration | null {
  let rest = s;
  let sign: 1 | -1 = 1;
  if (rest.startsWith("-")) { sign = -1; rest = rest.slice(1); } else if (rest.startsWith("+")) { rest = rest.slice(1); }
  if (!rest.startsWith("P")) return null;
  rest = rest.slice(1);
  const out: IcalDuration = { sign, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const t = rest.indexOf("T");
  const datePart = t === -1 ? rest : rest.slice(0, t);
  if (datePart !== "") {
    // `dur-week` stands alone: digits and `W`, nothing after it, no time part.
    const w = takeNumber(datePart, "W");
    if (w !== null) {
      if (w.rest !== "" || t !== -1) return null;
      out.weeks = w.n;
      return out;
    }
    const d = takeNumber(datePart, "D");
    if (d === null || d.rest !== "") return null;
    out.days = d.n;
  }
  if (t === -1) return datePart === "" ? null : out; // an empty `P` is no duration
  const time = parseTime(rest.slice(t + 1));
  if (time === null) return null; // `PT`, `P1DT` and a malformed time part end here
  out.hours = time.hours;
  out.minutes = time.minutes;
  out.seconds = time.seconds;
  return out;
}

/** Is `s` an RFC 5545 `dur-value` with an optional sign (`-P1D`, `+PT0S`, `P1W`, `PT1H30M`)? See the header for what is refused. */
export function isIcalDuration(s: string): boolean {
  return parseIcalDuration(s) !== null;
}
