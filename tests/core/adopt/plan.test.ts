import { describe, it, expect } from "vitest";
import { defaultContactProfile } from "../../../src/core/mirror/profile";
import { emptyState } from "../../../src/core/state/collection-state";
import { planAdoption, stateAfterAdoption, type AdoptDecision } from "../../../src/core/adopt/plan";
import type { AdoptionSuggestion, CandidateNote, ServerItem } from "../../../src/core/adopt/match";
import { parseContact } from "../../../src/core/vcard/contact";

const vcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nUID:c3-1@test\r\nFN:Florian Brandes\r\nEMAIL:praxis@example.test\r\nEND:VCARD\r\n`;

function makeItem(uid = "c3-1@test", href = "https://a.example/dav/contacts/c1.vcf", etag = '"e1"'): ServerItem {
  const data = parseContact(vcf.replace("c3-1@test", uid));
  return { uid, href, kind: "contact", data, raw: "RAW", etag };
}
function makeNote(path = "Contacts/Florian Brandes.md"): CandidateNote {
  return { path, basename: "Florian Brandes", frontmatter: {}, body: "" };
}
function makeSuggestion(item: ServerItem, note: CandidateNote): AdoptionSuggestion {
  return { item, note, reason: "email", confidence: "sure", detail: "praxis@example.test" };
}

describe("planAdoption", () => {
  const profile = defaultContactProfile();

  it("builds a LinkPlan with the profile's identity keys for a 'link' decision", () => {
    const item = makeItem();
    const note = makeNote();
    const decisions: AdoptDecision[] = [{ suggestion: makeSuggestion(item, note), action: "link" }];
    const { links, createUids, skippedUids } = planAdoption(decisions, profile, "acct/col1");
    expect(links).toHaveLength(1);
    expect(links[0]?.path).toBe(note.path);
    expect(links[0]?.set).toEqual({
      dav_uid: "c3-1@test",
      dav_source: "acct/col1",
      dav_etag: '"e1"',
      dav_state: "live",
    });
    expect(createUids).toHaveLength(0);
    expect(skippedUids).toHaveLength(0);
  });

  it("routes 'create' decisions into createUids and 'skip' into skippedUids", () => {
    const linkItem = makeItem("c-link@test", "https://a.example/dav/c-link.vcf");
    const createItem = makeItem("c-create@test", "https://a.example/dav/c-create.vcf");
    const skipItem = makeItem("c-skip@test", "https://a.example/dav/c-skip.vcf");
    const decisions: AdoptDecision[] = [
      { suggestion: makeSuggestion(linkItem, makeNote("Contacts/Link.md")), action: "link" },
      { suggestion: makeSuggestion(createItem, makeNote("Contacts/Create.md")), action: "create" },
      { suggestion: makeSuggestion(skipItem, makeNote("Contacts/Skip.md")), action: "skip" },
    ];
    const { links, createUids, skippedUids } = planAdoption(decisions, profile, "acct/col1");
    expect(links.map((l) => l.path)).toEqual(["Contacts/Link.md"]);
    expect(createUids).toEqual(["c-create@test"]);
    expect(skippedUids).toEqual(["c-skip@test"]);
  });

  it("respects a custom uid/source/etag/state field naming", () => {
    const custom = { ...profile, uidField: "vcard_uid", sourceField: "vcard_source", etagField: "vcard_etag", stateField: "vcard_state" };
    const item = makeItem();
    const decisions: AdoptDecision[] = [{ suggestion: makeSuggestion(item, makeNote()), action: "link" }];
    const { links } = planAdoption(decisions, custom, "acct/col1");
    expect(links[0]?.set).toEqual({ vcard_uid: "c3-1@test", vcard_source: "acct/col1", vcard_etag: '"e1"', vcard_state: "live" });
  });
});

describe("stateAfterAdoption", () => {
  const profile = defaultContactProfile();

  it("writes notes[''].path for each linked item and keeps the existing snapshot", () => {
    const item = makeItem();
    const note = makeNote();
    const decisions: AdoptDecision[] = [{ suggestion: makeSuggestion(item, note), action: "link" }];
    const { links } = planAdoption(decisions, profile, "acct/col1");
    const before = { ...emptyState("acct/col1"), snapshot: { ctag: "ctag-1", etags: { "/dav/contacts/c1.vcf": '"e0"' } } };
    const now = new Date("2026-08-22T10:00:00Z");
    const after = stateAfterAdoption(before, links, [item], now);
    const key = "/dav/contacts/c1.vcf";
    expect(after.objects[key]?.uid).toBe("c3-1@test");
    expect(after.objects[key]?.etag).toBe('"e1"');
    expect(after.objects[key]?.raw).toBe("RAW");
    expect(after.objects[key]?.notes[""]?.path).toBe(note.path);
    expect(after.objects[key]?.notes[""]?.written).toEqual({});
    expect(after.objects[key]?.notes[""]?.hash).toBe("");
    expect(after.snapshot).toEqual({ ctag: "ctag-1", etags: { "/dav/contacts/c1.vcf": '"e0"' } });
  });

  it("handles multiple links against multiple items", () => {
    const item1 = makeItem("c1@test", "https://a.example/dav/c1.vcf");
    const item2 = makeItem("c2@test", "https://a.example/dav/c2.vcf");
    const decisions: AdoptDecision[] = [
      { suggestion: makeSuggestion(item1, makeNote("Contacts/One.md")), action: "link" },
      { suggestion: makeSuggestion(item2, makeNote("Contacts/Two.md")), action: "link" },
    ];
    const { links } = planAdoption(decisions, profile, "acct/col1");
    const after = stateAfterAdoption(emptyState("acct/col1"), links, [item1, item2], new Date("2026-08-22T10:00:00Z"));
    expect(after.objects["/dav/c1.vcf"]?.notes[""]?.path).toBe("Contacts/One.md");
    expect(after.objects["/dav/c2.vcf"]?.notes[""]?.path).toBe("Contacts/Two.md");
  });

  it("leaves the state unchanged when no matching item is found for a link", () => {
    const item = makeItem();
    const decisions: AdoptDecision[] = [{ suggestion: makeSuggestion(item, makeNote()), action: "link" }];
    const { links } = planAdoption(decisions, profile, "acct/col1");
    const before = emptyState("acct/col1");
    const after = stateAfterAdoption(before, links, [], new Date("2026-08-22T10:00:00Z"));
    expect(after.objects).toEqual({});
  });
});
