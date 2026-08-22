import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadServerItems, type AdoptDeps } from "../../../src/core/adopt/service";
import { defaultContactProfile, defaultEventProfile } from "../../../src/core/mirror/profile";
import { DEFAULT_SYNC, type Account, type CollectionConfig, type PluginSettings } from "../../../src/core/settings";
import type { DavRequest, DavResponse, Transport } from "../../../src/core/dav/types";
import { emptyState } from "../../../src/core/state/collection-state";

const FIXTURES = join(__dirname, "../../fixtures");
const read = (rel: string): string => readFileSync(join(FIXTURES, rel), "utf8");

const ACCOUNT: Account = { id: "acc1", name: "Acc", baseUrl: "https://dav.example/", username: "u", secretId: "sec1" };
const CONTACT_PROFILE = defaultContactProfile();
const EVENT_PROFILE = defaultEventProfile();

function refreshMS(href: string, kindProp: string): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cr="urn:ietf:params:xml:ns:carddav" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/>${kindProp}</d:resourcetype><d:displayname>Col</d:displayname><cs:getctag>"c1"</cs:getctag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}
function listingMS(colHref: string, entries: { href: string; etag: string }[]): string {
  const rows = entries.map((e) => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><d:getetag>"${e.etag}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("");
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${colHref}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${rows}</d:multistatus>`;
}
function addressbookMultigetMS(entries: { href: string; etag: string; data: string }[]): string {
  const rows = entries
    .map((e) => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><d:getetag>"${e.etag}"</d:getetag><cr:address-data>${e.data}</cr:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`)
    .join("");
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cr="urn:ietf:params:xml:ns:carddav">${rows}</d:multistatus>`;
}
function calendarMultigetMS(entries: { href: string; etag: string; data: string }[]): string {
  const rows = entries
    .map((e) => `<d:response><d:href>${e.href}</d:href><d:propstat><d:prop><d:getetag>"${e.etag}"</d:getetag><c:calendar-data>${e.data}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`)
    .join("");
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`;
}

function baseSettings(collections: CollectionConfig[]): PluginSettings {
  return { version: 1, accounts: [ACCOUNT], collections, profiles: [CONTACT_PROFILE, EVENT_PROFILE], sync: { ...DEFAULT_SYNC }, language: "auto" };
}

function makeDeps(t: Transport, secret: string | null = "geheim"): AdoptDeps {
  return {
    transportFor: () => t,
    secrets: { get: () => secret, set: () => {}, has: () => secret !== null },
    stateStore: {
      load: async (source) => emptyState(source),
      save: async () => {},
      remove: async () => {},
    },
    now: () => new Date("2026-08-22T12:00:00Z"),
  };
}

describe("loadServerItems", () => {
  it("loads all contacts of an addressbook collection (full listing, no prev snapshot)", async () => {
    const col: CollectionConfig = { id: "ab1", accountId: "acc1", href: "https://dav.example/ab1/", kind: "addressbook", displayName: "Contacts", enabled: true, profileId: CONTACT_PROFILE.id, readOnly: false };
    const settings = baseSettings([col]);
    const entries = [
      { href: "https://dav.example/ab1/c1.vcf", etag: "e1", data: read("vcard/v4-min.vcf") },
      { href: "https://dav.example/ab1/c2.vcf", etag: "e2", data: read("vcard/v3-full.vcf") },
    ];
    const calls: DavRequest[] = [];
    const t: Transport = async (req) => {
      calls.push(req);
      if (req.method === "PROPFIND" && req.headers?.["Depth"] === "0") return { status: 207, headers: {}, text: refreshMS(col.href, '<cr:addressbook xmlns:cr="urn:ietf:params:xml:ns:carddav"/>') };
      if (req.method === "PROPFIND" && req.headers?.["Depth"] === "1") return { status: 207, headers: {}, text: listingMS(col.href, entries) };
      if (req.method === "REPORT" && req.body?.includes("addressbook-multiget")) return { status: 207, headers: {}, text: addressbookMultigetMS(entries) };
      return { status: 404, headers: {}, text: "" };
    };
    const result = await loadServerItems(makeDeps(t), settings, "ab1");
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.kind === "contact")).toBe(true);
    expect(result.items.map((i) => i.uid).sort()).toEqual(["c3-1@test", "urn:uuid:5e2f1a9c-0000-4000-8000-000000000001"].sort());
    expect(result.source).toBe("acc1/ab1");
    // kein REPORT sync-collection: die Adoption ruft syncCollection immer mit prev=undefined,
    // Zeitfenster spielt fuer Adressbuecher ohnehin keine Rolle.
    expect(calls.some((c) => c.method === "REPORT" && c.body?.includes("sync-collection"))).toBe(false);
  });

  it("loads all events of a calendar collection as ServerItem[] (master only, no timeRange)", async () => {
    const col: CollectionConfig = { id: "cal1", accountId: "acc1", href: "https://dav.example/cal1/", kind: "calendar", displayName: "Events", enabled: true, profileId: EVENT_PROFILE.id, readOnly: false };
    const settings = baseSettings([col]);
    const entries = [
      { href: "https://dav.example/cal1/e1.ics", etag: "e1", data: read("ical/simple.ics") },
      { href: "https://dav.example/cal1/e2.ics", etag: "e2", data: read("ical/allday.ics") },
      { href: "https://dav.example/cal1/e3.ics", etag: "e3", data: read("ical/attendees.ics") },
    ];
    const t: Transport = async (req) => {
      if (req.method === "PROPFIND" && req.headers?.["Depth"] === "0") return { status: 207, headers: {}, text: refreshMS(col.href, '<c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/>') };
      if (req.method === "PROPFIND" && req.headers?.["Depth"] === "1") return { status: 207, headers: {}, text: listingMS(col.href, entries) };
      if (req.method === "REPORT" && req.body?.includes("calendar-multiget")) return { status: 207, headers: {}, text: calendarMultigetMS(entries) };
      if (req.method === "REPORT" && req.body?.includes("calendar-query")) throw new Error("Adoption darf kein Zeitfenster senden (calendar-query)");
      return { status: 404, headers: {}, text: "" };
    };
    const result = await loadServerItems(makeDeps(t), settings, "cal1");
    expect(result.items).toHaveLength(3);
    expect(result.items.every((i) => i.kind === "event")).toBe(true);
    expect(result.items.map((i) => i.uid).sort()).toEqual(["allday-1@test", "att-1@test", "simple-1@test"]);
  });

  it("throws when the collection isn't found", async () => {
    const settings = baseSettings([]);
    await expect(loadServerItems(makeDeps(async () => ({ status: 404, headers: {}, text: "" })), settings, "missing")).rejects.toThrow();
  });

  it("throws when no secret is stored for the account", async () => {
    const col: CollectionConfig = { id: "ab1", accountId: "acc1", href: "https://dav.example/ab1/", kind: "addressbook", displayName: "Contacts", enabled: true, profileId: CONTACT_PROFILE.id, readOnly: false };
    const settings = baseSettings([col]);
    const t: Transport = async () => ({ status: 404, headers: {}, text: "" });
    await expect(loadServerItems(makeDeps(t, null), settings, "ab1")).rejects.toThrow();
  });
});
