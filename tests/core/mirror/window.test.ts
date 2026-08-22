import { describe, it, expect } from "vitest";
import { windowFor, toDavTimeRange } from "../../../src/core/mirror/window";
describe("window", () => {
  it("computes start/end at day bounds (UTC)", () => {
    const w = windowFor(new Date("2026-08-22T15:30:00Z"), 90, 365);
    expect(w.start.toISOString()).toBe("2026-05-24T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2027-08-22T23:59:59.000Z");
  });
  it("toDavTimeRange", () => {
    expect(toDavTimeRange({ start: new Date("2026-05-24T00:00:00Z"), end: new Date("2027-08-22T23:59:59Z") })).toEqual({ start: "20260524T000000Z", end: "20270822T235959Z" });
  });
});
