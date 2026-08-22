import { describe, it, expect } from "vitest";
import { getObject, putObject, deleteObject, headEtag } from "../../../src/core/dav/client";
import { fakeTransport } from "../../helpers/fake-transport";

const H = "https://dav.example/test/kalender/a.ics";
describe("client", () => {
  it("getObject liefert etag+data", async () => {
    const t = fakeTransport([{ method: "GET", url: H, status: 200, headers: { ETag: '"e1"' }, text: "BEGIN:VCALENDAR" }]);
    expect(await getObject(t, H)).toEqual({ href: H, etag: '"e1"', data: "BEGIN:VCALENDAR" });
  });
  it("getObject wirft DavError bei 404", async () => {
    await expect(getObject(fakeTransport([]), H)).rejects.toMatchObject({ status: 404 });
  });
  it("putObject If-Match: ok mit neuem etag; 412 → conflict", async () => {
    let hdr: Record<string, string> | undefined;
    const ok = fakeTransport([{ method: "PUT", url: H, status: 204, headers: { etag: '"e2"' }, capture: (r) => { hdr = r.headers; } }]);
    expect(await putObject(ok, H, "X", { ifMatch: '"e1"' }, "text/calendar")).toEqual({ ok: true, etag: '"e2"' });
    expect(hdr).toMatchObject({ "If-Match": '"e1"', "Content-Type": "text/calendar; charset=utf-8" });
    const conflict = fakeTransport([{ method: "PUT", url: H, status: 412 }]);
    expect(await putObject(conflict, H, "X", { ifMatch: '"e1"' }, "text/calendar")).toEqual({ ok: false, conflict: true, status: 412 });
  });
  it("putObject If-None-Match für Neuanlage; fehlender etag → null", async () => {
    let hdr: Record<string, string> | undefined;
    const t = fakeTransport([{ method: "PUT", url: H, status: 201, capture: (r) => { hdr = r.headers; } }]);
    expect(await putObject(t, H, "X", { ifNoneMatch: true }, "text/vcard")).toEqual({ ok: true, etag: null });
    expect(hdr?.["If-None-Match"]).toBe("*");
  });
  it("putObject sonstiger Fehler", async () => {
    const t = fakeTransport([{ method: "PUT", url: H, status: 403, text: "nope" }]);
    expect(await putObject(t, H, "X", { ifMatch: '"e1"' }, "text/calendar")).toMatchObject({ ok: false, conflict: false, status: 403 });
  });
  it("deleteObject: 204 ok, 404 ok, 412 conflict", async () => {
    expect(await deleteObject(fakeTransport([{ method: "DELETE", url: H, status: 204 }]), H, '"e1"')).toEqual({ ok: true, etag: null });
    expect(await deleteObject(fakeTransport([]), H, '"e1"')).toEqual({ ok: true, etag: null });
    expect(await deleteObject(fakeTransport([{ method: "DELETE", url: H, status: 412 }]), H, '"e1"')).toEqual({ ok: false, conflict: true, status: 412 });
  });
  it("headEtag", async () => {
    expect(await headEtag(fakeTransport([{ method: "GET", url: H, status: 200, headers: { ETag: '"e9"' } }]), H)).toBe('"e9"');
    expect(await headEtag(fakeTransport([]), H)).toBeUndefined();
  });
});
