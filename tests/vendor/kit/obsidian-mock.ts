// vendored from obsidian-kit@0.57.0, src/testing/obsidian-mock.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// Self-contained Obsidian test double for obsidian-kit.
// - Zero external imports (NOT from "obsidian", NOT from "vitest").
// - Consumed via vitest `resolve.alias` as a drop-in for `import ... from "obsidian"`,
//   so every stub is a named top-level export.
// - Also exposes `createObsidianMock(overrides?)` which returns the full superset
//   ({ ...defaults, ...overrides }) for programmatic use.
// Superset-Merge der 5 Plugin-Mocks (img-to-md, vault-rag, json_viewer, kuro, presentation).
// Mock-Code ist bewusst lose typisiert; src/testing/** ist in eslint von no-unsafe-*/any ausgenommen.

// ---------------------------------------------------------------------------
// Internal spy helper (replaces vitest's `vi.fn` so this file stays dep-free).
// ---------------------------------------------------------------------------
export interface MockFn {
  (...args: any[]): any;
  mock: { calls: any[][]; results: any[] };
  mockImplementation(impl: (...args: any[]) => any): MockFn;
  mockReturnValue(value: any): MockFn;
  mockResolvedValue(value: any): MockFn;
  mockRejectedValue(value: any): MockFn;
  mockClear(): MockFn;
}

function fn(impl?: (...args: any[]) => any): MockFn {
  let implementation = impl;
  const spy = ((...args: any[]) => {
    spy.mock.calls.push(args);
    const result = implementation ? implementation(...args) : undefined;
    spy.mock.results.push(result);
    return result;
  }) as MockFn;
  spy.mock = { calls: [], results: [] };
  spy.mockImplementation = (i) => { implementation = i; return spy; };
  spy.mockReturnValue = (v) => { implementation = () => v; return spy; };
  spy.mockResolvedValue = (v) => { implementation = () => Promise.resolve(v); return spy; };
  spy.mockRejectedValue = (v) => { implementation = () => Promise.reject(v); return spy; };
  spy.mockClear = () => { spy.mock.calls = []; spy.mock.results = []; return spy; };
  return spy;
}

// ---------------------------------------------------------------------------
// Fake DOM element. Superset of the helpers used across the five plugins.
// className-string model (image-to-markdown / vault-rag) + additive
// classList/classes/firstChild affordances (kuro-gamification).
// ---------------------------------------------------------------------------
/** Minimaler Selektor-Abgleich für `querySelectorAll` unten: Tag-Name (`input`) oder
 *  einfache Klasse (`.foo`). Bewusst KEIN CSS-Parser — nur so viel, wie die Kit-Module
 *  brauchen (die Endpunkt-Liste sperrt ihre Zeilen über `"input, button, select"`). */
function matchesSimpleSelector(node: any, selector: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  if (s.startsWith(".")) return node?.hasClass?.(s.slice(1)) === true;
  return String(node?.tagName ?? "").toLowerCase() === s.toLowerCase();
}

/** `tagName` ist ein Parameter, weil die Komponenten-Konstruktoren unten echte Tags brauchen:
 *  `Setting.addText` liefert im echten Obsidian ein `<input>`, `addDropdown` ein `<select>`,
 *  `addButton` ein `<button>`. Ein pauschales `DIV` machte jedes
 *  `querySelectorAll("input, button, select")` blind — die Endpunkt-Liste sperrt ihre Zeilen
 *  genau so. */
export function makeFakeEl(tagName = "DIV"): any {
  const children: any[] = [];
  const attrs: Record<string, string> = {};
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  let ownText = "";
  let parent: any = null;

  const style: Record<string, any> = {
    setProperty(prop: string, value: string) { style[prop] = value; },
    removeProperty(prop: string) { delete style[prop]; },
  };

  const makeChild = (tag: string, o?: any): any => {
    const c = makeFakeEl();
    c.tagName = tag.toUpperCase();
    if (o?.cls) c.className = Array.isArray(o.cls) ? o.cls.join(" ") : String(o.cls);
    if (o?.text != null) c.textContent = String(o.text);
    if (o?.attr) for (const k of Object.keys(o.attr)) c.setAttribute(k, String(o.attr[k]));
    c.parentElement = el;
    children.push(c);
    return c;
  };

  const el: any = {
    children,
    style,
    dataset: {} as Record<string, string>,
    className: "",
    tagName: String(tagName ?? "DIV").toUpperCase(),
    _listeners: listeners,

    empty() { children.length = 0; ownText = ""; },
    detach() {},
    /** Hängt sich beim Elternknoten aus, wie im echten DOM. Nötig für Kit-Module, die
     *  Zusatz-DOM in-place wieder wegnehmen (Drittanbieter-Icon der Endpunkt-Liste). */
    remove() { parent?.removeChild?.(el); },
    focus() {},
    blur() {},

    createEl: (tag: string, o?: any) => makeChild(tag, o),
    createDiv: (o?: any) => makeChild("div", o),
    createSpan: (o?: any) => makeChild("span", o),
    /** ANHÄNGEN, nicht verschieben: anders als im echten DOM bleibt ein bereits woanders
     *  hängender Knoten zusätzlich bei seinem alten Elternknoten stehen. Bewusst nicht
     *  repariert — Kit-Module hängen nur frische Knoten an. Folge für Tests: eine Aussage
     *  über die Reihenfolge der Kinder ist nur dort belastbar, wo kein Knoten umgehängt
     *  wurde (der Modell-Picker hängt seine Komponenten aus `controlEl` in den Slot um). */
    appendChild: (c: any) => { if (c && typeof c === "object") c.parentElement = el; children.push(c); return c; },
    /** `ref === null` haengt ans Ende an, wie im echten DOM. Fehlt `ref` im eigenen
     *  Kinder-Array, wird ebenfalls ans Ende angehaengt statt zu werfen (Fake-Element
     *  ist tolerant, kein Spezifikations-Double). */
    insertBefore: (c: any, ref: any) => {
      if (c && typeof c === "object") c.parentElement = el;
      const i = ref === null || ref === undefined ? -1 : children.indexOf(ref);
      if (i < 0) children.push(c); else children.splice(i, 0, c);
      return c;
    },
    removeChild: (c: any) => {
      const i = children.indexOf(c);
      if (i >= 0) children.splice(i, 1);
      if (c && typeof c === "object" && c.parentElement === el) c.parentElement = null;
      return c;
    },
    replaceChildren: (...nodes: any[]) => { children.length = 0; children.push(...nodes); },

    setText: (t: string) => { ownText = String(t ?? ""); },
    appendText: (t: string) => { ownText += String(t ?? ""); },

    addClass: (...cls: string[]) => {
      const s = el.className.split(" ").filter(Boolean);
      for (const c of cls) if (!s.includes(c)) s.push(c);
      el.className = s.join(" ");
    },
    removeClass: (...cls: string[]) => {
      el.className = el.className.split(" ").filter((x: string) => x && !cls.includes(x)).join(" ");
    },
    /** Wie Obsidians `removeClasses(string[])`: eine LISTE, keine Einzelargumente (slide-deck, Welle 19). */
    removeClasses: (cls: string[]) => el.removeClass(...cls),
    toggleClass: (cls: string, on?: boolean) => {
      const parts = el.className.split(" ").filter(Boolean).filter((p: string) => p !== cls);
      const shouldAdd = on === undefined ? !el.className.split(" ").includes(cls) : on;
      if (shouldAdd) parts.push(cls);
      el.className = parts.join(" ");
    },
    hasClass: (c: string) => el.className.split(" ").includes(c),

    setAttribute: (k: string, v: string) => { attrs[k] = String(v); },
    setAttr: (k: string, v: string) => { attrs[k] = String(v); },
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k: string) => { delete attrs[k]; },
    setCssStyles: (s: Record<string, any>) => { Object.assign(style, s); },
    setCssProps: (s: Record<string, any>) => { Object.assign(style, s); },

    /** Rekursive Nachfahren-Suche über kommagetrennte Tag-/Klassen-Selektoren.
     *  Gibt ein Array zurück (nicht NodeList) — es trägt `forEach`, mehr braucht der
     *  Aufrufer nicht. */
    querySelectorAll: (selector: string) => {
      const parts = String(selector ?? "").split(",").map((p) => p.trim()).filter(Boolean);
      const out: any[] = [];
      const walk = (node: any): void => {
        for (const c of node?.children ?? []) {
          if (parts.some((p) => matchesSimpleSelector(c, p))) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },

    /** Erster Treffer von `querySelectorAll` in Dokumentreihenfolge, sonst `null` (health-vitals, Welle 19). */
    querySelector: (selector: string) => el.querySelectorAll(selector)[0] ?? null,

    addEventListener: (event: string, cb: (...a: any[]) => void) => { (listeners[event] ??= []).push(cb); },
    removeEventListener: (event: string, cb: (...a: any[]) => void) => {
      const arr = listeners[event];
      if (arr) { const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); }
    },
    dispatchEvent: (evt: any) => { (listeners[evt?.type] ?? []).forEach((cb) => cb(evt)); return true; },
    click: () => { (listeners["click"] ?? []).forEach((cb) => cb()); },

    // Permissive guard stub (markdown-presentation): refine per test if needed.
    instanceOf: (_type: any) => true,
  };

  Object.defineProperty(el, "classList", {
    value: {
      add: (...c: string[]) => el.addClass(...c),
      remove: (...c: string[]) => el.removeClass(...c),
      toggle: (c: string, force?: boolean) => el.toggleClass(c, force),
      contains: (c: string) => el.hasClass(c),
    },
    enumerable: false,
  });
  // Nicht enumerierbar: ein Elternzeiger als normale Eigenschaft machte jeden Fake-Knoten
  // zyklisch und damit in `toEqual`-Vergleichen unlesbar.
  Object.defineProperty(el, "parentElement", {
    get: () => parent,
    set: (p: any) => { parent = p ?? null; },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(el, "parentNode", { get: () => parent, enumerable: false, configurable: true });
  Object.defineProperty(el, "classes", {
    get: () => new Set(el.className.split(" ").filter(Boolean)),
    enumerable: false,
  });
  // textContent aggregates own text + children, like the real DOM.
  Object.defineProperty(el, "textContent", {
    get: () => ownText + children.map((c: any) => c.textContent ?? "").join(""),
    set: (v: string) => { ownText = String(v ?? ""); },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(el, "innerText", {
    get: () => el.textContent,
    set: (v: string) => { ownText = String(v ?? ""); },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(el, "firstChild", { get: () => children[0] ?? null, enumerable: false });
  Object.defineProperty(el, "firstElementChild", { get: () => children[0] ?? null, enumerable: false });
  Object.defineProperty(el, "lastChild", { get: () => children[children.length - 1] ?? null, enumerable: false });

  return el;
}

// ---------------------------------------------------------------------------
// Chainable Setting components (node-safe; no real DOM).
// ---------------------------------------------------------------------------
export class TextComponent {
  inputEl: any = makeFakeEl("INPUT");
  protected _value = "";
  onChangeCB: ((v: string) => any) | null = null;
  placeholder = "";
  disabled = false;
  constructor() {
    this.inputEl.__component = this;
  }
  getValue(): string { return this._value; }
  setValue(v: string): this { this._value = String(v ?? ""); return this; }
  setPlaceholder(p: string): this { this.placeholder = String(p ?? ""); return this; }
  setDisabled(d: boolean): this { this.disabled = Boolean(d); return this; }
  onChange(cb: (v: string) => any): this { this.onChangeCB = cb; return this; }
}
export class TextAreaComponent extends TextComponent {
  constructor() { super(); this.inputEl.tagName = "TEXTAREA"; }
}
export class SearchComponent extends TextComponent {
  clearButtonEl: any = makeFakeEl();   // im echten Obsidian ein div.search-input-clear-button
}
export class ToggleComponent {
  toggleEl: any = makeFakeEl();        // im echten Obsidian ein div.checkbox-container
  protected _value = false;
  onChangeCB: ((v: boolean) => any) | null = null;
  constructor() {
    this.toggleEl.__component = this;
  }
  getValue(): boolean { return this._value; }
  setValue(v: boolean): this { this._value = Boolean(v); return this; }
  setDisabled(_d: boolean): this { return this; }
  setTooltip(_t: string): this { return this; }
  onChange(cb: (v: boolean) => any): this { this.onChangeCB = cb; return this; }
}
export class DropdownComponent {
  selectEl: any = makeFakeEl("SELECT");
  options: Record<string, string> = {};
  protected _value = "";
  onChangeCB: ((v: string) => any) | null = null;
  constructor(containerEl?: any) {
    this.selectEl.__component = this;
    if (containerEl?.appendChild) containerEl.appendChild(this.selectEl);
  }
  addOption(value: string, display: string): this { this.options[value] = display; return this; }
  addOptions(options: Record<string, string>): this { Object.assign(this.options, options); return this; }
  getValue(): string { return this._value; }
  setValue(v: string): this { this._value = String(v ?? ""); return this; }
  setDisabled(_d: boolean): this { return this; }
  onChange(cb: (v: string) => any): this { this.onChangeCB = cb; return this; }
}
export class SliderComponent {
  sliderEl: any = makeFakeEl("INPUT");   // im echten Obsidian ein input[type=range]
  protected _value = 0;
  limits: [number, number, number] = [0, 100, 1];
  onChangeCB: ((v: number) => any) | null = null;
  constructor() {
    this.sliderEl.__component = this;
  }
  setLimits(min: number, max: number, step: number): this { this.limits = [min, max, step]; return this; }
  getValue(): number { return this._value; }
  setValue(v: number): this { this._value = Number(v); return this; }
  setDynamicTooltip(): this { return this; }
  setDisabled(_d: boolean): this { return this; }
  onChange(cb: (v: number) => any): this { this.onChangeCB = cb; return this; }
}
export class ButtonComponent {
  buttonEl: any = makeFakeEl("BUTTON");
  clickCB: (() => any) | null = null;
  textValue = "";
  /** Zuletzt gesetzter Tooltip-Text — aufgezeichnet statt verworfen, damit Konsumenten
   *  belegen können, WAS an einem Knopf hängt (der echte Obsidian schreibt ihn ins DOM). */
  tooltip = "";
  ctaSet = false;
  warningSet = false;
  destructiveSet = false;
  constructor(containerEl?: any) {
    if (containerEl?.appendChild) containerEl.appendChild(this.buttonEl);
    this.buttonEl.__component = this;
  }
  setButtonText(t: string): this { this.textValue = String(t ?? ""); return this; }
  setIcon(_i: string): this { return this; }
  setClass(_c: string): this { return this; }
  setCta(): this { this.ctaSet = true; return this; }
  /** @deprecated ab Obsidian 1.13 — Pendant zur echten API, damit Konsumenten den Feature-Check testen können. */
  setWarning(): this { this.warningSet = true; return this; }
  /** Erst ab Obsidian 1.13 vorhanden. Tests des <1.13-Fallbacks löschen die Methode am
   *  Prototyp (`delete ButtonComponent.prototype.setDestructive`) — s. tests/confirm.test.ts. */
  setDestructive(): this { this.destructiveSet = true; return this; }
  setTooltip(t: string): this { this.tooltip = String(t ?? ""); return this; }
  setDisabled(_d: boolean): this { return this; }
  onClick(cb: () => any): this { this.clickCB = cb; return this; }
}
export class ExtraButtonComponent {
  extraSettingsEl: any = makeFakeEl();   // im echten Obsidian ein div.clickable-icon (kennt kein `disabled`)
  clickCB: (() => any) | null = null;
  /** Icon- und Tooltip-Wert werden aufgezeichnet, nicht verworfen: an einem Icon-Knopf ist
   *  der Tooltip der EINZIGE Text, und Kit-Module setzen dort Zusammensetzungen
   *  („<Hinweis> · <Knopf>", s. renderModelPicker). Ohne Aufzeichnung ist das ungetestet. */
  iconName = "";
  tooltip = "";
  setIcon(i: string): this { this.iconName = String(i ?? ""); return this; }
  setTooltip(t: string): this { this.tooltip = String(t ?? ""); return this; }
  setDisabled(_d: boolean): this { return this; }
  onClick(cb: () => any): this { this.clickCB = cb; return this; }
}

// ---------------------------------------------------------------------------
// File-system stubs.
// ---------------------------------------------------------------------------
export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number } = { ctime: 0, mtime: 0, size: 0 };
  vault: any = null;
  parent: any = null;
  constructor(path = "", extension?: string) {
    this.path = path;
    const base = path.split("/").pop() ?? path;
    this.name = base;
    const dot = base.lastIndexOf(".");
    this.basename = dot > 0 ? base.slice(0, dot) : base;
    this.extension = extension ?? (dot > 0 ? base.slice(dot + 1) : "md");
  }
}
export class TFolder {
  path: string;
  name: string;
  children: any[] = [];
  parent: any = null;
  vault: any = null;
  constructor(path = "") { this.path = path; this.name = path.split("/").pop() ?? path; }
  isRoot(): boolean { return this.path === "" || this.path === "/"; }
}
export class TAbstractFile {
  path = "";
  name = "";
  vault: any = null;
  parent: any = null;
}

// ---------------------------------------------------------------------------
// Keymap scope (json_viewer).
// ---------------------------------------------------------------------------
export class Scope {
  keys: Array<{ modifiers: string[] | null; key: string | null; handler: any }> = [];
  constructor(public parent?: Scope) {}
  register(modifiers: string[] | null, key: string | null, handler: any): any {
    this.keys.push({ modifiers, key, handler });
    return handler;
  }
  unregister(_handler: any): void {}
}

// ---------------------------------------------------------------------------
// Notice (json_viewer's instrumented superset).
// ---------------------------------------------------------------------------
export class Notice {
  static instances: Notice[] = [];
  noticeEl: any = makeFakeEl();
  constructor(public message: any = "", public timeout?: number) { Notice.instances.push(this); }
  setMessage(message: any): this { this.message = message; return this; }
  hide(): void {}
}

// ---------------------------------------------------------------------------
// Plugin (5/5 superset).
// ---------------------------------------------------------------------------
export class Plugin {
  app: any;
  manifest: any;
  views: Record<string, any> = {};
  commands: any[] = [];
  settingTabs: any[] = [];
  postprocessors: Record<string, any> = {};
  private storedData: any = null;
  constructor(app?: any, manifest?: any) {
    this.app = app ?? {};
    this.manifest = manifest ?? { id: "mock-plugin", name: "Mock Plugin", version: "1.0.0" };
  }
  onload(): void {}
  onunload(): void {}
  async loadData(): Promise<any> { return this.storedData; }
  async saveData(data: any): Promise<void> { this.storedData = data; }
  addCommand(cmd: any): any { this.commands.push(cmd); return cmd; }
  addRibbonIcon(_icon: string, _title: string, _cb: any): any { return makeFakeEl(); }
  addStatusBarItem(): any { return makeFakeEl(); }
  addSettingTab(tab: any): void { this.settingTabs.push(tab); }
  registerView(type: string, factory: any): void { this.views[type] = factory; }
  registerExtensions(_ext: string[], _viewType: string): void {}
  registerMarkdownCodeBlockProcessor(lang: string, handler: any): any { this.postprocessors[lang] = handler; return handler; }
  registerMarkdownPostProcessor(handler: any): any { return handler; }
  registerEvent(_evt: any): void {}
  registerDomEvent(..._args: any[]): void {}
  registerInterval(id: number): number { return id; }
  __protocolHandlers: Record<string, (params: Record<string, string>) => void> = {};
  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => any): void {
    this.__protocolHandlers[action] = handler;
  }
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any = makeFakeEl();
  constructor(app?: any, plugin?: any) { this.app = app; this.plugin = plugin; }
  display(): void {}
  hide(): void {}
}

// ---------------------------------------------------------------------------
// Setting: chainable; every add* INVOKES its callback with a chainable
// component (powerful superset over kuro/markdown which skipped the call).
// ---------------------------------------------------------------------------
export class Setting {
  static __last: Setting | null = null;
  settingEl: any;
  /** Der Control-Teilbaum der Zeile (im echten Obsidian `.setting-item-control`).
   *  Kit-Module zeichnen dort Zusatz-DOM neben die `add*`-Komponenten — die Endpunkt-Liste
   *  etwa Status-Icon, Rollenzeile, Warn-/Drittanbieter-Icon und den Modell-Slot. */
  controlEl: any;
  components: any[] = [];
  nameValue = "";
  descValue = "";
  constructor(public containerEl: any) {
    this.settingEl = containerEl?.createDiv ? containerEl.createDiv({ cls: "setting-item" }) : makeFakeEl();
    this.settingEl.__setting = this;
    // Fallback für minimale Container-Doubles in Bestandstests (`{ createDiv: () => ({}) }`):
    // deren settingEl kann selbst kein createDiv — controlEl bleibt dann losgelöst, statt zu werfen.
    this.controlEl = this.settingEl?.createDiv
      ? this.settingEl.createDiv({ cls: "setting-item-control" })
      : makeFakeEl();
    Setting.__last = this;
  }
  /** Wie im echten Obsidian landen die `add*`-Elemente in controlEl, nicht direkt in
   *  settingEl — sonst stünde das Zusatz-DOM (controlEl) neben statt zwischen ihnen. */
  private attach(el: any): void {
    if (el?.appendChild && this.controlEl?.appendChild) this.controlEl.appendChild(el);
  }
  setName(name: any): this { this.nameValue = String(name ?? ""); return this; }
  setDesc(desc: any): this { this.descValue = String(desc ?? ""); return this; }
  setHeading(): this { return this; }
  setClass(_c: string): this { return this; }
  setTooltip(_t: string): this { return this; }
  setDisabled(_d: boolean): this { return this; }
  addText(cb: (c: TextComponent) => any): this { const c = new TextComponent(); this.components.push(c); this.attach(c.inputEl); cb(c); return this; }
  addTextArea(cb: (c: TextAreaComponent) => any): this { const c = new TextAreaComponent(); this.components.push(c); this.attach(c.inputEl); cb(c); return this; }
  addSearch(cb: (c: SearchComponent) => any): this { const c = new SearchComponent(); this.components.push(c); this.attach(c.inputEl); cb(c); return this; }
  addToggle(cb: (c: ToggleComponent) => any): this { const c = new ToggleComponent(); this.components.push(c); this.attach(c.toggleEl); cb(c); return this; }
  addDropdown(cb: (c: DropdownComponent) => any): this { const c = new DropdownComponent(); this.components.push(c); this.attach(c.selectEl); cb(c); return this; }
  addSlider(cb: (c: SliderComponent) => any): this { const c = new SliderComponent(); this.components.push(c); this.attach(c.sliderEl); cb(c); return this; }
  addButton(cb: (c: ButtonComponent) => any): this { const c = new ButtonComponent(); this.components.push(c); this.attach(c.buttonEl); cb(c); return this; }
  addExtraButton(cb: (c: ExtraButtonComponent) => any): this { const c = new ExtraButtonComponent(); this.components.push(c); this.attach(c.extraSettingsEl); cb(c); return this; }
  addMomentFormat(cb: (c: TextComponent) => any): this { const c = new TextComponent(); this.components.push(c); this.attach(c.inputEl); cb(c); return this; }
}

// ---------------------------------------------------------------------------
// Editor double.
// ---------------------------------------------------------------------------
/** Ein kleiner, ehrlicher Editor auf echtem Text: Zeilen, Cursor und Auswahl sind
 *  ausgerechnet, keine Konstanten. Adapter, die `lineCount()`/`getLine()`/`getSelection()`
 *  lesen, messen damit ihre eigene Rechnung statt der des Doubles.
 *
 *  Cursor-Vokabel wie in Obsidian: gespeichert sind `anchor` (wo die Auswahl begann) und
 *  `head` (wo sie endet); `from`/`to` sind daraus sortiert, `getCursor()` ohne Argument
 *  liefert den Kopf. */
export function makeFakeEditor(initial = ""): any {
  let value = initial;
  let anchor = { line: 0, ch: 0 };
  let head = { line: 0, ch: 0 };
  const lines = () => value.split("\n");
  const posToOffset = (pos: any) => {
    const ls = lines();
    const line = Math.max(0, Math.min(pos?.line ?? 0, ls.length - 1));
    let off = 0;
    for (let i = 0; i < line; i++) off += (ls[i] ?? "").length + 1;
    return off + Math.max(0, Math.min(pos?.ch ?? 0, (ls[line] ?? "").length));
  };
  const offsetToPos = (offset: number) => {
    const ls = lines();
    let rest = Math.max(0, Math.min(offset, value.length));
    for (let i = 0; i < ls.length; i++) {
      const len = (ls[i] ?? "").length;
      if (rest <= len) return { line: i, ch: rest };
      rest -= len + 1;
    }
    return { line: ls.length - 1, ch: (ls[ls.length - 1] ?? "").length };
  };
  const sortiert = () => (posToOffset(anchor) <= posToOffset(head) ? [anchor, head] : [head, anchor]);
  return {
    getValue: () => value,
    setValue: (v: string) => { value = v; anchor = { line: 0, ch: 0 }; head = { line: 0, ch: 0 }; },
    lineCount: () => lines().length,
    lastLine: () => lines().length - 1,
    getLine: (n: number) => lines()[n] ?? "",
    getCursor: (which?: string) => {
      const [von, bis] = sortiert();
      if (which === "anchor") return { ...anchor };
      if (which === "from") return { ...(von as any) };
      if (which === "to") return { ...(bis as any) };
      return { ...head };
    },
    setCursor: (pos: any, ch?: number) => {
      const p = typeof pos === "number" ? { line: pos, ch: ch ?? 0 } : { ...pos };
      anchor = p; head = { ...p };
    },
    setSelection: (von: any, bis?: any) => { anchor = { ...von }; head = { ...(bis ?? von) }; },
    somethingSelected: () => posToOffset(anchor) !== posToOffset(head),
    getSelection: () => {
      const [von, bis] = sortiert();
      return value.slice(posToOffset(von), posToOffset(bis));
    },
    getRange: (von: any, bis: any) => value.slice(posToOffset(von), posToOffset(bis)),
    replaceSelection: (text: string) => {
      const [von, bis] = sortiert();
      const a = posToOffset(von);
      value = value.slice(0, a) + text + value.slice(posToOffset(bis));
      const ende = offsetToPos(a + text.length);
      anchor = { ...ende }; head = { ...ende };
    },
    replaceRange: (text: string, von: any, bis?: any) => {
      const a = posToOffset(von);
      const b = bis === undefined ? a : posToOffset(bis);
      value = value.slice(0, Math.min(a, b)) + text + value.slice(Math.max(a, b));
    },
    posToOffset,
    offsetToPos,
    focus: () => {},
    refresh: () => {},
  };
}

// ---------------------------------------------------------------------------
// Views & modals.
// ---------------------------------------------------------------------------
export class ItemView {
  app: any;
  leaf: any;
  contentEl: any = makeFakeEl();
  containerEl: any = makeFakeEl();
  constructor(leaf?: any) { this.leaf = leaf; this.app = leaf?.app ?? {}; }
  getViewType(): string { return "mock-view"; }
  getDisplayText(): string { return ""; }
  getIcon(): string { return "document"; }
  onOpen(): Promise<void> { return Promise.resolve(); }
  onClose(): Promise<void> { return Promise.resolve(); }
  registerEvent(_evt: any): void {}
  addAction(_icon: string, _title: string, _cb: any): any { return makeFakeEl(); }
}

/** Ansicht MIT Datei. In Obsidian die Basis jeder Notiz-Ansicht; Adapter, die Tabs
 *  einsammeln, pruefen genau darauf (`view instanceof FileView && view.file !== null`),
 *  weil eine Ansicht ohne Datei keine Notiz ist. */
export class FileView extends ItemView {
  file: any = null;
  allowNoFile = false;
  getViewType(): string { return "file-view"; }
  async onLoadFile(_file: any): Promise<void> {}
  async onUnloadFile(_file: any): Promise<void> {}
}

// DOKUMENTIERTE ABWEICHUNG von der echten Hierarchie: dort ist
// `MarkdownView extends TextFileView`. Hier haengen beide direkt unter FileView, weil
// TextFileViews `addAction`-Override eine Mock-Erweiterung fuer Kopfzeilen-Tests ist und
// kein Obsidian-Verhalten — sie unter MarkdownView zu ziehen, aenderte stillschweigend
// das Verhalten in jedem Consumer, der MarkdownView.addAction() misst. Der Vertrag, auf
// den Adapter pruefen (`instanceof FileView`, `.file`), stimmt in beiden Formen.
export class MarkdownView extends FileView {
  editor: any = makeFakeEditor();
  getMode(): string { return "source"; }
  getViewType(): string { return "markdown"; }
}

export class TextFileView extends FileView {
  data = "";
  actionsEl: any = makeFakeEl();
  saveCount = 0;
  addAction(icon: string, title: string, cb: (e?: any) => void): any {
    const btn = makeFakeEl();
    btn.setAttribute("aria-label", title);
    btn.dataset.icon = icon;
    btn.addEventListener("click", (e: any) => cb(e));
    this.actionsEl.appendChild(btn);
    return btn;
  }
  getViewData(): string { return this.data; }
  setViewData(data: string, _clear: boolean): void { this.data = data; }
  clear(): void { this.data = ""; }
  requestSave(): void { this.saveCount += 1; }
}

export class Modal {
  static __last: Modal | null = null;
  app: any;
  contentEl: any = makeFakeEl();
  titleEl: any = makeFakeEl();
  modalEl: any = makeFakeEl();
  scope: any = new Scope();
  constructor(app?: any) { this.app = app; Modal.__last = this; }
  open(): void { this.onOpen(); }
  close(): void { this.onClose(); }
  onOpen(): void {}
  onClose(): void {}
  setTitle(_t: string): this { return this; }
  setContent(_c: any): this { return this; }
}

export class WorkspaceLeaf {
  view: any = null;
  app: any = {};
  /** Der Knoten, unter dem dieses Leaf haengt — vom Test gesetzt (z.B. auf
   *  `app.workspace.leftSplit`). Ohne parent wurzelt ein Leaf in sich selbst. */
  parent: any = null;
  /** Der zuletzt gesetzte View-State. Hier steht bei restaurierten, noch nicht besuchten
   *  Tabs der Dateipfad (`state.file`) — sie sind DeferredViews ohne `view.file`. */
  __state: any = {};
  async setViewState(state: any): Promise<void> {
    if (state?.type) this.view = { ...(this.view ?? {}), type: state.type };
    this.__state = { ...(state ?? {}) };
  }
  getViewState(): any { return { ...this.__state }; }
  /** Wurzel der parent-Kette. Adapter unterscheiden damit Tabs (wurzeln im `rootSplit`)
   *  von Seitenleisten-Ansichten (wurzeln im `leftSplit`/`rightSplit`). */
  getRoot(): any {
    let node: any = this.parent;
    if (!node) return this;
    while (node.parent) node = node.parent;
    return node;
  }
  async openFile(_file: any): Promise<void> {}
  setEphemeralState(_state: any): void {}
  getDisplayText(): string { return ""; }
  detach(): void {}
}

// ---------------------------------------------------------------------------
// vault-rag extensions.
// ---------------------------------------------------------------------------
export abstract class AbstractInputSuggest<T> {
  constructor(protected app: any, protected inputEl: any) {
    if (this.inputEl) this.inputEl.__folderSuggestAttached = true;
  }
  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: any): void;
  selectSuggestion(_value: T, _evt?: any): void { this.close(); }
  setValue(v: string): void { if (this.inputEl) this.inputEl.value = v; }
  getValue(): string { return this.inputEl?.value ?? ""; }
  onSelect(_cb: (value: T, evt?: any) => any): this { return this; }
  open(): void {}
  close(): void {}
}

export class FuzzySuggestModal<T> {
  app: any;
  inputEl: { value: string } = { value: "" };
  // Test affordance: last constructed instance, so a test can drive choose/close.
  static __instance: any = null;
  constructor(app?: any) {
    this.app = app;
    (this.constructor as any).__instance = this;
    FuzzySuggestModal.__instance = this;
  }
  setPlaceholder(_s: string): this { return this; }
  setInstructions(_i: any): this { return this; }
  getItems(): T[] { return []; }
  getItemText(item: T): string { return String(item); }
  onChooseItem(_item: T, _evt?: any): void {}
  renderSuggestion(_item: any, _el: any): void {}
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
  // Test affordances (not in real Obsidian): simulate choose / dismiss.
  __choose(item: T): void { this.onChooseItem(item); }
  __close(): void { this.onClose(); }
}

/** `SuggestModal<T>` (slide-deck, Welle 19): im echten Obsidian ein Modal mit Eingabefeld und Vorschlagsliste. Ohne die Klasse
 *  bricht ein Import, der von ihr erbt, mit „Class extends value undefined“. Anders als `FuzzySuggestModal` (hier ohne Modal-Basis)
 *  erbt sie von `Modal`; `open()`/`close()` tun nichts, wie in der Hand-Kopie, aus der sie stammt. */
export class SuggestModal<T> extends Modal {
  inputEl: { value: string } = { value: "" };
  /** Letzte gebaute Instanz, damit ein Test sie erreicht, wenn das Plugin sie selbst baut. */
  static __instance: any = null;
  constructor(app?: any) {
    super(app);
    (this.constructor as any).__instance = this;
    SuggestModal.__instance = this;
  }
  setPlaceholder(_s: string): this { return this; }
  getSuggestions(_query: string): T[] | Promise<T[]> { return []; }
  renderSuggestion(_value: T, _el: any): void {}
  onChooseSuggestion(_value: T, _evt?: any): void {}
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

// ---------------------------------------------------------------------------
// Menus (json_viewer).
// ---------------------------------------------------------------------------
export class MenuItem {
  titleText = "";
  iconName = "";
  disabled = false;
  warning = false;
  checked = false;
  section = "";
  clickHandler: (() => void) | null = null;
  submenu: Menu | null = null;
  setTitle(t: string): this { this.titleText = String(t); return this; }
  setIcon(i: string): this { this.iconName = i; return this; }
  setDisabled(d: boolean): this { this.disabled = d; return this; }
  setWarning(w: boolean): this { this.warning = w; return this; }
  setChecked(c: boolean): this { this.checked = c; return this; }
  setSection(s: string): this { this.section = s; return this; }
  onClick(cb: () => void): this { this.clickHandler = cb; return this; }
  setSubmenu(): Menu { this.submenu = new Menu(); return this.submenu; }
}
export class Menu {
  static instances: Menu[] = [];
  items: MenuItem[] = [];
  separatorCount = 0;
  shown = false;
  constructor() { Menu.instances.push(this); }
  addItem(cb: (item: MenuItem) => void): this { const item = new MenuItem(); cb(item); this.items.push(item); return this; }
  addSeparator(): this { this.separatorCount += 1; return this; }
  showAtMouseEvent(_e: any): this { this.shown = true; return this; }
  showAtPosition(_p: any): this { this.shown = true; return this; }
  hide(): this { this.shown = false; return this; }
  onHide(_cb: () => void): this { return this; }
}

// ---------------------------------------------------------------------------
// Free functions & consts.
// ---------------------------------------------------------------------------
export function setIcon(el: any, iconId: string): void {
  if (!el) return;
  if (el.dataset) el.dataset.icon = iconId;
  el.setAttribute?.("data-icon", iconId);
}
export function setTooltip(el: any, tooltip: string): void {
  el.setAttribute?.("data-tooltip", tooltip);
}
export function getLanguage(): string { return "en"; }

// ---------------------------------------------------------------------------
// Welle 19: Zusätze aus den Hand-Kopien (calendar-notes, health-vitals/vault-rag).
// ---------------------------------------------------------------------------
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/** `getFrontMatterInfo(content)` (calendar-notes, Welle 19): Nachbildung nach `obsidian.d.ts`. Erkennt nur den einfachen
 *  `---\n…\n---`-Block am Dateianfang, ohne YAML zu lesen — gebraucht werden die Offsets (`contentStart` = Beginn des Rumpfes).
 *  Grenzen: ein leerer Block (`---\n---\n`) gilt als „kein Block“, und `frontmatter` ist der Text ohne die Begrenzer.
 *  `from`/`to` zählen die Zeichen des Blocktextes im Original, auch bei CRLF (die Hand-Kopie rechnete `from` mit 4 fest). */
export function getFrontMatterInfo(content: string): { exists: boolean; frontmatter: string; from: number; to: number; contentStart: number } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
  const block = m[1] ?? "";
  const from = content.indexOf("\n") + 1;
  return { exists: true, frontmatter: block, from, to: from + block.length, contentStart: m[0].length };
}

/** `SecretComponent` (Obsidian 1.11.1; calendar-notes, Welle 19): ein VERWEIS auf einen Schlüsselbund-Eintrag, kein Passwortfeld.
 *  `setValue` nimmt die Secret-ID, der Rückruf liefert wieder die ID des im Dialog gewählten Eintrags, nie dessen Wert; das X löst
 *  die Verknüpfung und ruft mit `null` zurück. `choose(id)` ist die Testhilfe für die Wahl im Dialog, `instances` sammelt jede Instanz,
 *  weil `new SecretComponent(...)` tief im Rendern passiert und von außen sonst nicht erreichbar ist. */
export class SecretComponent {
  static instances: SecretComponent[] = [];
  settingKey = "";
  disabled = false;
  private changeCallback: ((id: string | null) => unknown) | null = null;
  constructor(public app: unknown, public containerEl: unknown) { SecretComponent.instances.push(this); }
  setValue(id: string | null): this { this.settingKey = id ?? ""; return this; }
  onChange(cb: (id: string | null) => unknown): this { this.changeCallback = cb; return this; }
  setDisabled(d: boolean): this { this.disabled = d; return this; }
  /** Testhilfe (nicht in Obsidian): der Nutzer wählt im Schlüsselbund-Dialog einen Eintrag, oder löst per X (`null`). */
  choose(id: string | null): void { this.setValue(id); this.changeCallback?.(id); }
}

/** Desktop-Adapter des Vaults (health-vitals, vault-rag, Welle 19): Plugins prüfen `adapter instanceof FileSystemAdapter`, bevor sie
 *  `getBasePath()` lesen. `makeFakeApp().vault.adapter` ist KEINE Instanz davon (bestehende Tests hängen daran); wer den Desktop-Pfad
 *  testet, setzt `app.vault.adapter = new FileSystemAdapter("/vault")`. */
export class FileSystemAdapter {
  constructor(private basePath = "/fake") {}
  getBasePath(): string { return this.basePath; }
}
export function normalizePath(path: string): string {
  const out = String(path)
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "")
    .trim();
  return out === "" ? "/" : out;
}
export function setCssStyles(el: any, styles: Record<string, any>): void {
  if (el?.style) Object.assign(el.style, styles);
}
export function debounce<T extends (...args: any[]) => any>(fnToDebounce: T, _timeout?: number, _resetTimer?: boolean): T {
  return fnToDebounce;
}

export const Platform = {
  isMobile: false,
  isPhone: false,
  isTablet: false,
  isDesktop: true,
  isDesktopApp: true,
  isMobileApp: false,
  isMacOS: true,
  isWin: false,
  isLinux: false,
  isIosApp: false,
  isAndroidApp: false,
};

export const requestUrl: MockFn = fn((..._args: any[]) => Promise.resolve({
  status: 200,
  headers: {},
  text: "",
  json: {} as any,
  arrayBuffer: new ArrayBuffer(0),
}));

// ---------------------------------------------------------------------------
// Fake App (image-to-markdown / vault-rag superset; spies via internal `fn`).
// ---------------------------------------------------------------------------
/** `CSSStyleSheet` gibt es in der Node-Umgebung nicht — der Stub hält den zuletzt gesetzten Text (vault-crews, Welle 19). */
export class MockSheet {
  css = "";
  replaceSync(css: string): void { this.css = css; }
}

export function makeFakeApp(): any {
  // Der Workspace haelt eine Selbstreferenz, damit `iterateAllLeaves` ueber die vom Test
  // registrierten Leaves laufen kann (`workspace.__leaves`).
  const workspace: any = {};
  return {
    // Schlüsselbund-Double (Obsidian ≥ 1.11.4): Map statt Keychain. Die ID-Regel der echten
    // API („lowercase alphanumeric with optional dashes", setSecret wirft sonst) wird
    // nachgebildet, damit ein Test einen falschen Präfix findet, bevor es der Nutzer tut.
    secretStorage: (() => {
      const secrets = new Map<string, string>();
      return {
        __secrets: secrets,
        getSecret: (id: string): string | null => secrets.get(id) ?? null,
        setSecret: (id: string, value: string): void => {
          if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`invalid secret id: ${id}`);
          secrets.set(id, value);
        },
      };
    })(),
    vault: {
      adapter: {
        read: fn().mockResolvedValue(""),
        readBinary: fn().mockResolvedValue(new ArrayBuffer(0)),
        write: fn().mockResolvedValue(undefined),
        writeBinary: fn().mockResolvedValue(undefined),
        mkdir: fn().mockResolvedValue(undefined),
        exists: fn().mockResolvedValue(true),
        stat: fn().mockResolvedValue({ mtime: 0 }),
      },
      getName: fn().mockReturnValue("mock-vault"),
      getAbstractFileByPath: fn().mockReturnValue(null),
      getFiles: fn().mockReturnValue([]),
      getMarkdownFiles: fn().mockReturnValue([]),
      getAllFolders: fn().mockReturnValue([]),
      read: fn().mockResolvedValue(""),
      cachedRead: fn().mockResolvedValue(""),
      create: fn().mockResolvedValue(new TFile()),
      modify: fn().mockResolvedValue(undefined),
      on: fn().mockReturnValue({ id: "mock-event" }),
    },
    workspace: Object.assign(workspace, {
      getActiveFile: fn().mockReturnValue(null),
      getActiveViewOfType: fn().mockReturnValue(null),
      getLeavesOfType: fn().mockReturnValue([]),
      getRightLeaf: fn().mockReturnValue({ setViewState: fn() }),
      getLeftLeaf: fn().mockReturnValue({ setViewState: fn() }),
      getLeaf: fn().mockReturnValue(new WorkspaceLeaf()),
      // Die drei Wurzeln, an denen `WorkspaceLeaf.getRoot()` endet. Eigene Marker-Objekte,
      // damit ein Test sie unterscheiden kann — im Mock haengt kein Baum daran.
      // `doc`: das Dokument des Hauptfensters, wie `installFolderHide` es liest (`adoptedStyleSheets`, `defaultView.CSSStyleSheet`).
      // Je App neu gebaut, damit kein Test das Array des nächsten sieht.
      rootSplit: { __split: "root", doc: { adoptedStyleSheets: [] as any[], defaultView: { CSSStyleSheet: MockSheet } } },
      leftSplit: { __split: "left" },
      rightSplit: { __split: "right" },
      /** Vom Test registrierte Leaves; Grundlage von `iterateAllLeaves`. */
      __leaves: [] as any[],
      iterateAllLeaves: fn((cb: any) => { for (const leaf of workspace.__leaves) cb(leaf); }),
      // Bewusst leer per Default: "zuletzt benutzt" ist eine Nutzungshistorie, die das
      // Double nicht hat. Der Test setzt den aktiven Leaf selbst (`mockReturnValue`),
      // statt dass der Mock eine Reihenfolge erfindet.
      getMostRecentLeaf: fn().mockReturnValue(null),
      on: fn(),
      off: fn(),
      revealLeaf: fn(),
      onLayoutReady: fn((cb: any) => { if (typeof cb === "function") cb(); }),
    }),
    metadataCache: {
      getFileCache: fn().mockReturnValue(null),
      getFirstLinkpathDest: fn().mockReturnValue(null),
      on: fn(),
    },
    fileManager: {
      processFrontMatter: fn().mockResolvedValue(undefined),
      generateMarkdownLink: fn().mockReturnValue(""),
    },
    keymap: {},
  };
}

/** Konstruierbares App-Double (`new App()`), z.B. fuer Consumer-Tests, die eine
 *  echte App-Instanz statt eines rohen `makeFakeApp()`-Objekts erwarten (etwa
 *  Signaturen, die `App` als Klassentyp durchreichen). Traegt dieselbe Form
 *  wie `makeFakeApp()` -- keine zweite Wahrheit, nur eine konstruierbare Huelle. */
export class App {
  vault: any;
  workspace: any;
  metadataCache: any;
  fileManager: any;
  keymap: any;
  constructor() {
    Object.assign(this, makeFakeApp());
  }
}

// ---------------------------------------------------------------------------
// Type-only exports (no runtime stub; not part of MockStubs).
// ---------------------------------------------------------------------------
/** Lebensdauer-Anker für `MarkdownRenderer.render`; im Mock ohne Wirkung. */
export class Component {
  load(): void {}
  unload(): void {}
}

/** `render` schreibt den Markdown als Text ins Element (kein Parser im Mock); Tests ersetzen `render`. */
export const MarkdownRenderer = {
  render: ((_app: unknown, markdown: string, el: any, _sourcePath: string, _component: unknown): Promise<void> => {
    el.textContent = markdown;
    return Promise.resolve();
  }) as (app: unknown, markdown: string, el: any, sourcePath: string, component: unknown) => Promise<void>,
};

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion?: string;
  author?: string;
  description?: string;
}
export interface MarkdownPostProcessorContext {
  docId?: string;
  sourcePath: string;
  getSectionInfo(el: any): { lineStart: number; lineEnd: number; text: string } | null;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Factory: the full superset as defaults, with shallow override merge.
// `defaultStubs` is assembled from the top-level definitions above, so the
// named exports and the factory defaults can never drift apart.
// ---------------------------------------------------------------------------
export const defaultStubs = {
  // base (>=4/5)
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  setIcon,
  setTooltip,
  App,
  // common (3/5)
  ItemView,
  Modal,
  WorkspaceLeaf,
  normalizePath,
  makeFakeEl,
  makeFakeApp,
  // 2/5
  TFolder,
  Platform,
  requestUrl,
  // plugin-specific extensions
  TAbstractFile,
  FileView,
  MarkdownView,
  TextFileView,
  makeFakeEditor,
  Scope,
  AbstractInputSuggest,
  FuzzySuggestModal,
  SuggestModal,
  SecretComponent,
  FileSystemAdapter,
  getFrontMatterInfo,
  Menu,
  MenuItem,
  TextComponent,
  TextAreaComponent,
  SearchComponent,
  ToggleComponent,
  DropdownComponent,
  SliderComponent,
  ButtonComponent,
  ExtraButtonComponent,
  getLanguage,
  setCssStyles,
  debounce,
};

export type MockStubs = typeof defaultStubs;

export function createObsidianMock(overrides: Partial<MockStubs> = {}): MockStubs {
  return { ...defaultStubs, ...overrides };
}
