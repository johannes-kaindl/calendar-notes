import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyContactMutation, newContactVcf } from "../../../src/core/vcard/mutate";
import { parseContact } from "../../../src/core/vcard/contact";

const fx = (n: string) => readFileSync(new URL(`../../fixtures/vcard/${n}`, import.meta.url), "utf8");
const NOW = { now: new Date("2026-08-22T12:00:00Z") };

describe("applyContactMutation", () => {
  it("fn/org/title/note/bday; erhält X-Props und VERSION; setzt REV", () => {
    let v = applyContactMutation(fx("v3-full.vcf"), { kind: "fn", fn: "Florian Brandes" }, NOW);
    v = applyContactMutation(v, { kind: "org", org: ["Neue Praxis"] }, NOW);
    v = applyContactMutation(v, { kind: "title", title: null }, NOW);
    v = applyContactMutation(v, { kind: "bday", bday: "1975-04-13" }, NOW);
    expect(v).toContain("X-SOCIALPROFILE");
    const c = parseContact(v);
    expect(c).toMatchObject({ version: "3.0", fn: "Florian Brandes", org: ["Neue Praxis"], bday: "1975-04-13", rev: "2026-08-22T12:00:00Z" });
    expect(c.title).toBeUndefined();
  });
  it("setEmail index/new, removeEmail, setTel", () => {
    let v = applyContactMutation(fx("v3-full.vcf"), { kind: "setEmail", index: 1, value: "neu@example.test" }, NOW);
    v = applyContactMutation(v, { kind: "setEmail", index: "new", value: "dritte@example.test", types: ["work"] }, NOW);
    v = applyContactMutation(v, { kind: "removeEmail", index: 0 }, NOW);
    v = applyContactMutation(v, { kind: "setTel", index: 0, value: "+49 170 0000000", types: ["cell"] }, NOW);
    const c = parseContact(v);
    expect(c.emails.map((e) => e.value)).toEqual(["neu@example.test", "dritte@example.test"]);
    expect(c.emails[0]!.types).toEqual(["home"]);       // Typen bleiben, wenn nicht übergeben
    expect(c.tels[0]).toMatchObject({ value: "+49 170 0000000", types: ["cell"] });
  });
  it("v4 bleibt v4, tel als tel:-uri geschrieben", () => {
    const v = applyContactMutation(fx("v4-min.vcf"), { kind: "setTel", index: "new", value: "+49 1", types: ["work"] }, NOW);
    expect(v).toContain("VERSION:4.0");
    expect(parseContact(v).tels.map((t) => t.value)).toEqual(["+34696386907", "+49 1"]);
  });
});
describe("newContactVcf", () => {
  it("v3 default, parsbar", () => {
    const v = newContactVcf({ uid: "n@cn", fn: "Kim Test", n: { family: "Test", given: "Kim" }, email: "kim@example.test", tel: "+49 2", org: "Orga" }, NOW);
    const c = parseContact(v);
    expect(c).toMatchObject({ version: "3.0", uid: "n@cn", fn: "Kim Test", org: ["Orga"] });
    expect(c.emails[0]!.value).toBe("kim@example.test");
    expect(c.n).toEqual({ family: "Test", given: "Kim" });
  });
});
