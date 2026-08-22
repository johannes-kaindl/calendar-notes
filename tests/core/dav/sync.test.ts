import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { syncCollection } from "../../../src/core/dav/sync";
import { fakeTransport } from "../../helpers/fake-transport";
import type { DavCollection } from "../../../src/core/dav/types";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/dav/${n}`, import.meta.url), "utf8");
const col: DavCollection = { href: "https://dav.example/test/kalender/", kind: "calendar", displayName: "K", readOnly: false, syncToken: "http://radicale.org/ns/sync/42", ctag: '"c1"' };
const MS = (inner: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`;
const obj = (href: string, etag: string, data?: string) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>"${etag}"</d:getetag>${data ? `<c:calendar-data>${data}</c:calendar-data>` : ""}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const ICS = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nEND:VEVENT\nEND:VCALENDAR";

describe("syncCollection — sync-collection strategy", () => {
  it("liefert changed (via multiget) + deleted + neuen token", async () => {
    const t = fakeTransport([
      { method: "REPORT", url: col.href, status: 207, text: fx("sync-collection.xml"), capture: (r) => { if (!r.body?.includes("sync-collection")) throw new Error("falscher report"); } },
    ]);
    // zweite REPORT-Route für multiget: gleiche URL → nach body verzweigen
    const t2 = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/a.ics", "e1", ICS)), capture: (r) => { if (r.headers?.["Depth"] !== "0") throw new Error(`multiget Depth erwartet "0", war ${r.headers?.["Depth"]}`); } }]);
    const byBody = (req: Parameters<typeof t>[0]) => (req.body?.includes("multiget") ? t2(req) : t(req));
    const d = await syncCollection(byBody, col, { syncToken: "http://radicale.org/ns/sync/42", etags: { "/test/kalender/gone.ics": '"old"' } });
    expect(d.strategy).toBe("sync-collection");
    expect(d.changed.map((o) => [o.href, o.etag])).toEqual([["https://dav.example/test/kalender/a.ics", '"e1"']]);
    expect(d.changed[0]!.data).toContain("UID:a");
    expect(d.deleted).toEqual(["https://dav.example/test/kalender/gone.ics"]);
    expect(d.outOfWindow).toEqual([]);
    expect(d.snapshot.syncToken).toBe("http://radicale.org/ns/sync/43");
    expect(d.snapshot.etags).toEqual({ "/test/kalender/a.ics": '"e1"' });
  });
  it("überspringt hrefs, deren etag schon im snapshot steht", async () => {
    const t = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: fx("sync-collection.xml") }]);
    const d = await syncCollection(t, col, { syncToken: "x", etags: { "/test/kalender/a.ics": '"e1"' } });
    expect(d.changed).toEqual([]);
    expect(t.calls.filter((c) => c.body?.includes("multiget"))).toHaveLength(0);
  });
  it("ungültiger token (403) → fallback etag-diff", async () => {
    const t = fakeTransport([
      { method: "REPORT", url: col.href, status: 403 },
      { method: "PROPFIND", url: col.href, status: 207, text: MS(`<d:response><d:href>/test/kalender/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` + obj("/test/kalender/b.ics", "e2")) },
    ]);
    const t2 = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/b.ics", "e2", ICS)) }]);
    const byBody = (req: Parameters<typeof t>[0]) => (req.body?.includes("multiget") ? t2(req) : t(req));
    const d = await syncCollection(byBody, col, { syncToken: "stale", etags: {} });
    expect(d.strategy).toBe("etag-diff");
    expect(d.changed.map((o) => o.href)).toEqual(["https://dav.example/test/kalender/b.ics"]);
  });
});

describe("syncCollection — etag-diff strategy", () => {
  const colNoToken: DavCollection = { ...col, syncToken: undefined };
  it("ctag gleich → unchanged, kein Listing", async () => {
    const t = fakeTransport([]);
    const d = await syncCollection(t, colNoToken, { ctag: '"c1"', etags: { "/test/kalender/a.ics": '"e1"' } });
    expect(d.unchanged).toBe(true);
    expect(t.calls).toHaveLength(0);
    expect(d.snapshot.etags).toEqual({ "/test/kalender/a.ics": '"e1"' });
  });
  it("listing-diff: neu, geändert, gelöscht; Sammlung selbst übersprungen", async () => {
    const listing = MS(`<d:response><d:href>/test/kalender/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` + obj("/test/kalender/a.ics", "e1") + obj("/test/kalender/c.ics", "e3"));
    const t = fakeTransport([{ method: "PROPFIND", url: col.href, status: 207, text: listing }]);
    const t2 = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/c.ics", "e3", ICS)) }]);
    const byBody = (req: Parameters<typeof t>[0]) => (req.method === "REPORT" ? t2(req) : t(req));
    const d = await syncCollection(byBody, colNoToken, { ctag: '"c0"', etags: { "/test/kalender/a.ics": '"e1"', "/test/kalender/old.ics": '"e0"' } });
    expect(d.strategy).toBe("etag-diff");
    expect(d.changed.map((o) => o.href)).toEqual(["https://dav.example/test/kalender/c.ics"]);
    expect(d.deleted).toEqual(["https://dav.example/test/kalender/old.ics"]);
    expect(d.outOfWindow).toEqual([]);
    expect(d.snapshot.ctag).toBe('"c1"');
    expect(Object.keys(d.snapshot.etags).sort()).toEqual(["/test/kalender/a.ics", "/test/kalender/c.ics"]);
  });
  it("mit timeRange: calendar-query statt PROPFIND", async () => {
    const t = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/a.ics", "e1")) , capture: (r) => { if (!r.body?.includes("time-range")) throw new Error("kein time-range"); } }]);
    const t2 = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/a.ics", "e1", ICS)) }]);
    const byBody = (req: Parameters<typeof t>[0]) => (req.body?.includes("multiget") ? t2(req) : t(req));
    const d = await syncCollection(byBody, colNoToken, undefined, { timeRange: { start: "20260101T000000Z", end: "20270101T000000Z" } });
    expect(d.changed).toHaveLength(1);
  });
  it("mit timeRange: Objekte außerhalb des Fensters landen in outOfWindow, nicht in deleted", async () => {
    const t = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/a.ics", "e1")) }]);
    const t2 = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/a.ics", "e1", ICS)) }]);
    const byBody = (req: Parameters<typeof t>[0]) => (req.body?.includes("multiget") ? t2(req) : t(req));
    const prev = { etags: { "/test/kalender/a.ics": '"e1"', "/test/kalender/ausserhalb.ics": '"e9"' } };
    const d = await syncCollection(byBody, colNoToken, prev, { timeRange: { start: "20260101T000000Z", end: "20270101T000000Z" } });
    expect(d.deleted).toEqual([]);
    expect(d.outOfWindow).toEqual(["https://dav.example/test/kalender/ausserhalb.ics"]);
    expect(d.snapshot.etags).toEqual({ "/test/kalender/a.ics": '"e1"' });
  });
  it("multiget batcht", async () => {
    const many = Array.from({ length: 120 }, (_, i) => obj(`/test/kalender/${i}.ics`, `e${i}`)).join("");
    const t = fakeTransport([{ method: "PROPFIND", url: col.href, status: 207, text: MS(many) }]);
    let reports = 0;
    const t2 = fakeTransport([{ method: "REPORT", url: col.href, status: 207, text: MS(obj("/test/kalender/0.ics", "e0", ICS)), capture: () => { reports++; } }]);
    const byBody = (req: Parameters<typeof t>[0]) => (req.method === "REPORT" ? t2(req) : t(req));
    await syncCollection(byBody, colNoToken, undefined, { batchSize: 50 });
    expect(reports).toBe(3);
  });
});
