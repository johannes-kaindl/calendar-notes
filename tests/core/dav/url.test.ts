import { describe, it, expect } from "vitest";
import { resolveHref, ensureTrailingSlash, hrefPath } from "../../../src/core/dav/url";

describe("resolveHref", () => {
  it("keeps absolute hrefs", () => {
    expect(resolveHref("https://a.example/dav/", "https://b.example/x/")).toBe("https://b.example/x/");
  });
  it("resolves root-relative against origin", () => {
    expect(resolveHref("https://a.example/dav/u/", "/remote.php/dav/cal/")).toBe("https://a.example/remote.php/dav/cal/");
  });
  it("resolves relative against base dir", () => {
    expect(resolveHref("https://a.example/dav/u/", "kal/")).toBe("https://a.example/dav/u/kal/");
  });
  it("keeps percent-encoding intact", () => {
    expect(resolveHref("https://a.example/", "/dav/u%40x.de/")).toBe("https://a.example/dav/u%40x.de/");
  });
});
describe("ensureTrailingSlash / hrefPath", () => {
  it("adds slash once", () => {
    expect(ensureTrailingSlash("https://a.example/x")).toBe("https://a.example/x/");
    expect(ensureTrailingSlash("https://a.example/x/")).toBe("https://a.example/x/");
  });
  it("extracts path", () => {
    expect(hrefPath("https://a.example/dav/u/k/1.ics")).toBe("/dav/u/k/1.ics");
  });
});
