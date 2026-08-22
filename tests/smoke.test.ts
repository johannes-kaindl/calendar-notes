import { describe, it, expect } from "vitest";
import { withTimeout } from "../src/vendor/code-kit/timeout";

describe("scaffold", () => {
  it("vendored kit module is importable", async () => {
    const timers = {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
    };
    const r = await withTimeout(Promise.resolve(1), 50, timers);
    expect(r).toEqual({ timedOut: false, value: 1 });
  });
});
