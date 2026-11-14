// vendored from code-kit@0.68.0, src/ts/pure/text-window.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** A window of whole lines around a spot in a text, and the way back: put an edited window into the text again, byte for byte outside it.
 *
 *  Origin: json-editor `src/core/repair/window.ts` (`TextWindow`, `lineWindow`, `spliceWindow`, `eolOf`; Welle 27, part 4). There the
 *  repair of a broken JSON block sends a model only the lines around the first parser error of a big file and sets its answer back.
 *  Nothing in here knows JSON: any caller that edits a part of a text through a model (or by hand) and must leave the rest untouched can
 *  take it. The line-end rule is the one of `wrapZone` (`marker-zone.ts`): the rest of a file is rewritten with ITS line end, and a part
 *  that mixed `\n` into a CRLF file would make every write a change of the whole file.
 *
 *  **Offsets belong to the original text.** `start` and `end` of a {@link TextWindow} index the text the window was made from, CRLF
 *  included; `text` is the same lines with `\n` (the model never sees a `\r`). `spliceWindow` cuts by those offsets, never by re-joined
 *  lines, so everything outside the window is the original bytes — also in a file with mixed line ends. The window itself takes the line
 *  end CRLF as soon as the FILE holds any ({@link detectEol}, any `\r\n`; until 0.37.x the first line end that occurs): in a file that
 *  mixes both, a window may therefore change its own line ends, never those outside it. A window made from another text is refused (`RangeError`), not spliced.
 *
 *  **What counts as a line.** The text up to a `\n`, without a `\r` in front of it. A lone `\r` is no line end (old Mac files are not
 *  files this was built for). The empty rest behind a final line end is no line: `"a\nb\n"` has two lines, `""` has one (empty). */

/** Lines `from..to` (0-based, inclusive) of a text. */
export interface TextWindow {
  from: number;
  to: number;
  /** Lines of the whole text (an empty rest behind the last line end does not count). */
  total: number;
  /** Offset of the first character of line `from`. */
  start: number;
  /** Offset behind the last character of line `to`, without that line's line end. */
  end: number;
  /** Lines `from..to` joined with `\n` — never a `\r`. */
  text: string;
  /** Line of the spot (0-based, in the whole text) and column (1-based, counted from the start of that line). */
  line: number;
  col: number;
}

/** [start, end without the line end] of every line; the empty rest behind the last `\n` is no line. */
function lineSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = 0;
  while (start <= text.length) {
    const nl = text.indexOf("\n", start);
    if (nl < 0) {
      if (start < text.length || spans.length === 0) spans.push([start, text.length]);
      break;
    }
    spans.push([start, text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl]);   // (`start === nl`: the char before is a `\n`, or nothing)
    start = nl + 1;
  }
  return spans;
}

/** The line end of a text: `"\r\n"` when the text holds a `\r\n` anywhere, else `"\n"` (also for no line end at all, and for a lone `\r`).
 *  The rule of the four writers that edit a note in place (diachronic, vault-rag, 3d-codeblocks, obsidian-kit `frontmatter-patch`); since
 *  0.38.0, before that the first line end that occurs (the measurement behind the change: no note in 12 942 held a CRLF, Johannes decided
 *  2026-10-26). Reads the whole text when there is no CRLF in it. A caller that checks SEVERAL parts calls it per part: joining them first
 *  would make a false `\r\n` at the seam. A text that ends on a lone `\r` is LF here; a consumer that cuts its text at `\n` and so keeps
 *  that `\r` as a suffix handles it around this call. */
export function detectEol(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** The window with `radius` lines before and after the line in which `offset` lies (cut at the edges of the text). An offset behind
 *  the end is the last line, a negative one (or `NaN`) the first; a radius below 1 or `NaN` is 0 (the one line), a fractional one is
 *  rounded down, `Infinity` is the whole text. Linear in the text. */
export function lineWindow(text: string, offset: number, radius: number): TextWindow {
  const spans = lineSpans(text);
  const at = Number.isNaN(offset) ? 0 : offset;
  const r = radius > 0 ? Math.floor(radius) : 0;
  let line = 0;
  for (let i = 0; i < spans.length; i++) {
    if ((spans[i]?.[0] ?? 0) > at) break;
    line = i;
  }
  const from = Math.max(0, line - r);
  const to = Math.min(spans.length - 1, line + r);
  const start = spans[from]?.[0] ?? 0;
  const end = spans[to]?.[1] ?? text.length;
  const lineStart = spans[line]?.[0] ?? 0;
  let col = 1;
  // `at` lies before the next line starts, so no `\n` can stand between the start of its line and `at`
  for (let i = lineStart; i < at && i < text.length; i++) col += 1;
  return { from, to, total: spans.length, start, end, text: text.slice(start, end).replace(/\r\n/g, "\n"), line, col };
}

/** Puts `replacement` in the place of the lines of `win`. The replacement arrives with `\n` (or CRLF) and is brought to the line end
 *  of `text`; what stands before and behind the window is not touched. The line end behind the window stays where it was, so an answer
 *  without a final line end does not glue the next line on. A window that does not fit `text` (offsets outside it, not whole numbers,
 *  `start` behind `end`) throws a `RangeError`: it was made from another text, and cutting by its offsets would cut the wrong bytes. */
export function spliceWindow(text: string, win: TextWindow, replacement: string): string {
  if (!Number.isInteger(win.start) || !Number.isInteger(win.end) || win.start < 0 || win.start > win.end || win.end > text.length) {
    throw new RangeError("the window does not belong to this text");
  }
  const eol = detectEol(text);
  const body = eol === "\n" ? replacement.replace(/\r\n/g, "\n") : replacement.replace(/\r?\n/g, eol);
  return text.slice(0, win.start) + body + text.slice(win.end);
}
