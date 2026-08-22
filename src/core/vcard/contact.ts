import ICAL from "ical.js";

export interface Typed { value: string; types: string[]; pref: boolean }
export interface Address { types: string[]; street?: string; city?: string; zip?: string; region?: string; country?: string; pobox?: string; ext?: string; pref: boolean }
export interface ContactData {
  uid: string; version: "3.0" | "4.0"; fn: string;
  n?: { family?: string; given?: string; additional?: string; prefix?: string; suffix?: string };
  nickname?: string; org?: string[]; title?: string; role?: string;
  emails: Typed[]; tels: Typed[]; urls: Typed[]; adrs: Address[];
  bday?: string; note?: string; photo?: { mediaType?: string; data?: string; uri?: string }; categories: string[]; rev?: string;
}

function typesOf(p: ICAL.Property): { types: string[]; pref: boolean } {
  const raw = p.getParameter("type");
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((t) => String(t).toLowerCase());
  const pref = list.includes("pref") || String(p.getParameter("pref") ?? "") === "1";
  return { types: list.filter((t) => t !== "pref"), pref };
}

function typed(p: ICAL.Property, strip?: RegExp): Typed {
  let value = String(p.getFirstValue() ?? "");
  if (strip) value = value.replace(strip, "");
  return { value, ...typesOf(p) };
}

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined || o[k] === "") delete o[k];
  return o;
}

export function normalizeDate(s: string): string {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

function structuredParts(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => (Array.isArray(x) ? x.join(" ") : String(x ?? "")));
}

export function parseContact(vcf: string): ContactData {
  const jcal: unknown = ICAL.parse(vcf);
  if (!Array.isArray(jcal)) throw new Error("kein VCARD");
  const root = new ICAL.Component(jcal);
  if (root.name !== "vcard") throw new Error("kein VCARD");
  const str = (n: string): string | undefined => {
    const v = root.getFirstPropertyValue(n);
    return v === null || v === undefined ? undefined : String(v);
  };
  const version: "3.0" | "4.0" = str("version") === "4.0" ? "4.0" : "3.0";
  const c: ContactData = { uid: str("uid") ?? "", version, fn: str("fn") ?? "", emails: [], tels: [], urls: [], adrs: [], categories: [] };
  const nProp = root.getFirstProperty("n");
  if (nProp) {
    const nv: unknown = nProp.getValues()[0];
    const [family, given, additional, prefix, suffix] = structuredParts(nv);
    c.n = clean({ family, given, additional, prefix, suffix });
  }
  const nick = str("nickname");
  if (nick) c.nickname = nick;
  const orgProp = root.getFirstProperty("org");
  if (orgProp) {
    const orgv: unknown = orgProp.getValues()[0];
    c.org = (Array.isArray(orgv) ? orgv : [orgv]).map((x) => String(x)).filter((s) => s.length > 0);
  }
  const title = str("title");
  if (title) c.title = title;
  const role = str("role");
  if (role) c.role = role;
  for (const p of root.getAllProperties("email")) c.emails.push(typed(p, /^mailto:/i));
  for (const p of root.getAllProperties("tel")) c.tels.push(typed(p, /^tel:/i));
  for (const p of root.getAllProperties("url")) c.urls.push(typed(p));
  for (const p of root.getAllProperties("adr")) {
    const v: unknown = p.getValues()[0];
    const [pobox, ext, street, city, region, zip, country] = structuredParts(v);
    c.adrs.push(clean({ ...typesOf(p), pobox, ext, street, city, region, zip, country }));
  }
  const bday = str("bday");
  if (bday) c.bday = normalizeDate(bday);
  const note = str("note");
  if (note) c.note = note;
  for (const p of root.getAllProperties("categories")) for (const v of p.getValues()) c.categories.push(String(v));
  const photo = root.getFirstProperty("photo");
  if (photo) {
    const val = String(photo.getFirstValue() ?? "");
    const encParam = photo.getParameter("encoding");
    const enc = String(Array.isArray(encParam) ? encParam[0] : (encParam ?? "")).toLowerCase();
    const typParam = photo.getParameter("type");
    const typ = String(Array.isArray(typParam) ? typParam[0] : (typParam ?? "")).toLowerCase();
    if (val.startsWith("data:")) {
      const m = /^data:([^;]+);base64,(.*)$/s.exec(val);
      c.photo = m ? { mediaType: m[1], data: m[2] } : { uri: val };
    } else if (enc === "b" || enc === "base64") {
      c.photo = clean({ mediaType: typ ? `image/${typ}` : undefined, data: val });
    } else {
      c.photo = { uri: val };
    }
  }
  const rev = str("rev");
  if (rev) {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})Z?$/.exec(rev);
    c.rev = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : rev;
  }
  return c;
}

export function primaryEmail(c: ContactData): string | undefined {
  return (c.emails.find((e) => e.pref) ?? c.emails[0])?.value;
}
export function primaryTel(c: ContactData, kind?: "cell" | "home" | "work"): string | undefined {
  const pool = kind ? c.tels.filter((t) => t.types.includes(kind)) : c.tels;
  return (pool.find((t) => t.pref) ?? pool[0])?.value;
}
