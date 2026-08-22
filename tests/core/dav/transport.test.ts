import { describe, it, expect } from "vitest";
import { withBasicAuth, base64Utf8, headerValue } from "../../../src/core/dav/transport";
import type { DavRequest, DavResponse } from "../../../src/core/dav/types";

describe("base64Utf8", () => {
  it("encodes umlauts as UTF-8", () => {
    expect(base64Utf8("jörg:pässwort")).toBe("asO2cmc6cMOkc3N3b3J0");
  });
});
describe("withBasicAuth", () => {
  it("adds Authorization and keeps other headers", async () => {
    let seen: DavRequest | undefined;
    const fake = async (req: DavRequest): Promise<DavResponse> => { seen = req; return { status: 200, headers: {}, text: "" }; };
    await withBasicAuth(fake, "u", "p")({ method: "GET", url: "https://x/", headers: { Depth: "0" } });
    expect(seen?.headers).toEqual({ Depth: "0", Authorization: "Basic dTpw" });
  });
});
describe("headerValue", () => {
  it("is case-insensitive", () => {
    expect(headerValue({ ETag: '"1"' }, "etag")).toBe('"1"');
    expect(headerValue({}, "etag")).toBeUndefined();
  });
});
