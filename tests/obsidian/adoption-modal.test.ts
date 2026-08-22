import { describe, it, expect } from "vitest";
import { collectDecisions, defaultAction } from "../../src/obsidian/adoption-modal";
import type { AdoptionSuggestion, CandidateNote, ServerItem } from "../../src/core/adopt/match";
import { parseContact } from "../../src/core/vcard/contact";

const vcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c3-1@test\r\nFN:Florian Brandes\r\nEND:VCARD\r\n`;

function makeItem(): ServerItem {
  const data = parseContact(vcf);
  return { uid: data.uid, href: "/dav/c1.vcf", kind: "contact", data, raw: vcf, etag: '"e1"' };
}
function makeNote(): CandidateNote {
  return { path: "Contacts/Florian Brandes.md", basename: "Florian Brandes", frontmatter: {}, body: "" };
}
function suggestion(confidence: AdoptionSuggestion["confidence"]): AdoptionSuggestion {
  return { item: makeItem(), note: makeNote(), reason: "name", confidence, detail: "0.9" };
}

describe("defaultAction", () => {
  it("defaults to link for sure matches", () => {
    expect(defaultAction("sure")).toBe("link");
  });
  it("defaults to link for likely matches", () => {
    expect(defaultAction("likely")).toBe("link");
  });
  it("defaults to skip for weak matches", () => {
    expect(defaultAction("weak")).toBe("skip");
  });
});

describe("collectDecisions", () => {
  it("zips suggestions with the chosen action per row", () => {
    const suggestions = [suggestion("sure"), suggestion("weak")];
    const decisions = collectDecisions(suggestions, ["create", "link"]);
    expect(decisions).toEqual([
      { suggestion: suggestions[0], action: "create" },
      { suggestion: suggestions[1], action: "link" },
    ]);
  });

  it("falls back to defaultAction(confidence) when chosen is shorter than suggestions", () => {
    const suggestions = [suggestion("sure"), suggestion("weak")];
    const decisions = collectDecisions(suggestions, []);
    expect(decisions.map((d) => d.action)).toEqual(["link", "skip"]);
  });
});
