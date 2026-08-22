import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BLOCK_BEGIN, BLOCK_END, renderContactBlock, renderEventBlock, splitBody, mergeBody, userContent } from "../../../src/core/mirror/body";
import { parseContact } from "../../../src/core/vcard/contact";
import { parseEvents } from "../../../src/core/ical/event";
const fx = (d: string, n: string) => readFileSync(new URL(`../../fixtures/${d}/${n}`, import.meta.url), "utf8");
const wrap = (inner: string) => `${BLOCK_BEGIN}\n${inner}\n${BLOCK_END}`;

describe("splitBody", () => {
  it("no markers", () => { expect(splitBody("hallo\n")).toEqual({ before: "hallo\n", block: null, after: "" }); });
  it("markers in the middle", () => {
    const b = `# Titel\n\n${wrap("inhalt\nzeile2")}\n\nmeine notizen\n`;
    expect(splitBody(b)).toEqual({ before: "# Titel\n\n", block: "inhalt\nzeile2", after: "\n\nmeine notizen\n" });
  });
  it("only first pair is managed", () => {
    const b = `${wrap("a")}\n${wrap("b")}`;
    expect(splitBody(b).block).toBe("a");
    expect(splitBody(b).after).toBe(`\n${wrap("b")}`);
  });
});
describe("mergeBody", () => {
  it("none → unchanged", () => { expect(mergeBody("x", "neu", "none")).toBe("x"); });
  it("append when missing", () => {
    expect(mergeBody("Meine Notiz\n", "B", "block")).toBe(`Meine Notiz\n\n${wrap("B")}\n`);
    expect(mergeBody("", "B", "block")).toBe(`${wrap("B")}\n`);
  });
  it("replace when present, preserving outside", () => {
    const before = `# T\n\n${wrap("alt")}\n\nfrei\n`;
    expect(mergeBody(before, "neu", "block")).toBe(`# T\n\n${wrap("neu")}\n\nfrei\n`);
  });
  it("empty block removes existing block, keeps user text", () => {
    expect(mergeBody(`# T\n\n${wrap("alt")}\n\nfrei\n`, "", "block")).toBe("# T\n\nfrei\n");
    expect(mergeBody("nur text\n", "", "block")).toBe("nur text\n");
  });
  it("empty block removal collapses newlines only at the seam, never over the whole user text", () => {
    const before = `a\n\n\n\n\nb\n\n${wrap("x")}`;
    expect(mergeBody(before, "", "block")).toBe("a\n\n\n\n\nb\n");
  });
  it("idempotent", () => {
    const once = mergeBody("x\n", "B", "block");
    expect(mergeBody(once, "B", "block")).toBe(once);
  });
});
describe("userContent", () => {
  it("ignores the block", () => {
    expect(userContent(`\n${wrap("x")}\n`)).toBe("");
    expect(userContent(`hallo\n${wrap("x")}\n`)).toBe("hallo");
  });
});
describe("render", () => {
  it("contact block lists note, typed channels, address, url, photo", () => {
    const b = renderContactBlock(parseContact(fx("vcard", "v3-full.vcf")));
    expect(b).toContain("Blutbild nur vormittags, Karte mitbringen");
    expect(b).toContain("praxis@example.test");
    expect(b).toContain("+49 821 555 0");
    expect(b).toContain("Marktplatz 1");
    expect(b).toContain("https://mvz.example.test");
    expect(b).toContain("Foto");
    expect(b).not.toContain("/9j/");              // nie Base64 in die Notiz
  });
  it("empty contact → empty block", () => {
    expect(renderContactBlock({ uid: "u", version: "3.0", fn: "X", emails: [], tels: [], urls: [], adrs: [], categories: [] })).toBe("");
  });
  it("event block: description, attendees with partstat, organizer, link", () => {
    const [e] = parseEvents(fx("ical", "attendees.ics"));
    const b = renderEventBlock(e!);
    expect(b).toContain("Alex Aguado <alex@example.test> · ACCEPTED");
    expect(b).toContain("sam@example.test · NEEDS-ACTION");
    expect(b).toContain("Jay Kaindl <mail@jkaindl.de>");
    const [s] = parseEvents(fx("ical", "simple.ics"));
    expect(renderEventBlock(s!)).toContain("Kontrolle\nBitte Karte mitbringen");
    expect(renderEventBlock(s!)).toContain("https://example.test/termin");
  });
});
