import { describe, it, expect, vi } from "vitest";
import { createToolProvider, type ToolProviderHost } from "../../../src/core/api/tool-provider";
import { isToolProviderApi, toolProviderRejection, TOOL_PROVIDER_API_VERSION } from "../../../src/vendor/kit/tool-provider";
import type { ApiContact, ApiEvent, ApiPlan } from "../../../src/core/api/types";

const ev = (uid: string, start: string, summary: string): ApiEvent => ({ uid, source: "acc/kal", collectionId: "c1", path: `Events/${summary}.md`, data: { uid, summary, start, allDay: false, exdates: [], attendees: [], categories: [], sequence: 0 } });
const contact: ApiContact = { uid: "k1", source: "acc/adr", collectionId: "c2", data: { uid: "k1", version: "3.0", fn: "Kim Test", emails: [{ value: "kim@example.test", types: [], pref: false }], tels: [], urls: [], adrs: [], categories: [] } };
const plan = (over: Partial<ApiPlan> = {}): ApiPlan => ({ commandId: "event.move", target: { kind: "event", source: "acc/kal", href: "/h", uid: "e1" }, summary: "Event moved", summaryKey: "k", summaryArgs: [], diff: [], newRaw: "", contentType: "text/calendar", hrefForPut: "/h", createsNew: false, ...over });

function host(over: Partial<ToolProviderHost> = {}): ToolProviderHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    events: async () => [ev("e2", "2026-09-02T10:00", "Zweiter"), ev("e1", "2026-09-01T10:00", "Erster")],
    contacts: async () => [contact],
    get: async () => contact,
    plan: async (id) => { calls.push(`plan:${id}`); return plan({ commandId: id }); },
    execute: async () => { calls.push("execute"); return { ok: true }; },
    previewPaths: async () => ["Events/Erster.md"],
    ...over,
  };
}

describe("tool-provider — Vertrag", () => {
  it("erfuellt den Kit-Guard: sechs Werkzeuge, jedes mit writes, Version aus dem Kit", () => {
    const p = createToolProvider(host());
    const api = { version: TOOL_PROVIDER_API_VERSION, tools: p.tools, executeTool: p.executeTool };
    expect(isToolProviderApi(api)).toBe(true);
    expect(toolProviderRejection(api)).toBeNull();
    const defs = p.tools({ lang: "de" });
    expect(defs.map((d) => `${d.name}${d.writes ? "!" : ""}`)).toEqual(["list_events", "list_contacts", "get_item", "create_event!", "move_event!", "update_contact!"]);
    expect(defs[0]!.description).toMatch(/Termine/);
    expect(createToolProvider(host()).tools({ lang: "en" })[0]!.description).toMatch(/events/i);
  });
  it("jedes Ziel steht in den Parametern (uid+source bzw. collectionId), nicht nur im Plan", () => {
    const byName = Object.fromEntries(createToolProvider(host()).tools({ lang: "en" }).map((d) => [d.name, d.parameters as { required?: string[] }]));
    expect(byName["move_event"]!.required).toEqual(expect.arrayContaining(["uid", "source"]));
    expect(byName["update_contact"]!.required).toEqual(expect.arrayContaining(["uid", "source"]));
    expect(byName["create_event"]!.required).toContain("collectionId");
  });
});

describe("tool-provider — Lesen", () => {
  it("list_events sortiert nach Beginn und nennt uid, source, collectionId", async () => {
    const r = await createToolProvider(host()).executeTool("list_events", {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.content.split("\n");
    expect(lines[0]).toContain("Erster");
    expect(lines[0]).toContain("uid: e1 | source: acc/kal | collectionId: c1");
  });
  it("get_item ohne uid ist bad-args mit Feld; unbekannter Name ist unknown-tool", async () => {
    const p = createToolProvider(host());
    expect(await p.executeTool("get_item", {})).toMatchObject({ ok: false, reason: "bad-args", field: "uid" });
    expect(await p.executeTool("nope", {})).toMatchObject({ ok: false, reason: "unknown-tool" });
  });
  it("ein ApiError des Wirts wird failed, nie ein Wurf", async () => {
    const p = createToolProvider(host({ events: async () => ({ error: "boom" }) }));
    expect(await p.executeTool("list_events", {})).toEqual({ ok: false, reason: "failed", message: "boom" });
  });
});

describe("tool-provider — Schreiben (plan → confirm → execute)", () => {
  it("ohne confirm: needs-confirm, es wird NICHT ausgefuehrt", async () => {
    const h = host();
    const r = await createToolProvider(h).executeTool("move_event", { uid: "e1", source: "acc/kal", start: "2026-09-03T09:00" });
    expect(r).toMatchObject({ ok: false, reason: "needs-confirm" });
    expect(h.calls).not.toContain("execute");
  });
  it("confirm false: needs-confirm, nichts ausgefuehrt", async () => {
    const h = host();
    const confirm = vi.fn(async () => false);
    const r = await createToolProvider(h).executeTool("move_event", { uid: "e1", source: "acc/kal", start: "2026-09-03T09:00" }, { confirm });
    expect(r).toMatchObject({ ok: false, reason: "needs-confirm" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.calls).not.toContain("execute");
  });
  it("confirm true: genau ein confirm VOR execute, mit summary, paths und outside; Ergebnis ok", async () => {
    const h = host();
    const order: string[] = [];
    const confirm = vi.fn(async (pv: { summary: string; paths: string[]; outside?: string[] }) => { order.push("confirm"); h.calls.push("confirm"); expect(pv.paths).toEqual(["Events/Erster.md"]); expect(pv.outside?.[0]).toMatch(/update/); return true; });
    const r = await createToolProvider(h).executeTool("move_event", { uid: "e1", source: "acc/kal", start: "2026-09-03T09:00" }, { confirm });
    expect(r.ok).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.calls).toEqual(["plan:event.move", "confirm", "execute"]);
  });
  it("create_event plant event.create mit {new, collectionId}", async () => {
    const seen: unknown[] = [];
    const h = host({ plan: async (id, input, target) => { seen.push(id, input, target); return plan({ commandId: id, createsNew: true }); } });
    await createToolProvider(h).executeTool("create_event", { collectionId: "c1", title: "Neu", start: "2026-09-05", allDay: true }, { confirm: async () => true });
    expect(seen).toEqual(["event.create", { title: "Neu", start: "2026-09-05", allDay: true }, { new: true, collectionId: "c1" }]);
  });
  it("ein Konflikt (412) wird failed mit Hinweis, ein Plan-Fehler 'validation:' bad-args", async () => {
    const conflict = host({ execute: async () => ({ ok: false, conflict: true }) });
    expect(await createToolProvider(conflict).executeTool("move_event", { uid: "e1", source: "s", start: "x" }, { confirm: async () => true })).toMatchObject({ ok: false, reason: "failed" });
    const invalid = host({ plan: async () => ({ error: "validation: start: required" }) });
    expect(await createToolProvider(invalid).executeTool("move_event", { uid: "e1", source: "s", start: "x" }, { confirm: async () => true })).toMatchObject({ ok: false, reason: "bad-args" });
  });
  it("update_contact: field wird auf das Kommando abgebildet; E-Mail ersetzt den ersten Eintrag", async () => {
    const seen: [string, Record<string, unknown>][] = [];
    const h = host({ plan: async (id, input) => { seen.push([id, input]); return plan({ commandId: id }); } });
    const p = createToolProvider(h);
    await p.executeTool("update_contact", { uid: "k1", source: "acc/adr", field: "email", value: "neu@example.test" }, { confirm: async () => true });
    await p.executeTool("update_contact", { uid: "k1", source: "acc/adr", field: "org", value: "A, B" }, { confirm: async () => true });
    expect(seen).toEqual([["contact.set-email", { value: "neu@example.test", index: "0" }], ["contact.set-org", { org: ["A", "B"] }]]);
    expect(await p.executeTool("update_contact", { uid: "k1", source: "s", field: "shoe", value: "x" })).toMatchObject({ ok: false, reason: "bad-args", field: "field" });
  });
});
