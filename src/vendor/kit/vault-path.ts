// vendored from obsidian-kit@0.28.0, src/pure/vault-path.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Vault-relative Pfade fügen und zerlegen — obsidian-frei, in Node testbar (PROF-OBS-03/04).
 *  Genau die drei Rechnungen, die im Ausgabe-Pfad jedes Export-Plugins vorkommen: Ordner
 *  normalisieren, Ordner + Dateiname fügen, Elternordner eines fertigen Pfads bestimmen.
 *
 *  Kanonische Quelle: `obsidian-paperize/src/obsidian/output.ts` `joinPath` (2026-07-11,
 *  191a004). Beim Heben ins Kit (2026-08-19) lag derselbe Rumpf in fünf Repos:
 *    obsidian-paperize/src/obsidian/output.ts:24     (2026-07-11)  byte-identisch
 *    epub-exporter/src/core/output-path.ts:11        (2026-07-19)  byte-identisch
 *    apple-health/src/core/export-path.ts:14         (2026-07-28)  byte-identisch
 *    audio-interface/src/core/file-naming.ts:26      (2026-08-15)  `joinVaultPath`, semantisch gleich
 *    obsidian-letterhead/src/obsidian/output.ts:31   (2026-07-20)  ABWEICHEND, siehe unten
 *  Der Name `joinVaultPath` kommt von audio-interface: er sagt, in welchem Namensraum der
 *  Pfad gilt (Vault, nicht Dateisystem) — `joinPath` sagt das nicht.
 *
 *  ⚠️ Zusammengeführt wurde die Mehrheits-Semantik, NICHT letterheads Fassung — die strippt
 *  nur SCHLIESSENDE Slashes (`/\/+$/`). Das ist als übersehene ältere Linie belegt, nicht als
 *  Entscheidung: kein Test pinnt sie (letterheads einziger Slash-Test deckt den trailing-Fall
 *  ab), kein Kommentar erwähnt sie, und der anlegende Commit (6b21119, 2026-07-20) zählt seine
 *  „zwei bewussten Abweichungen von paperize" ausdrücklich auf — der Regex steht nicht dabei.
 *  Ihr Rumpf stammt aus einem Inline-Ausdruck vom 2026-07-12, der nur auf `file.parent.path`
 *  lief, wo ein führender Slash gar nicht vorkommt. Kein heutiges letterhead-Ergebnis ändert
 *  sich durch die Vereinheitlichung (`'/'` und `'Export/PDF/'` liefern beide Regexe gleich);
 *  es fällt nur die Falle weg.
 *
 *  ⚠️ Load-bearing, nicht Kosmetik: der Strip der FÜHRENDEN Slashes. paperize (main.ts:135),
 *  epub-exporter (main.ts:139), apple-health (obsidian/tabs/detail.ts:148) und audio-interface
 *  (obsidian/exporter.ts:90) reichen ein Freitext-Einstellungsfeld ROH hierher. `adapter.exists`
 *  /`mkdir`/`writeBinary` erwarten laut obsidian.d.ts einen normalisierten Pfad — `/Export/x.pdf`
 *  ist keiner. Nur letterhead hat den Schutz zusätzlich außen (`normalizePath` an seiner einen
 *  Aufrufstelle, obsidian/main.ts:463) und kam deshalb ohne durch.
 *
 *  Bewusste Erweiterung gegenüber ALLEN fünf Vorlagen: `normalizeVaultDir` wandelt zusätzlich
 *  Backslashes und kollabiert interne Mehrfach-Slashes — das tut Obsidians eigenes
 *  `normalizePath` auch. Gegen die einschlägigen Tests aller fünf Repos durchgerechnet: keiner
 *  wird davon rot. Bewusst NICHT übernommen wurden drei Teile von `normalizePath`: die
 *  NFC-Normalisierung und die NBSP-Wandlung (kein Konsument braucht sie, beide würden
 *  Dateinamen bestehender Nutzer verändern) sowie dessen Rückgabe `"/"` für die Wurzel — hier
 *  ist die Wurzel `""`, weil genau das der Wert ist, den alle fünf Aufrufstellen als „kein
 *  Ordner" behandeln.
 *
 *  Beim Übernehmen zu beachten: dieses Modul normalisiert NUR den Ordner-Anteil. Der
 *  Dateiname wird unverändert durchgereicht — er ist bereits gesäubert, wenn er hier
 *  ankommt (jedes Repo hat dafür sein eigenes `sanitizeBase`/`sanitizeFilename`, das
 *  getrennt behandelt wird). `joinVaultPath` ist deshalb KEIN Ersatz für das Säubern.
 */

/** Vault-Ordner ohne Slash-Rauschen: Backslashes werden zu `/`, Mehrfach-Slashes kollabiert,
 *  führende und schließende Slashes fallen weg. `null`/`undefined`/`""` und jede reine
 *  Slash-Folge (`"/"`, `"///"`) ergeben `""` — das ist die Vault-Wurzel, nicht ein Fehler.
 *  Der Rückgabewert ist als Präfix für `adapter.exists`/`mkdir` geeignet, sofern man den
 *  Leerstring vorher abfängt (`if (dir && !await adapter.exists(dir)) …`). */
export function normalizeVaultDir(dir: string | null | undefined): string {
  return (dir ?? "").replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
}

/** Vault-relativer Pfad aus Ordner + fertigem Dateinamen (inklusive Endung).
 *  Der Ordner läuft durch `normalizeVaultDir`; Vault-Wurzel (leer oder nur Slashes) ergibt
 *  den blanken Dateinamen ohne führenden Slash. `file` wird UNVERÄNDERT angehängt — es muss
 *  ein nicht-leerer, bereits gesäuberter Name sein (ein leeres `file` liefert einen Pfad mit
 *  Schluss-Slash, und das ist ein Aufrufer-Fehler, kein hier abzufangender Rand). */
export function joinVaultPath(dir: string | null | undefined, file: string): string {
  const d = normalizeVaultDir(dir);
  return d ? `${d}/${file}` : file;
}

/** Ordner-Anteil eines fertigen Vault-Pfads, `""` für eine Datei in der Wurzel.
 *  Erwartet einen bereits normalisierten Pfad (etwa aus `joinVaultPath` oder aus Obsidians
 *  `getAvailablePathForAttachment`) und normalisiert selbst nicht nach.
 *
 *  ⚠️ Bewusst `i < 0 ? "" : slice(0, i)` und nicht `slice(0, lastIndexOf("/"))`: bei einer
 *  Datei ohne `/` ist `lastIndexOf` gleich `-1`, und `slice(0, -1)` schneidet das letzte
 *  Zeichen des DATEINAMENS ab. Aus `Muster GmbH.pdf` wird dann der Phantom-Ordner
 *  `Muster GmbH.pd`, der neben jedem Export in der Vault-Wurzel angelegt wird — genau der
 *  Bug, den obsidian-letterhead am 2026-07-24 von einem echten Gerät zurückgemeldet bekam.
 *  Dieselbe Rechnung stand in vier Schreibweisen in vier Dateien (paperize output.ts:94,
 *  epub-exporter obsidian/output.ts:61 und main.ts:154, letterhead output.ts:122); die drei
 *  anderen trafen den Fall nur zufällig nicht. */
export function vaultDirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}
