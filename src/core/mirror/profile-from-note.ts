import { newId } from "../settings";
import {
  CONTACT_SERVER_FIELDS,
  EVENT_SERVER_FIELDS,
  defaultContactProfile,
  defaultEventProfile,
  type FmVal,
  type MappingProfile,
  type ProfileKind,
} from "./profile";

// Synonyme (klein geschrieben, deutsch/englisch) → Server-Feld. "title" gehört bewusst nur zur
// fn-Gruppe (Notiz-Titel = Personenname) — der Job-Titel hat dafür eigene Schlüssel
// (rolle/job_title/position), damit derselbe literale Key nicht in zwei Gruppen kollidiert.
const CONTACT_SYNONYMS: Record<string, string> = {
  email: "email",
  "e-mail": "email",
  mail: "email",
  mobil: "tel_cell",
  mobile: "tel_cell",
  handy: "tel_cell",
  phone_mobile: "tel_cell",
  telefon: "tel_home",
  phone: "tel_home",
  tel: "tel_home",
  festnetz: "tel_home",
  phone_work: "tel_work",
  telefon_arbeit: "tel_work",
  work_phone: "tel_work",
  organisation: "org",
  organization: "org",
  org: "org",
  firma: "org",
  company: "org",
  rolle: "title",
  job_title: "title",
  position: "title",
  website: "url",
  url: "url",
  web: "url",
  homepage: "url",
  adresse: "adr",
  address: "adr",
  anschrift: "adr",
  geburtstag: "bday",
  birthday: "bday",
  bday: "bday",
  name: "fn",
  title: "fn",
  fn: "fn",
};

const EVENT_SYNONYMS: Record<string, string> = {
  termin_start: "start",
  start: "start",
  beginn: "start",
  datum: "start",
  termin_ende: "end",
  end: "end",
  ende: "end",
  ort: "location",
  location: "location",
  online: "online",
  teilnehmer: "attendees",
  attendees: "attendees",
  link: "url",
  title: "title",
  titel: "title",
  status: "status",
};

const UID_KEYS = ["vcard_uid", "ical_uid", "uid"];
const ON_CREATE_KEYS = ["type", "status", "up"];

function synonymsFor(kind: ProfileKind): Record<string, string> {
  return kind === "contact" ? CONTACT_SYNONYMS : EVENT_SYNONYMS;
}
function serverFieldsFor(kind: ProfileKind): readonly string[] {
  return kind === "contact" ? CONTACT_SERVER_FIELDS : EVENT_SERVER_FIELDS;
}

/**
 * Leitet aus einer Beispiel-Notiz (Frontmatter) einen Mapping-Vorschlag ab: erkennt gängige
 * de/en-Feldnamen, übernimmt `type`/`status`/`up` verbatim ins onCreate und erkennt ein
 * abweichendes Uid-Feld (`vcard_uid`/`ical_uid`/`uid`). Das Ergebnis besteht `validateProfile`.
 */
export function suggestProfileFromNote(
  kind: ProfileKind,
  frontmatter: Record<string, unknown>,
  opts: { folder: string; name: string; rand: () => number },
): { profile: MappingProfile; mapped: Record<string, string>; unmapped: string[] } {
  const base = kind === "contact" ? defaultContactProfile() : defaultEventProfile();
  const synonyms = synonymsFor(kind);
  const fields: Record<string, string | null> = {};
  for (const f of serverFieldsFor(kind)) fields[f] = null;

  // type/status/up sind fürs onCreate reserviert und stehen deshalb nie als Feld-Kandidaten zur
  // Verfügung — sonst würde z. B. ein Event mit "status: confirmed" gleichzeitig fields.status UND
  // onCreate.status befüllen. Der Server-Feld "status" bleibt in der Vorschlags-Suggestion also
  // immer unbelegt (null), auch wenn die Notiz eine literale "status"-Spalte trägt.
  const mapped: Record<string, string> = {};
  const keys = Object.keys(frontmatter);
  for (const key of keys) {
    if (ON_CREATE_KEYS.includes(key)) continue;
    const serverField = synonyms[key.toLowerCase()];
    if (serverField && Object.hasOwn(fields, serverField) && fields[serverField] === null) {
      fields[serverField] = key;
      mapped[serverField] = key;
    }
  }

  let uidField = base.uidField;
  for (const k of UID_KEYS) {
    if (Object.hasOwn(frontmatter, k)) {
      uidField = k;
      break;
    }
  }

  const onCreate: Record<string, FmVal> = {};
  const onCreateHandled = new Set<string>();
  for (const k of ON_CREATE_KEYS) {
    if (!Object.hasOwn(frontmatter, k)) continue;
    const v = frontmatter[k];
    if (typeof v === "string" && v.length > 0) {
      onCreate[k] = v;
      onCreateHandled.add(k);
    } else if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
      onCreate[k] = v;
      onCreateHandled.add(k);
    }
    // sonst: unzulässiger Typ (z. B. Zahl/Objekt) → fällt unten in unmapped statt stillschweigend zu verschwinden
  }

  const unmapped = keys.filter((key) => {
    if (Object.values(mapped).includes(key)) return false;
    if (key === uidField) return false;
    if (ON_CREATE_KEYS.includes(key)) return !onCreateHandled.has(key);
    return true;
  });

  const profile: MappingProfile = {
    ...base,
    id: newId(kind === "contact" ? "profile-c" : "profile-e", opts.rand),
    name: opts.name,
    folder: opts.folder,
    uidField,
    fields,
    onCreate,
  };

  return { profile, mapped, unmapped };
}
