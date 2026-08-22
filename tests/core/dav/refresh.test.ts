import { describe, it, expect } from "vitest";
import { refreshCollection } from "../../../src/core/dav/refresh";
import type { DavCollection } from "../../../src/core/dav/types";
import { fakeTransport } from "../../helpers/fake-transport";

const BASE: DavCollection = {
  href: "https://d/cal/1/",
  kind: "calendar",
  displayName: "Old",
  ctag: "old-ctag",
  syncToken: "old-token",
  readOnly: false,
};

function ms(propsXml: string, status = "HTTP/1.1 200 OK"): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/1/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>${propsXml}</d:prop><d:status>${status}</d:status></d:propstat></d:response></d:multistatus>`;
}

describe("refreshCollection", () => {
  it("207 with new ctag+sync-token updates those fields, keeps rest", async () => {
    const t = fakeTransport([
      { method: "PROPFIND", url: BASE.href, status: 207, text: ms('<d:displayname>Cal One</d:displayname><cs:getctag xmlns:cs="http://calendarserver.org/ns/">new-ctag</cs:getctag><d:sync-token>new-token</d:sync-token>') },
    ]);
    const fresh = await refreshCollection(t, BASE);
    expect(fresh.ctag).toBe("new-ctag");
    expect(fresh.syncToken).toBe("new-token");
    expect(fresh.displayName).toBe("Cal One");
    expect(fresh.href).toBe(BASE.href);
    expect(fresh.kind).toBe("calendar");
  });

  it("207 without sync-token keeps the old token", async () => {
    const t = fakeTransport([
      { method: "PROPFIND", url: BASE.href, status: 207, text: ms('<cs:getctag xmlns:cs="http://calendarserver.org/ns/">new-ctag</cs:getctag>') },
    ]);
    const fresh = await refreshCollection(t, BASE);
    expect(fresh.ctag).toBe("new-ctag");
    expect(fresh.syncToken).toBe("old-token");
  });

  it("404 rejects with DavError status 404", async () => {
    const t = fakeTransport([{ method: "PROPFIND", url: BASE.href, status: 404, text: "" }]);
    await expect(refreshCollection(t, BASE)).rejects.toMatchObject({ status: 404 });
  });

  it("other status rejects with DavError", async () => {
    const t = fakeTransport([{ method: "PROPFIND", url: BASE.href, status: 500, text: "" }]);
    await expect(refreshCollection(t, BASE)).rejects.toMatchObject({ status: 500 });
  });
});
