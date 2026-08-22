import { describe, it, expect } from "vitest";
import { initI18n } from "../../src/i18n/strings";
import { describeExecuteError } from "../../src/obsidian/execute-i18n";
import type { ExecuteErrorCode } from "../../src/core/sync/execute";

initI18n("en");

const CODES: ExecuteErrorCode[] = ["collection-not-found", "account-not-found", "profile-not-found", "no-secret", "busy", "transport-error"];

describe("describeExecuteError", () => {
  it.each(CODES)("uebersetzt %s in einen nicht-leeren, vom Code abweichenden Text", (code) => {
    const text = describeExecuteError(code);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe(`execute.error.${code}`);
  });
});
