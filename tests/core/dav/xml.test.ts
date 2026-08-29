import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseMultistatus, textOf, hrefsOf, hasChild, statusCode } from "../../../src/core/dav/xml";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/dav/${n}`, import.meta.url), "utf8");

describe("parseMultistatus", () => {
  it("radicale: responses, props ohne prefix, 404-propstat nicht in props", () => {
    const ms = parseMultistatus(fx("propfind-radicale.xml"));
    expect(ms.responses.map((r) => r.href)).toEqual(["/test/", "/test/kalender/", "/test/kontakte/"]);
    const kal = ms.responses[1]!;
    expect(textOf(kal.props["displayname"])).toBe("Kalender");
    expect(textOf(kal.props["getctag"])).toBe('"abc123"');
    expect(hasChild(kal.props["resourcetype"], "calendar")).toBe(true);
    expect(hasChild(kal.props["resourcetype"], "addressbook")).toBe(false);
    const kon = ms.responses[2]!;
    expect(hasChild(kon.props["resourcetype"], "addressbook")).toBe(true);
    expect(kon.props["supported-calendar-component-set"]).toBeUndefined();
    expect(kon.propstats.map((p) => p.status)).toEqual([200, 404]);
  });
  it("nextcloud: entities decoded, schedule-inbox erkannt", () => {
    const ms = parseMultistatus(fx("propfind-nextcloud.xml"));
    expect(textOf(ms.responses[1]!.props["displayname"])).toBe("Persönlich");
    expect(hasChild(ms.responses[2]!.props["resourcetype"], "schedule-inbox")).toBe(true);
  });
  it("ox: default namespace ohne prefix", () => {
    const ms = parseMultistatus(fx("propfind-ox.xml"));
    expect(hasChild(ms.responses[0]!.props["resourcetype"], "calendar")).toBe(true);
    expect(textOf(ms.responses[0]!.props["getctag"])).toContain("open-xchange");
  });
  it("sync-collection: token + 404-response als gelöscht", () => {
    const ms = parseMultistatus(fx("sync-collection.xml"));
    expect(ms.syncToken).toBe("http://radicale.org/ns/sync/43");
    expect(ms.responses[1]!.status).toBe(404);
    expect(textOf(ms.responses[0]!.props["getetag"])).toBe('"e1"');
  });
  it("einzelne response wird zu Array normalisiert", () => {
    const ms = parseMultistatus(`<D:multistatus xmlns:D="DAV:"><D:response><D:href>/x/</D:href><D:propstat><D:prop><D:displayname>X</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`);
    expect(ms.responses).toHaveLength(1);
  });
  it("wirft bei nicht-XML", () => {
    expect(() => parseMultistatus("<html><body>login</body></html>")).toThrow(/multistatus/);
  });
});
describe("helpers", () => {
  it("hrefsOf liest mehrere hrefs", () => {
    const ms = parseMultistatus(`<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/p/</D:href><D:propstat><D:prop><C:calendar-home-set><D:href>/a/</D:href><D:href>/b/</D:href></C:calendar-home-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`);
    expect(hrefsOf(ms.responses[0]!.props["calendar-home-set"])).toEqual(["/a/", "/b/"]);
  });
  it("statusCode", () => {
    expect(statusCode("HTTP/1.1 207 Multi-Status")).toBe(207);
    expect(statusCode(undefined)).toBeUndefined();
  });
});

describe("parseMultistatus — die Fehlermeldung muss diagnostizierbar sein", () => {
  // Anlass: 2026-08-29 meldete das Plugin gegen mailbox.org "Antwort ist kein DAV:multistatus"
  // — ohne zu sagen, WELCHE der sieben Aufrufstellen gescheitert war und was stattdessen kam.
  // Damit war der Fehler aus der Meldung heraus nicht eingrenzbar.
  it("nennt die Anfrage, deren Antwort nicht passt", () => {
    expect(() => parseMultistatus("<html><body>Nope</body></html>", "REPORT https://dav.example/cal/"))
      .toThrow(/REPORT https:\/\/dav\.example\/cal\//);
  });

  it("unterscheidet einen leeren Koerper von einem fremden Inhalt", () => {
    expect(() => parseMultistatus("", "PROPFIND https://dav.example/")).toThrow(/Koerper ist leer/);
    expect(() => parseMultistatus("<html><body>Fehlerseite</body></html>", "PROPFIND https://dav.example/"))
      .toThrow(/beginnt mit: <html>/);
  });

  it("bleibt ohne Quellenangabe benutzbar", () => {
    expect(() => parseMultistatus("<nope/>")).toThrow(/kein DAV:multistatus/);
  });
});

describe("parseMultistatus — ein LEERER Multistatus ist gueltig, kein Fehler", () => {
  // Eine leere Sammlung antwortet regulaer mit einem Wurzelknoten ohne Kinder. mailbox.org
  // schickt ihn selbstschliessend; fast-xml-parser macht daraus einen leeren String, nicht
  // ein leeres Objekt. Bis 2026-08-29 brach daran jeder Abgleich einer leeren Sammlung ab.
  const LEER_SELBSTSCHLIESSEND =
    '<?xml version="1.0" encoding="UTF-8"?>\n<D:multistatus xmlns:D="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav" />';
  const LEER_MIT_ENDTAG = '<?xml version="1.0" encoding="UTF-8"?>\n<D:multistatus xmlns:D="DAV:"></D:multistatus>';

  it("liefert fuer die selbstschliessende Form eine leere Antwortliste", () => {
    expect(parseMultistatus(LEER_SELBSTSCHLIESSEND, "PROPFIND https://dav.example/cal/").responses).toEqual([]);
  });

  it("liefert fuer die Form mit Endtag ebenfalls eine leere Antwortliste", () => {
    expect(parseMultistatus(LEER_MIT_ENDTAG).responses).toEqual([]);
  });

  it("wirft weiterhin, wenn gar kein multistatus da ist", () => {
    expect(() => parseMultistatus("<html><body>Fehlerseite</body></html>", "PROPFIND https://dav.example/"))
      .toThrow(/kein DAV:multistatus/);
  });
});
