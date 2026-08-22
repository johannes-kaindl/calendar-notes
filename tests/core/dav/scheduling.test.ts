import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { discoverScheduling } from "../../../src/core/dav/scheduling";
import { fakeTransport } from "../../helpers/fake-transport";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/dav/${n}`, import.meta.url), "utf8");

describe("discoverScheduling", () => {
  it("nextcloud/sabre: outbox, inbox, nur mailto-Adressen (gestrippt + lowercased)", async () => {
    const t = fakeTransport([
      { method: "PROPFIND", url: "https://nc.example/remote.php/dav/principals/users/jay/", status: 207, text: fx("principal-nextcloud.xml") },
    ]);
    const res = await discoverScheduling(t, "https://nc.example/remote.php/dav/principals/users/jay/");
    expect(res.outbox).toBe("https://nc.example/remote.php/dav/calendars/jay/outbox/");
    expect(res.inbox).toBe("https://nc.example/remote.php/dav/calendars/jay/inbox/");
    expect(res.addresses).toEqual(["jay@example.test"]);
    const call = t.calls[0]!;
    expect(call.headers?.["Depth"]).toBe("0");
  });

  it("radicale: keine Scheduling-Props → leeres Ergebnis", async () => {
    const t = fakeTransport([
      { method: "PROPFIND", url: "https://dav.example/test/", status: 207, text: fx("principal-radicale.xml") },
    ]);
    const res = await discoverScheduling(t, "https://dav.example/test/");
    expect(res.outbox).toBeUndefined();
    expect(res.inbox).toBeUndefined();
    expect(res.addresses).toEqual([]);
  });

  it("relative hrefs werden gegen principalUrl aufgelöst", async () => {
    const ms = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/p/jay/</d:href><d:propstat><d:prop><c:schedule-outbox-URL><d:href>outbox/</d:href></c:schedule-outbox-URL></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
    const t = fakeTransport([{ url: "https://dav.example/p/jay/", status: 207, text: ms }]);
    const res = await discoverScheduling(t, "https://dav.example/p/jay/");
    expect(res.outbox).toBe("https://dav.example/p/jay/outbox/");
  });

  it("non-207 wirft DavError", async () => {
    const t = fakeTransport([{ url: /.*/, status: 401 }]);
    await expect(discoverScheduling(t, "https://x.example/p/")).rejects.toMatchObject({ status: 401 });
  });
});
