// vendored from code-kit@0.63.0, src/ts/pure/split-list.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** The list a person types into one settings field: items separated by a comma (or another separator), spaces around them
 *  ignored, empty items dropped. `" README , {{folder_name}},, "` is `["README", "{{folder_name}}"]`; `""` and `" , "` are `[]`.
 *
 *  Origin: the same line, `raw.split(",").map((s) => s.trim()).filter(Boolean)`, stood in at least eight plugins when
 *  epub-exporter needed it for its list of intro page names (measured 2026-10-28: 3d-codeblocks, calendar-notes,
 *  finance-ledger, image-to-markdown, kuro-gamification, llm-lab, local-image-generator). Each copy decides the same three
 *  things (trim, drop empties, keep order); none dedupes, and neither does this.
 *
 *  Nothing is unescaped or quoted: a separator inside an item cannot be written. A caller that needs that has a real CSV
 *  problem and not a settings field. Pure, no I/O, linear in the length of `raw`. */
export function splitList(raw: string, separator = ","): string[] {
  if (separator === "") return raw.trim() === "" ? [] : [raw.trim()];
  const items: string[] = [];
  for (const part of raw.split(separator)) {
    const item = part.trim();
    if (item !== "") items.push(item);
  }
  return items;
}
