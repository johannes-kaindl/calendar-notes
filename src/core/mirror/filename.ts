import { buildFilename } from "../../vendor/code-kit/filename-template";
import type { ContactData } from "../vcard/contact";
import type { EventData } from "../ical/event";
import type { TodoData } from "../ical/todo";
import { assertNever } from "./kind";
import type { MappingProfile, ProfileKind } from "./profile";

export function filenameSubs(kind: ProfileKind, data: ContactData | EventData | TodoData): Record<string, string> {
  if (kind === "contact") {
    const c = data as ContactData;
    return { fn: c.fn ?? "", family: c.n?.family ?? "", given: c.n?.given ?? "", org: c.org?.[0] ?? "", uid: c.uid };
  }
  if (kind === "event") {
    const e = data as EventData;
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(e.start);
    return { title: e.summary ?? "", start_date: m?.[1] ?? "", start_time: m?.[2] ? `${m[2]}-${m[3]}` : "", uid: e.uid };
  }
  if (kind === "todo") {
    const td = data as TodoData;
    // start UND due sind bei VTODO optional — beide Platzhalter muessen leer sein duerfen,
    // statt zu werfen: ein Nutzer darf "{due_date} {title}" in ein Aufgaben-Profil schreiben.
    const sub = (iso: string | undefined): string => /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "")?.[1] ?? "";
    return { title: td.summary ?? "", start_date: sub(td.start), due_date: sub(td.due), uid: td.uid };
  }
  return assertNever(kind, "Dateiname");
}

export function noteBasename(profile: MappingProfile, data: ContactData | EventData | TodoData): string {
  const name = buildFilename(profile.filename, filenameSubs(profile.kind, data), { fallbacks: ["{uid}"], lastResort: "dav-object" });
  return name.length > 120 ? name.slice(0, 120).trim() : name;
}

export function notePath(profile: MappingProfile, basename: string, suffix?: number): string {
  const file = `${basename}${suffix ? ` (${suffix})` : ""}.md`;
  return profile.folder ? `${profile.folder}/${file}` : file;
}
