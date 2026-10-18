// vendored from code-kit@0.31.0, src/ts/pure/local-stamp.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Origin: the `getFullYear()`/`getMonth() + 1`/`padStart` block that plugin repos wrote by hand. Measured 2026-10-14
// over `obsidian-plugins/*/src` without tests and vendor trees: 19 lines in 10 repos (22 in 11 with the two gui-smoke
// drivers). Of those, 16 lines in 10 repos format a stamp and are covered here: local-image-generator
// (`core/filename.ts:4,48`), settings-assistant (`core/profile-note.ts:52`), lingotuner (`core/logbook.ts:13,20`,
// `main.ts:33`), yijing-oracle (`obsidian/clock.ts:6`), mailstone (`core/render/frontmatter.ts:18-29`),
// obsidian-letterhead (`core/filename.ts:55`, `obsidian/main.ts:114`), obsidian-paperize (`obsidian/main.ts:40`),
// vault-crews (`core/orchestrator.ts:643`, `core/paths.ts:59`), kuro-gamification (`utils/dateUtils.ts:11,18`),
// finance-ledger (`core/config/context.ts:48`). Not covered: mailstone's RFC 2822 `Date:` header
// (`core/mime/build.ts:15`, English day and month names, a wire format) and kuro-gamification's `StreakEngine.ts:63,65`
// (day arithmetic, not formatting). Welle 22, 2026-10-14.
//
// **Why one place.** Every copy reads the *local* clock on purpose: a note is named for the day its user lives in. The
// tempting short form, `new Date().toISOString().slice(0, 10)`, is UTC — right except between midnight and the UTC
// offset, when it names yesterday or tomorrow. It is in the code anyway (health-vitals `core/rollup.ts:13`, llm-lab
// `main.ts:41`, image-to-markdown `main.ts:304`, audio-interface `main.ts:512`, neurovim-obsidian
// `MissionSession.ts:158`); `localDate` is the short form that is right.
//
// **The clock is a parameter.** Nothing here calls `Date.now()`: pass `new Date()` at the edge, a fixed `Date` in a test.
//
// **Formats that differ, and why they stay different** — each one is *persisted* in user vaults, so the module offers
// them as options instead of picking one:
// - `localFileStamp` default `YYYY-MM-DD HH-mm` — two repos agree (settings-assistant, lingotuner); "colons do not go
//   into file names" (lingotuner), hence the hyphen between hour and minute.
// - `compact` (`YYYYMMDD-HHmm[ss]`) — local-image-generator names images `lig-20260714-153012-s<seed>.png`; seconds
//   because generations can follow each other within a minute. Existing files carry this shape.
// - `seconds` off in `localIso` — yijing-oracle's `YYYY-MM-DDTHH:mm`. No reason is stated in the code; it stays an
//   option because the stamp is already written into readings.
// - `offset` — mailstone's `localIso` appends `+02:00`, because mail crosses time zones; local-image-generator's
//   `created` is deliberately without one ("documents when *Jay* made the picture").
// Not offered, because no source needs it: a different separator between date and time in the stamp (vault-crews'
// `YYYY-MM-DD-HHmm` run id is `${localDate(d)}-${hour}${minute}` from {@link localParts}; paperize's `HHmm` likewise).
//
// **koda-agent keeps its own `renderLocalDate(ms, timeZone?)`** (`core/prompt/now.ts`): it takes an IANA zone as a
// parameter so that tests say the same on every machine — a boundary, not drift. `local-stamp` reads the runtime's
// own zone (the `Date` getters), like every other copy; Phase B does not switch koda-agent.
//
// **An invalid `Date` throws** (`RangeError`). Every copy printed `NaN-NaN-NaN` into the name; letterhead's `isoDate`
// guards with `isNaN(d.getTime())` and returns `''`, and keeps doing so at the call site.

/** The wall-clock parts of a `Date` in the runtime's own time zone, each as a string padded to the width it prints at. */
export interface LocalParts {
  /** At least four digits: `"2026"`, `"0987"`. */
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** The local year/month/day/hour/minute/second of `d`, zero-padded. The building block for a shape this module does not
 *  offer. @throws RangeError for an invalid Date. */
export function localParts(d: Date): LocalParts {
  if (Number.isNaN(d.getTime())) throw new RangeError("localParts: invalid Date");
  return {
    year: pad(d.getFullYear(), 4),
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
    hour: pad(d.getHours()),
    minute: pad(d.getMinutes()),
    second: pad(d.getSeconds()),
  };
}

/** `YYYY-MM-DD` of the local day. @example localDate(new Date(2026, 7, 23)) // → "2026-08-23" */
export function localDate(d: Date): string {
  const p = localParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYY-MM` of the local month (lingotuner's monthly logbook). */
export function localYearMonth(d: Date): string {
  const p = localParts(d);
  return `${p.year}-${p.month}`;
}

/** `HH:mm` of the local time, `HH:mm:ss` with `seconds: true`. Contains colons — not for file names ({@link localFileStamp}). */
export function localTime(d: Date, opts: { seconds?: boolean } = {}): string {
  const p = localParts(d);
  return opts.seconds === true ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}

/** Options for {@link localIso}. */
export interface LocalIsoOptions {
  /** Include `:ss`. Default `true`. */
  seconds?: boolean;
  /** Append the local UTC offset, `+02:00`. Default `false` (Obsidian's own `created` has none). */
  offset?: boolean;
}

/** ISO-8601 shape of the *local* time: `2026-08-23T15:00:09`; with `offset: true` `2026-08-23T15:00:09+02:00`.
 *  The offset is the one in force at `d` (summer and winter differ), with half and quarter hours kept (`+05:30`). */
export function localIso(d: Date, opts: LocalIsoOptions = {}): string {
  const p = localParts(d);
  let out = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  if (opts.seconds !== false) out += `:${p.second}`;
  if (opts.offset === true) {
    const east = -d.getTimezoneOffset();
    const abs = Math.abs(east);
    out += `${east >= 0 ? "+" : "-"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }
  return out;
}

/** Options for {@link localFileStamp}. */
export interface LocalFileStampOptions {
  /** Include the seconds. Default `false`. */
  seconds?: boolean;
  /** `YYYYMMDD-HHmm[ss]` instead of `YYYY-MM-DD HH-mm[-ss]`. Default `false`. */
  compact?: boolean;
}

/** A local date-and-time stamp that is safe in a file name (no colon) and sorts lexically in time order.
 *  Default `2026-07-14 15-30`; `{ seconds: true }` → `2026-07-14 15-30-12`; `{ compact: true, seconds: true }` →
 *  `20260714-153012`. */
export function localFileStamp(d: Date, opts: LocalFileStampOptions = {}): string {
  const p = localParts(d);
  const seconds = opts.seconds === true;
  if (opts.compact === true) return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${seconds ? p.second : ""}`;
  return `${p.year}-${p.month}-${p.day} ${p.hour}-${p.minute}${seconds ? `-${p.second}` : ""}`;
}
