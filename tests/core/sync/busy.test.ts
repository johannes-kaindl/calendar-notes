import { describe, it, expect } from "vitest";
import { createBusyGuard } from "../../../src/core/sync/busy";

describe("createBusyGuard", () => {
  it("startet frei", () => {
    const g = createBusyGuard();
    expect(g.isBusy()).toBe(false);
  });

  it("tryAcquire belegt den Guard und liefert true", () => {
    const g = createBusyGuard();
    expect(g.tryAcquire()).toBe(true);
    expect(g.isBusy()).toBe(true);
  });

  it("ein zweites tryAcquire waehrend belegt liefert false", () => {
    const g = createBusyGuard();
    g.tryAcquire();
    expect(g.tryAcquire()).toBe(false);
    expect(g.isBusy()).toBe(true);
  });

  it("release gibt frei, danach ist tryAcquire wieder erfolgreich", () => {
    const g = createBusyGuard();
    g.tryAcquire();
    g.release();
    expect(g.isBusy()).toBe(false);
    expect(g.tryAcquire()).toBe(true);
  });

  it("release ohne vorheriges tryAcquire ist ein No-Op", () => {
    const g = createBusyGuard();
    expect(() => g.release()).not.toThrow();
    expect(g.isBusy()).toBe(false);
  });
});
