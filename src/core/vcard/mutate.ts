import ICAL from "ical.js";
import type { ContactData } from "./contact";

export type ContactMutation =
  | { kind: "fn"; fn: string }
  | { kind: "n"; n: NonNullable<ContactData["n"]> }
  | { kind: "org"; org: string[] | null }
  | { kind: "title"; title: string | null }
  | { kind: "setEmail"; index: number | "new"; value: string; types?: string[] }
  | { kind: "removeEmail"; index: number }
  | { kind: "setTel"; index: number | "new"; value: string; types?: string[] }
  | { kind: "removeTel"; index: number }
  | { kind: "note"; note: string | null }
  | { kind: "bday"; bday: string | null };

function parseComponent(vcf: string): ICAL.Component {
  const jcal: unknown = ICAL.parse(vcf);
  if (!Array.isArray(jcal)) throw new Error("kein VCARD");
  return new ICAL.Component(jcal);
}

function setOrRemove(root: ICAL.Component, name: string, value: string | null): void {
  root.removeAllProperties(name);
  if (value !== null && value !== "") root.addPropertyWithValue(name, value);
}

function revNow(now: Date, version: string): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return version === "4.0" ? iso.replace(/[-:]/g, "") : iso;
}

function setTypes(p: ICAL.Property, types: string[] | undefined, version: string): void {
  if (!types) return;
  p.removeParameter("type");
  if (types.length === 0) return;
  const norm = version === "4.0" ? types.map((t) => t.toLowerCase()) : types.map((t) => t.toUpperCase());
  p.setParameter("type", norm.length === 1 ? norm[0]! : norm);
}

function upsertTyped(root: ICAL.Component, name: "email" | "tel", index: number | "new", value: string, types: string[] | undefined, version: string): void {
  const all = root.getAllProperties(name);
  const wire = name === "tel" && version === "4.0" && !value.startsWith("tel:") ? `tel:${value}` : value;
  const existing = index === "new" ? undefined : all[index];
  if (!existing) {
    const p = new ICAL.Property(name, root);
    p.setValue(wire);
    setTypes(p, types, version);
    root.addProperty(p);
  } else {
    existing.setValue(wire);
    setTypes(existing, types, version);
  }
}

function removeTyped(root: ICAL.Component, name: "email" | "tel", index: number): void {
  const p = root.getAllProperties(name)[index];
  if (p) root.removeProperty(p);
}

export function applyContactMutation(vcf: string, m: ContactMutation, opts: { now: Date } = { now: new Date() }): string {
  const root = parseComponent(vcf);
  if (root.name !== "vcard") throw new Error("kein VCARD");
  const version = String(root.getFirstPropertyValue("version") ?? "3.0");
  switch (m.kind) {
    case "fn": setOrRemove(root, "fn", m.fn); break;
    case "n": {
      root.removeAllProperties("n");
      const p = new ICAL.Property("n", root);
      p.setValues([[m.n.family ?? "", m.n.given ?? "", m.n.additional ?? "", m.n.prefix ?? "", m.n.suffix ?? ""]]);
      root.addProperty(p);
      break;
    }
    case "org": {
      root.removeAllProperties("org");
      if (m.org && m.org.length > 0) {
        const p = new ICAL.Property("org", root);
        p.setValue(m.org.length === 1 ? m.org[0]! : m.org);
        root.addProperty(p);
      }
      break;
    }
    case "title": setOrRemove(root, "title", m.title); break;
    case "note": setOrRemove(root, "note", m.note); break;
    case "bday": setOrRemove(root, "bday", m.bday === null ? null : version === "4.0" ? m.bday.replace(/-/g, "") : m.bday); break;
    case "setEmail": upsertTyped(root, "email", m.index, m.value, m.types, version); break;
    case "removeEmail": removeTyped(root, "email", m.index); break;
    case "setTel": upsertTyped(root, "tel", m.index, m.value, m.types, version); break;
    case "removeTel": removeTyped(root, "tel", m.index); break;
  }
  setOrRemove(root, "rev", revNow(opts.now, version));
  return root.toString();
}

export function newContactVcf(
  c: { uid: string; fn: string; n?: ContactData["n"]; email?: string; tel?: string; org?: string },
  opts: { now: Date; version?: "3.0" | "4.0" },
): string {
  const version = opts.version ?? "3.0";
  const root = new ICAL.Component("vcard");
  root.addPropertyWithValue("version", version);
  root.addPropertyWithValue("uid", c.uid);
  root.addPropertyWithValue("fn", c.fn);
  if (c.n) {
    const p = new ICAL.Property("n", root);
    p.setValues([[c.n.family ?? "", c.n.given ?? "", c.n.additional ?? "", c.n.prefix ?? "", c.n.suffix ?? ""]]);
    root.addProperty(p);
  }
  if (c.org) root.addPropertyWithValue("org", c.org);
  if (c.email) upsertTyped(root, "email", "new", c.email, undefined, version);
  if (c.tel) upsertTyped(root, "tel", "new", c.tel, ["cell"], version);
  root.addPropertyWithValue("rev", revNow(opts.now, version));
  return root.toString();
}
