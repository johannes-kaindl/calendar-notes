// Dünnes Alias-Ziel für vitest (PROF-OBS-08): re-exportiert den vendorten Kit-Mock.
export * from "../vendor/kit/obsidian-mock";

// Override: der vendorte Kit-Mock (Stand 0.28.0) kennt `getFrontMatterInfo` noch nicht.
// Minimale, aber zur echten Obsidian-API kompatible Nachbildung (node_modules/obsidian/
// obsidian.d.ts) — NICHT in den vendorten Mock schreiben, der wird per `tools/sync-kit.sh`
// ueberschrieben. Erkennt nur den einfachen "---\n...\n---\n"-Block am Dateianfang
// (kein YAML-Parsing noetig, nur die Offsets).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  from: number;
  to: number;
  contentStart: number;
}

export function getFrontMatterInfo(content: string): FrontMatterInfo {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
  const block = m[1] ?? "";
  return { exists: true, frontmatter: block, from: 4, to: 4 + block.length, contentStart: m[0].length };
}

/** Der vendorte Kit-Mock (Stand 0.28.0) kennt `SecretComponent` (Obsidian 1.11.1) noch nicht.
 *  Nachbildung MIT der Eigenart, an der das Plugin bis 0.1.4 gescheitert ist: die Komponente
 *  ist ein VERWEIS auf einen Schluesselbund-Eintrag, kein Passwortfeld. `setValue` nimmt die
 *  Secret-ID, und der Rueckruf liefert wieder die ID des im Dialog gewaehlten bzw. neu
 *  angelegten Eintrags — nie dessen Wert (Obsidian 1.13.7: `setValue(e){this.settingKey=e;…}`
 *  und der gemeinsame Dialog-Rueckruf `cb(currentId)` von Picker und Anlege-Dialog). Das X
 *  loest die Verknuepfung und ruft mit `null` zurueck. */
export class SecretComponent {
  /** Testhilfe: `new SecretComponent(...)` passiert tief in `renderAccountRow`, die Instanz
   *  ist von aussen sonst nicht erreichbar. */
  static instances: SecretComponent[] = [];
  settingKey = "";
  disabled = false;
  private changeCallback: ((id: string | null) => unknown) | null = null;

  constructor(
    public app: unknown,
    public containerEl: unknown,
  ) {
    SecretComponent.instances.push(this);
  }

  setValue(id: string | null): this {
    this.settingKey = id ?? "";
    return this;
  }

  onChange(cb: (id: string | null) => unknown): this {
    this.changeCallback = cb;
    return this;
  }

  setDisabled(d: boolean): this {
    this.disabled = d;
    return this;
  }

  /** Der Nutzer waehlt im Schluesselbund-Dialog einen Eintrag (oder loest per X, dann `null`). */
  choose(id: string | null): void {
    this.setValue(id);
    this.changeCallback?.(id);
  }
}
