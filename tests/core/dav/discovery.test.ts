import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { discover, listCollections } from "../../../src/core/dav/discovery";
import { fakeTransport } from "../../helpers/fake-transport";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/dav/${n}`, import.meta.url), "utf8");
const ms = (inner: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cr="urn:ietf:params:xml:ns:carddav">${inner}</d:multistatus>`;
const resp = (href: string, props: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

describe("discover", () => {
  it("radicale-artig: well-known redirect, principal, beide home-sets, sammlungen", async () => {
    const t = fakeTransport([
      { method: "PROPFIND", url: "https://dav.example/.well-known/caldav", status: 301, headers: { Location: "/test/" } },
      { method: "PROPFIND", url: "https://dav.example/test/", status: 207, text: ms(resp("/test/", `<d:current-user-principal><d:href>/test/</d:href></d:current-user-principal><c:calendar-home-set><d:href>/test/</d:href></c:calendar-home-set><cr:addressbook-home-set><d:href>/test/</d:href></cr:addressbook-home-set>`)), capture: (r) => { if (r.headers?.["Depth"] === "1") throw new Error("unexpected"); } },
    ]);
    // Depth:1-Listing separat routen (gleiche URL, anderer Depth-Header):
    const routesDepth1 = fakeTransport([
      { url: "https://dav.example/test/", status: 207, text: fx("propfind-radicale.xml") },
    ]);
    // Einfacher: ein Transport, der nach Depth verzweigt
    const byDepth = async (req: Parameters<typeof t>[0]) => (req.headers?.["Depth"] === "1" ? routesDepth1(req) : t(req));
    const res = await discover(byDepth, "https://dav.example/");
    expect(res.principal).toBe("https://dav.example/test/");
    expect(res.calendarHome).toBe("https://dav.example/test/");
    expect(res.addressbookHome).toBe("https://dav.example/test/");
    const kinds = res.collections.map((c) => [c.kind, c.displayName, c.readOnly]);
    expect(kinds).toEqual([["calendar", "Kalender", false], ["addressbook", "Kontakte", true]]);
    expect(res.collections[0]!.href).toBe("https://dav.example/test/kalender/");
    expect(res.collections[0]!.syncToken).toBe("http://radicale.org/ns/sync/42");
    expect(res.collections[0]!.components).toEqual(["VEVENT", "VTODO"]);
    expect(res.collections[0]!.color).toBe("#ff0000ff");
  });

  it("ohne well-known: baseUrl direkt als principal-quelle", async () => {
    const t = fakeTransport([
      { method: "PROPFIND", url: /\.well-known/, status: 404 },
      { method: "PROPFIND", url: "https://nc.example/remote.php/dav/", status: 207, text: ms(resp("/remote.php/dav/", `<d:current-user-principal><d:href>/remote.php/dav/principals/users/jay/</d:href></d:current-user-principal>`)) },
      { method: "PROPFIND", url: "https://nc.example/remote.php/dav/principals/users/jay/", status: 207, text: ms(resp("/remote.php/dav/principals/users/jay/", `<c:calendar-home-set><d:href>/remote.php/dav/calendars/jay/</d:href></c:calendar-home-set>`)) },
      { method: "PROPFIND", url: "https://nc.example/remote.php/dav/calendars/jay/", status: 207, text: fx("propfind-nextcloud.xml") },
    ]);
    const res = await discover(t, "https://nc.example/remote.php/dav/");
    expect(res.principal).toBe("https://nc.example/remote.php/dav/principals/users/jay/");
    expect(res.calendarHome).toBe("https://nc.example/remote.php/dav/calendars/jay/");
    expect(res.addressbookHome).toBeUndefined();
    expect(res.collections).toHaveLength(1);              // schedule-inbox und Home selbst gefiltert
    expect(res.collections[0]!.displayName).toBe("Persönlich");
    expect(res.warnings.join(" ")).toMatch(/addressbook-home-set/);
  });

  // Obsidians `requestUrl` folgt Weiterleitungen SELBST und behaelt dabei die Methode — der
  // 301-Zweig in `wellKnown` ist mit diesem Transport toter Code, wir sehen direkt 207 auf der
  // well-known-Adresse. Die Startadresse darf dann NICHT aus der Anfrage-URL geraten werden
  // (`/.well-known/caldav/` mit Slash schickt Nextcloud auf `/index.php/.well-known/caldav/`
  // → 405), sondern kommt aus dem `<d:href>` der Antwort, das der Server selbst nennt.
  it("transport ist dem well-known-redirect schon gefolgt: startadresse kommt aus dem antwort-href", async () => {
    const t = fakeTransport([
      { method: "PROPFIND", url: "https://nc.example/.well-known/caldav", status: 207, text: ms(resp("/remote.php/dav/", `<d:current-user-principal><d:href>/remote.php/dav/principals/users/jay/</d:href></d:current-user-principal>`)) },
      { method: "PROPFIND", url: "https://nc.example/remote.php/dav/", status: 207, text: ms(resp("/remote.php/dav/", `<d:current-user-principal><d:href>/remote.php/dav/principals/users/jay/</d:href></d:current-user-principal>`)) },
      { method: "PROPFIND", url: "https://nc.example/remote.php/dav/principals/users/jay/", status: 207, text: ms(resp("/remote.php/dav/principals/users/jay/", `<c:calendar-home-set><d:href>/remote.php/dav/calendars/jay/</d:href></c:calendar-home-set>`)) },
      { method: "PROPFIND", url: "https://nc.example/remote.php/dav/calendars/jay/", status: 207, text: fx("propfind-nextcloud.xml") },
    ]);
    const res = await discover(t, "https://nc.example/remote.php/dav/");

    expect(t.calls.map((c) => c.url)).not.toContain("https://nc.example/.well-known/caldav/");
    expect(res.principal).toBe("https://nc.example/remote.php/dav/principals/users/jay/");
    expect(res.calendarHome).toBe("https://nc.example/remote.php/dav/calendars/jay/");
  });

  it("401 wird als DavError mit status geworfen", async () => {
    const t = fakeTransport([{ url: /.*/, status: 401 }]);
    await expect(discover(t, "https://x.example/")).rejects.toMatchObject({ status: 401 });
  });
});

describe("listCollections", () => {
  it("ox default-namespace", async () => {
    const t = fakeTransport([{ url: "https://ox.example/caldav/", status: 207, text: fx("propfind-ox.xml") }]);
    const cols = await listCollections(t, "https://ox.example/caldav/", "calendar");
    expect(cols).toHaveLength(1);
    expect(cols[0]!.readOnly).toBe(false);   // write-content zählt als Schreibrecht
    expect(cols[0]!.ctag).toContain("open-xchange");
  });
});
