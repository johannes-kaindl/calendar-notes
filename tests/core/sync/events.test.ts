import { describe, it, expect } from "vitest";
import { createEmitter } from "../../../src/core/sync/events";

interface Events extends Record<string, unknown> {
  ping: { n: number };
}

describe("createEmitter", () => {
  it("ruft alle registrierten Listener mit dem Payload auf", () => {
    const emitter = createEmitter<Events>();
    const calls: number[] = [];
    emitter.on("ping", (e) => calls.push(e.n));
    emitter.on("ping", (e) => calls.push(e.n * 10));
    emitter.emit("ping", { n: 1 });
    expect(calls).toEqual([1, 10]);
  });

  it("unsubscribe entfernt genau diesen Listener", () => {
    const emitter = createEmitter<Events>();
    const calls: number[] = [];
    const off = emitter.on("ping", (e) => calls.push(e.n));
    off();
    emitter.emit("ping", { n: 1 });
    expect(calls).toEqual([]);
  });

  it("ein werfender Listener stoppt emit() nicht und laesst nachfolgende Listener laufen (Fix-Runde 1, Punkt 1)", () => {
    const emitter = createEmitter<Events>();
    const calls: number[] = [];
    emitter.on("ping", () => {
      throw new Error("kaputter Listener");
    });
    emitter.on("ping", (e) => calls.push(e.n));
    expect(() => emitter.emit("ping", { n: 42 })).not.toThrow();
    expect(calls).toEqual([42]);
  });

  it("emit() auf ein Event ohne Listener ist ein No-op", () => {
    const emitter = createEmitter<Events>();
    expect(() => emitter.emit("ping", { n: 1 })).not.toThrow();
  });
});
