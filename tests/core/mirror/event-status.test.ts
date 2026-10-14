import { describe, it, expect } from "vitest";
import { planUpsert } from "../../../src/core/mirror/plan";
import { defaultEventProfile, validateProfile, type MappingProfile } from "../../../src/core/mirror/profile";
import { eventStatusValue, nextEventStatus } from "../../../src/core/mirror/event-status";

const MAP = { confirmed: "geplant", tentative: "geplant", cancelled: "abgesagt" };
const prof = (over: Partial<MappingProfile> = {}): MappingProfile => {
  const d = defaultEventProfile();
  return { ...d, fields: { ...d.fields, status: "status" }, onCreate: { type: "📅 Termin", status: "geplant" }, eventStatusMap: MAP, ...over };
};
const base = (status: string | null) => ({ profile: prof(), source: "acc/kal", uid: "u1", etag: '"e1"', values: { title: "Zahnarzt", status }, block: "", path: "Termine/Zahnarzt.md" });
const existing = (status: string) => ({ path: "Termine/Zahnarzt.md", frontmatter: { dav_uid: "u1", dav_source: "acc/kal", dav_etag: '"e0"', dav_state: "live", title: "Zahnarzt", status }, body: "" });

describe("eventStatusValue / nextEventStatus", () => {
  it("maps the three RFC 5545 values; missing STATUS counts as confirmed", () => {
    expect(eventStatusValue(MAP, "CONFIRMED")).toBe("geplant");
    expect(eventStatusValue(MAP, "TENTATIVE")).toBe("geplant");
    expect(eventStatusValue(MAP, "CANCELLED")).toBe("abgesagt");
    expect(eventStatusValue(MAP, null)).toBe("geplant");
  });
  it("cancel wins; un-cancel only resets a note that still carries the cancelled word", () => {
    expect(nextEventStatus(MAP, "CANCELLED", "abgeschlossen")).toBe("abgesagt");
    expect(nextEventStatus(MAP, "CONFIRMED", "abgesagt")).toBe("geplant");
    expect(nextEventStatus(MAP, "CONFIRMED", "abgeschlossen")).toBeUndefined();
    expect(nextEventStatus(MAP, "CANCELLED", "abgesagt")).toBeUndefined();
  });
});

describe("planUpsert mit eventStatusMap", () => {
  it("create: server CANCELLED schreibt das Vokabel statt des rohen Werts", () => {
    const pl = planUpsert(base("CANCELLED"));
    if (pl.op !== "create") throw new Error(pl.op);
    expect(pl.frontmatter["status"]).toBe("abgesagt");
    expect(pl.written).not.toHaveProperty("status");
  });
  it("create: CONFIRMED -> geplant", () => {
    const pl = planUpsert(base("CONFIRMED"));
    if (pl.op !== "create") throw new Error(pl.op);
    expect(pl.frontmatter["status"]).toBe("geplant");
  });
  it("update: abgesagter Termin auf dem Server -> abgesagt, auch wenn der Nutzer weitergeschaltet hatte", () => {
    const pl = planUpsert({ ...base("CANCELLED"), existing: existing("in-arbeit") });
    if (pl.op !== "update") throw new Error(pl.op);
    expect(pl.set["status"]).toBe("abgesagt");
  });
  it("update: der Nutzerwert bleibt, solange der Server nicht abgesagt hat (Gegenprobe zur Ueberschreibung)", () => {
    const pl = planUpsert({ ...base("CONFIRMED"), existing: existing("abgeschlossen") });
    expect(pl.op).toBe("update"); // etag ist anders
    if (pl.op !== "update") return;
    expect(pl.set).not.toHaveProperty("status");
    expect(pl.handEdited).toEqual([]);
  });
  it("update: Absage zurueckgenommen -> geplant", () => {
    const pl = planUpsert({ ...base("CONFIRMED"), existing: existing("abgesagt") });
    if (pl.op !== "update") throw new Error(pl.op);
    expect(pl.set["status"]).toBe("geplant");
  });
  it("ohne eventStatusMap bleibt der rohe Serverwert (bisheriges Verhalten)", () => {
    const d = defaultEventProfile();
    const pl = planUpsert({ ...base("CANCELLED"), profile: d, values: { title: "Zahnarzt", status: "CANCELLED" } });
    if (pl.op !== "create") throw new Error(pl.op);
    expect(pl.frontmatter["event_status"]).toBe("CANCELLED");
  });
});

describe("validateProfile eventStatusMap", () => {
  it("round-trips a complete map for events", () => {
    const r = validateProfile(prof());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.eventStatusMap).toEqual(MAP);
  });
  it("rejects an incomplete map", () => {
    const r = validateProfile(prof({ eventStatusMap: { confirmed: "geplant", tentative: "geplant" } as never }));
    expect(r.ok).toBe(false);
  });
  it("rejects the map on a non-event profile", () => {
    const r = validateProfile({ ...prof(), kind: "contact" });
    expect(r.ok).toBe(false);
  });
});
