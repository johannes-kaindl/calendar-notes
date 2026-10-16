import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BLOCK_BEGIN, BLOCK_END, BrokenZoneError, renderContactBlock, renderEventBlock, splitBody, mergeBody, userContent } from "../../../src/core/mirror/body";
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
describe("beschaedigte Zone und Marker im Inhalt (code-kit marker-zone)", () => {
  it("BEGIN ohne END: mergeBody verweigert, haengt keine zweite Zone an und laesst den Text unangetastet", () => {
    const body = `# T\n\n${BLOCK_BEGIN}\nalt\n\nMein Text unter dem verwaisten BEGIN\n`;
    expect(() => mergeBody(body, "neu", "block")).toThrow(BrokenZoneError);
    expect(() => mergeBody(body, "", "block")).toThrow(BrokenZoneError);
    expect(mergeBody(body, "neu", "none")).toBe(body);
  });
  it("userContent einer beschaedigten Zone ist der ganze Text (nie leer, damit planRemoval nicht in den Papierkorb legt)", () => {
    expect(userContent(`${BLOCK_BEGIN}\nMein Text\n`)).toBe(`${BLOCK_BEGIN}\nMein Text`);
  });
  it("ein BEGIN, das der Nutzer vor der Zone zitiert, wird nicht als Zonenanfang gelesen: verweigert", () => {
    const body = `Zitat: ${BLOCK_BEGIN}\n\n${wrap("alt")}\n`;
    expect(() => mergeBody(body, "neu", "block")).toThrow(BrokenZoneError);
  });
  it("END-Marker in der Serverbeschreibung bricht die Zone nicht auf: drei Syncs, kein Wachstum, Text nach der Zone bleibt", () => {
    const e = parseEvents(fx("ical", "simple.ics").replace("SUMMARY:", `DESCRIPTION:vorher ${BLOCK_END} danach\nSUMMARY:`))[0]!;
    const block = renderEventBlock(e);
    expect(block).toContain("danach");
    const m1 = mergeBody("# T\n\nmeine Notiz unten\n", block, "block");
    const m2 = mergeBody(m1, block, "block");
    const m3 = mergeBody(m2, block, "block");
    expect(m2).toBe(m1);
    expect(m3).toBe(m1);
    expect(m1).toContain("danach");
    expect(m1.match(/%% dav:end %%/g)).toHaveLength(1);
    expect(userContent(m1)).toBe("# T\n\nmeine Notiz unten");
  });
  it("BEGIN-Marker in der Serverbeschreibung wird ebenso entschaerft", () => {
    const m = mergeBody("", `a ${BLOCK_BEGIN} b`, "block");
    expect(m.match(/%% dav:begin %%/g)).toHaveLength(1);
    expect(mergeBody(m, `a ${BLOCK_BEGIN} b`, "block")).toBe(m);
  });
  it("CRLF-Notiz: Zone wird mit CRLF ersetzt, derselbe Block aendert nichts, der Text ausserhalb bleibt byte-gleich", () => {
    const crlf = (x: string) => x.replace(/\n/g, "\r\n");
    const body = crlf(`# T\n\n${wrap("alt\nzeile")}\n\nfrei\n`);
    expect(mergeBody(body, "alt\nzeile", "block")).toBe(body);
    expect(mergeBody(body, "neu\nzwei", "block")).toBe(crlf(`# T\n\n${wrap("neu\nzwei")}\n\nfrei\n`));
    expect(mergeBody(crlf("Meine Notiz\n"), "B", "block")).toBe(crlf(`Meine Notiz\n\n${wrap("B")}\n`));
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
