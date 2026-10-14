import { buildFilename } from "../../vendor/code-kit/filename-template";
import { slugify } from "../../vendor/code-kit/slug";
import type { ContactData } from "../vcard/contact";
import type { EventData } from "../ical/event";
import type { TodoData } from "../ical/todo";
import { assertNever } from "./kind";
import type { MappingProfile, ProfileKind } from "./profile";

// Betreff/Name als Slug (ASCII, `-` als Trenner, kein `_`): so steht er zwischen den Unterstrichen der
// Namenskonvention `YYYY-MM-DD_kategorie_kuerzel_betreff`. 60 Zeichen wie mailstones Betreff-Slug.
const slug = (s: string | undefined): string => slugify(s ?? "", { maxLength: 60 });

export function filenameSubs(kind: ProfileKind, data: ContactData | EventData | TodoData): Record<string, string> {
  if (kind === "contact") {
    const c = data as ContactData;
    return { fn: c.fn ?? "", fn_slug: slug(c.fn), family: c.n?.family ?? "", given: c.n?.given ?? "", org: c.org?.[0] ?? "", uid: c.uid };
  }
  if (kind === "event") {
    const e = data as EventData;
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(e.start);
    return { title: e.summary ?? "", title_slug: slug(e.summary), start_date: m?.[1] ?? "", start_time: m?.[2] ? `${m[2]}-${m[3]}` : "", uid: e.uid };
  }
  if (kind === "todo") {
    const td = data as TodoData;
    // start UND due sind bei VTODO optional — beide Platzhalter muessen leer sein duerfen,
    // statt zu werfen: ein Nutzer darf "{due_date} {title}" in ein Aufgaben-Profil schreiben.
    const sub = (iso: string | undefined): string => /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "")?.[1] ?? "";
    return { title: td.summary ?? "", title_slug: slug(td.summary), start_date: sub(td.start), due_date: sub(td.due), uid: td.uid };
  }
  return assertNever(kind, "Dateiname");
}

/** `{fm:schluessel}` im Dateinamen-Schema: Literale aus `profile.onCreate` (Strings und Zahlen), die die Notiz
 *  beim Anlegen bekommt. Der Wert eines VERWALTETEN Feldes steht nicht zur Verfuegung — er aendert sich mit dem
 *  Server, der Dateiname einer bestehenden Notiz tut es nie. Fehlt der Schluessel, ist der Platzhalter leer. */
function withFrontmatterSubs(profile: MappingProfile, template: string, subs: Record<string, string>): { template: string; subs: Record<string, string> } {
  const out = { ...subs };
  const tpl = template.replace(/\{fm:(\w+)\}/g, (_w, key: string) => {
    const name = `fm_${key}`;
    const v = Object.hasOwn(profile.onCreate, key) ? profile.onCreate[key] : undefined;
    out[name] = typeof v === "string" || typeof v === "number" ? String(v) : "";
    return `{${name}}`;
  });
  return { template: tpl, subs: out };
}

export function noteBasename(profile: MappingProfile, data: ContactData | EventData | TodoData): string {
  const { template, subs } = withFrontmatterSubs(profile, profile.filename, filenameSubs(profile.kind, data));
  return buildFilename(template, subs, { fallbacks: ["{uid}"], lastResort: "dav-object", maxLength: 120 });
}

export function notePath(profile: MappingProfile, basename: string, suffix?: number): string {
  const file = `${basename}${suffix ? ` (${suffix})` : ""}.md`;
  return profile.folder ? `${profile.folder}/${file}` : file;
}
