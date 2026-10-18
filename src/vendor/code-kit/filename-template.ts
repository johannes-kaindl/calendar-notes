// vendored from code-kit@0.31.0, src/ts/pure/filename-template.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Konfigurierbares Dateinamen-Schema: `{platzhalter}` auflösen, das Ergebnis auf
 *  dateisystem- und Obsidian-sichere Zeichen bringen, und über eine Fallback-Kette
 *  absichern, dass kein leerer Dateiname entsteht. Obsidian-frei (PROF-OBS-03/04) und
 *  bewusst **importfrei — auch ohne jeden Intra-Kit-Import**: nur so kann ein Repo genau
 *  diese eine Datei vendorieren, ohne seinen restlichen Vendor-Satz auf dieselbe
 *  Kit-Version zu heben (welches Repo auf welchem Stand steht, nennt `CONSUMERS.md`,
 *  nicht dieser Kopf; yijings AGENTS.md warnt ausdrücklich vor dem Sprung).
 *
 *  Kanonische Quelle: `yijing-oracle/src/core/filename.ts` (2026-07-12). Übernommen von
 *  `obsidian-paperize/src/core/filename.ts` (2026-07-16, Header „Adaptiert von
 *  yijing-oracle/src/core/filename.ts") und `obsidian-letterhead/src/core/filename.ts`
 *  (2026-07-20, Header „Modelled on obsidian-paperize's filename.ts"). Zusammengeführt
 *  ins Kit am 2026-08-19; alle drei Fassungen waren released (0.5.1 / 0.3.3 / 1.6.4).
 *
 *  Was aus welcher Fassung stammt:
 *  - **Zeichenklasse `INVALID`** — byte-identisch in allen drei (md5 der Deklarationszeile
 *    `ee98553ab7f2d8a6a00ec85df84f03c4`), unverändert übernommen.
 *  - **Substitution + „unbekannter Platzhalter bleibt literal stehen"** — alle drei.
 *  - **`Object.hasOwn`-Guard** — nur letterhead. Er wird hier der Kern, nicht eine Option
 *    (siehe ⚠️ unten); yijing und paperize erben damit einen Bugfix statt ihn zweimal zu
 *    schreiben.
 *  - **`(s || "")`-Nullguard in `sanitizeFilename`** — nur letterhead, übernommen.
 *  - **strip vs. replace** — yijing löscht ungültige Zeichen, paperize und letterhead
 *    ersetzen sie durch `_`. Beide Seiten sind per Test ratifiziert, das ist kein Zufall
 *    und keine Laune → Option `onInvalid` statt stiller Vereinheitlichung. Default
 *    `"replace"`, weil es den besseren Grund hat: die Wortgrenze bleibt erhalten
 *    (`Re: A/B` → `Re_ A_B` statt `Re AB`); Mehrheit 2:1 kommt nur hinzu.
 *  - **Fallback-Kette** — dreimal derselbe Mechanismus in drei Schreibweisen
 *    (yijing ``clean || `${date} ${time} ${hexpair}` ``; paperize
 *    `clean || sanitizeFilename(title) || "Dokument"`; letterhead
 *    `fill(tpl) || fill(LEGACY) || "Brief"`) → `fallbacks` (Ersatz-*Templates*, der Reihe
 *    nach) + `lastResort` (Konstante).
 *
 *  Beim Übernehmen (Vendoring) zu beachten:
 *
 *  ⚠️ **Die Zeichenklasse `INVALID` ist load-bearing.** Sie steht byte-identisch in drei
 *  veröffentlichten Plugins; ein zusätzliches oder entferntes Zeichen benennt bestehende
 *  Exporte **still** um — kein Typfehler, kein Testfehler, nur andere Dateinamen. Die
 *  engere Klasse `[\\/:*?"<>|]` der `sanitizeBase`-Familie ist deshalb **nicht** in `INVALID`
 *  hineingezogen worden: sie steht seit 0.24.0 als eigene Funktion {@link sanitizeBase} daneben
 *  (epub-exporter, health-vitals; die Zeichenklasse steht auch in apple-health und paperless-storage,
 *  `obsidian-letterhead/src/obsidian/output.ts` ersetzt sie dagegen durch `_` und bleibt dort).
 *
 *  ⚠️ **`Object.hasOwn` ist load-bearing, nicht Kosmetik.** Mit `subs[key] ?? …` liefert
 *  eine als Objekt-Literal gebaute `subs`-Map für `{toString}`, `{constructor}`,
 *  `{valueOf}`, `{hasOwnProperty}`, `{isPrototypeOf}`, `{toLocaleString}`,
 *  `{propertyIsEnumerable}`, `{__defineGetter__}` und `{__proto__}` Prototyp-Member statt
 *  `undefined` — der Literal-Fallback feuert nie und der Funktions-Quelltext landet im
 *  Dateinamen. Der Bug war 2026-08-19 in yijing-oracle und paperize live; das Template ist
 *  in allen drei Repos ein frei editierbares Textfeld im Settings-Tab, der Weg hinein führt
 *  also über Tippen, nicht über Code. Weil der Guard hier im Kit sitzt, darf der Aufrufer
 *  seine Map weiter als gewöhnliches Literal bauen — letterheads lokales
 *  `Object.create(null)` wird beim Anschluss überflüssig statt in drei Repos nachgezogen.
 *
 *  ⚠️ **`buildFilename` kann `""` liefern.** Nämlich dann, wenn weder `template` noch die
 *  `fallbacks` etwas rendern und kein `lastResort` gesetzt ist. Wer die Zusage „nie ein
 *  leerer Dateiname" braucht, **muss** `lastResort` setzen (paperize `"Dokument"`,
 *  letterhead `"Brief"`). yijing kommt bewusst ohne aus, weil sein Fallback-Template aus
 *  immer gefüllten Feldern besteht — das ist exakt sein heutiges Verhalten.
 *
 *  ⚠️ **Längen: die Gesamtgrenze ist im Kit, die Feldgrenze nicht.** Seit 0.23.0 (Welle 18,
 *  Analyse K3, n=2: letterhead 120 und calendar-notes 120) kappt `maxLength` das fertige
 *  Ergebnis, **nach** Fallback-Kette und `lastResort`. Die *Feld-Kappung* (yijings
 *  `slugQuestion` auf 48, letterheads `clip` auf 48, mailstone 60) wirkt dagegen **vor** der
 *  Substitution, beim Bau der `subs`-Map, und bleibt beim Aufrufer — der Wert ist dessen
 *  Fachentscheidung; geteilt wird nur der Schnitt als {@link clipText}.
 *  - *Nicht im Kit, absichtlich — Repo-Eigenes*: `paperize/hasVersionPlaceholder`, `letterhead/isoDate`,
 *    `letterhead/migrateFilenameTemplate`, `letterhead/PLACEHOLDERS`, alle
 *    `DEFAULT_FILENAME_TEMPLATE`/`LEGACY_FILENAME_TEMPLATE` und alle
 *    `FilenameValues`-Interfaces. Geprüft: keines davon braucht Kit-Interna.
 */

/** Dateisystem-illegale plus Obsidian-bedeutungstragende Zeichen (`#` Tag, `^` Blockref,
 *  `[]` Wikilink). Byte-identisch aus allen drei Quellfassungen — siehe ⚠️ im Modulkopf. */
const INVALID = /[\\/:*?"<>|#^[\]]/g;

/** Was mit einem ungültigen Zeichen geschieht.
 *  - `"replace"` — durch `_` ersetzen (paperize, letterhead; Default)
 *  - `"strip"` — ersatzlos löschen (yijing-oracle) */
export type InvalidCharMode = "strip" | "replace";

/** Optionen für {@link buildFilename}; {@link sanitizeFilename} nutzt nur `onInvalid`. */
export interface FilenameOptions {
  /** Behandlung ungültiger Zeichen. Default: `"replace"`. */
  onInvalid?: InvalidCharMode;
  /** Ersatz-**Templates** (keine fertigen Namen): werden der Reihe nach gerendert, solange
   *  das jeweils vorige leer bleibt. Platzhalter darin werden gegen dieselbe `subs`-Map
   *  aufgelöst und das Ergebnis genauso sanitisiert wie das Haupt-Template. */
  fallbacks?: readonly string[];
  /** Letzte Rettung, wenn `template` und alle `fallbacks` leer rendern. Wird **verbatim**
   *  zurückgegeben, nicht sanitisiert: es ist eine Entwickler-Konstante, keine
   *  Nutzereingabe — und ein Sanitisieren könnte sie auf `""` reduzieren und damit genau
   *  die Zusage brechen, für die es sie gibt. Default: `""`. */
  lastResort?: string;
  /** Obergrenze für die Länge des **fertigen** Namens (UTF-16-Einheiten), nur in
   *  {@link buildFilename}. Kappt per {@link clipText} **nach** Fallback-Kette und `lastResort` —
   *  also auch eine Konstante, die länger ist. Nicht gesetzt, `0` und negative Werte: keine
   *  Kappung. Gemessen bitgleich zu den zwei Inline-Kopien (letterhead, calendar-notes). */
  maxLength?: number;
}

/** Kappt `s` auf höchstens `max` Zeichen (UTF-16-Einheiten) und trimmt den Schnitt, damit kein
 *  Leerzeichen am Ende stehen bleibt; ein Text bis `max` bleibt **unverändert** (auch mit
 *  Rand-Leerzeichen). Das ist exakt `s.length > max ? s.slice(0, max).trim() : s` — die Zeile, die
 *  calendar-notes, obsidian-letterhead und yijing-oracle je einzeln schrieben. Teilt wie `slice`
 *  ein Surrogatpaar, wenn der Schnitt darin liegt (kein stiller Verhaltenswechsel gegenüber den
 *  Kopien). Für die Feld-Kappung beim Bau der `subs`-Map; die Gesamtgrenze setzt
 *  {@link FilenameOptions.maxLength}. */
export function clipText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trim() : s;
}

/** Macht einen String als Dateinamen-Bestandteil sicher: ungültige Zeichen je `onInvalid`
 *  löschen oder durch `_` ersetzen, Whitespace-Folgen auf ein Leerzeichen kollabieren,
 *  trimmen. Kollabieren+Trimmen ist load-bearing: ein leer gebliebener Platzhalter darf
 *  keine hängende Lücke im Namen hinterlassen (`"{title} {folder}"` mit leerem `folder`).
 *
 *  Der `(s || "")`-Guard ist Absicht: getypt ist `s` ein String, aber ein JS-Aufrufer oder
 *  ein `as`-Cast an der Grenze bringt `undefined` herein, und dann soll hier `""`
 *  herauskommen statt ein Throw. Übernommen aus letterhead, wo er als einziger stand.
 *
 *  @example sanitizeFilename('Re: A/B')                      // → "Re_ A_B"
 *  @example sanitizeFilename('Re: A/B', { onInvalid: "strip" }) // → "Re AB" */
export function sanitizeFilename(
  s: string,
  opts: Pick<FilenameOptions, "onInvalid"> = {},
): string {
  return (s || "")
    .replace(INVALID, opts.onInvalid === "strip" ? "" : "_")
    .replace(/\s+/g, " ")
    .trim();
}

/** Die enge Klasse der `sanitizeBase`-Familie: nur die neun Zeichen, die ein Dateisystem verbietet. */
const INVALID_BASE = /[\\/:*?"<>|]/g;

/** Entfernt die neun dateisystem-illegalen Zeichen `\ / : * ? " < > |` aus einem Basisnamen, trimmt und liefert
 *  `fallback`, wenn nichts übrig bleibt. Die Zeile, die epub-exporter (`core/output-path.ts:7`, „Untitled") und
 *  health-vitals (`core/export-path.ts:15`, „Export") je einzeln schrieben — nur der Fallback unterscheidet sie.
 *
 *  ⚠️ **Das ist NICHT {@link sanitizeFilename} und trägt es nicht bitgleich.** Dort ist die Klasse weiter
 *  (zusätzlich `# ^ [ ]`), `onInvalid` ersetzt standardmäßig durch `_`, und Whitespace-Folgen werden zu einem
 *  Leerzeichen kollabiert. Hier wird **entfernt** (`Re: A/B` → `Re AB`), `# ^ [ ]` bleiben stehen und innere
 *  Leerzeichen bleiben, wie sie sind. Ein Umstieg zwischen den beiden benennt still bestehende Exportdateien um —
 *  jedes Repo nimmt die Funktion, deren Ergebnis seine Nutzer schon auf der Platte haben.
 *
 *  Ein dritter Verwandter, `obsidian-letterhead/src/obsidian/output.ts:25`, nutzt dieselbe Klasse, **ersetzt** aber durch
 *  `_` (Fallback „Brief") — andere Semantik, bleibt dort und wird nicht hierher gezogen.
 *
 *  Der `fallback` ist Pflicht und kommt **verbatim** zurück (wie `lastResort`): eine Entwickler-Konstante, keine
 *  Nutzereingabe. Wer einen leeren Namen will, übergibt `""` ausdrücklich.
 *
 *  Kein `(s || "")`-Guard wie in {@link sanitizeFilename}: keiner der beiden Träger hatte ihn, und ein `undefined`
 *  soll dort weiter werfen statt still `fallback` zu liefern.
 *
 *  @example sanitizeBase('Re: A/B', "Brief") // → "Re AB"
 *  @example sanitizeBase("///", "Export")    // → "Export" */
export function sanitizeBase(name: string, fallback: string): string {
  return name.replace(INVALID_BASE, "").trim() || fallback;
}

/** Löst `{platzhalter}` im Template gegen `subs` auf und sanitisiert das Ergebnis; bleibt
 *  es leer, wird die `fallbacks`-Kette und zuletzt `lastResort` probiert.
 *
 *  Vertrag:
 *  - Nur `{\w+}` ist ein Platzhalter; alles andere bleibt Literal. Die Auflösung ist
 *    **case-sensitiv** (`{Datum}` ist nicht `{datum}`).
 *  - Ein Platzhalter, den `subs` nicht als **eigene** Property kennt, bleibt **wörtlich**
 *    stehen (`"{foo}"`), damit ein Tippfehler im Schema sichtbar wird, statt still zu
 *    wirken. Das gilt ausdrücklich auch für Prototyp-Namen wie `{toString}` — siehe ⚠️ im
 *    Modulkopf.
 *  - Das Ergebnis wird nur gekürzt, wenn `maxLength` gesetzt ist (nach Fallback-Kette und
 *    `lastResort`); Feldlängen sind Sache des Aufrufers ({@link clipText}).
 *  - Rückgabe ist `""`, wenn alles leer rendert und kein `lastResort` gesetzt ist.
 *
 *  @example buildFilename("{date} {title}", { date: "2026-08-19", title: "A/B" })
 *  // → "2026-08-19 A_B"
 *  @example buildFilename("", { title: "" }, { fallbacks: ["{title}"], lastResort: "Dokument" })
 *  // → "Dokument" */
export function buildFilename(
  template: string,
  subs: Readonly<Record<string, string>>,
  opts: FilenameOptions = {},
): string {
  const fill = (tpl: string): string =>
    sanitizeFilename(
      tpl.replace(/\{(\w+)\}/g, (whole: string, key: string) => {
        // Object.hasOwn statt `subs[key] ?? whole`: sonst greift der Literal-Fallback für
        // Prototyp-Namen nie. Der typeof-Test hält zusätzlich ein explizit undefined
        // gesetztes eigenes Feld ab, das sonst als "undefined" im Namen landen würde —
        // und macht die Zeile unter noUncheckedIndexedAccess typprüfbar.
        const value = Object.hasOwn(subs, key) ? subs[key] : undefined;
        return typeof value === "string" ? value : whole;
      }),
      opts,
    );

  let out = fill(template);
  for (const fallback of opts.fallbacks ?? []) {
    if (out !== "") break;
    out = fill(fallback);
  }
  const name = out !== "" ? out : (opts.lastResort ?? "");
  const max = opts.maxLength;
  return max !== undefined && max > 0 ? clipText(name, max) : name;
}
