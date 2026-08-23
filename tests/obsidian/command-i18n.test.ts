import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tr, trTitle, trDescription, trFieldDescription, trPlan, trSchema } from "../../src/obsidian/command-i18n";
import { DE, EN, initI18n } from "../../src/i18n/strings";
import { EVENT_COMMANDS } from "../../src/core/commands/event-commands";
import { CONTACT_COMMANDS } from "../../src/core/commands/contact-commands";
import { UNDO_LAST_COMMAND, planUndoLast } from "../../src/core/commands/undo";
import { planPushHandEdits } from "../../src/core/commands/push-hand-edits";
import { defaultContactProfile, defaultEventProfile } from "../../src/core/mirror/profile";
import type { Account, CollectionConfig } from "../../src/core/settings";
import type { CommandContext, CommandDescriptor, CommandPlan, CommandTarget } from "../../src/core/commands/types";

const FIXTURES = join(__dirname, "../fixtures");
const read = (rel: string): string => readFileSync(join(FIXTURES, rel), "utf8");

const ACCOUNT: Account = { id: "a1", name: "Acc", baseUrl: "https://dav.example/", username: "jay@example.test", secretId: "s1" };
const EVENT_COL: CollectionConfig = { id: "c1", accountId: "a1", href: "https://dav.example/cal/", kind: "calendar", displayName: "Cal", enabled: true, profileId: "default-event", readOnly: false };
const CONTACT_COL: CollectionConfig = { id: "ab1", accountId: "a1", href: "https://dav.example/ab/", kind: "addressbook", displayName: "AB", enabled: true, profileId: "default-contact", readOnly: false };
const NOW = new Date("2026-08-22T10:00:00Z");

function eventCtx(raw: string, target: CommandTarget, overrides: Partial<CommandContext> = {}): CommandContext {
  return { now: NOW, profile: defaultEventProfile(), collection: EVENT_COL, account: ACCOUNT, target, raw, etag: "\"e1\"", rand: () => 0.42, ...overrides };
}
function contactCtx(raw: string, target: CommandTarget, overrides: Partial<CommandContext> = {}): CommandContext {
  return { now: NOW, profile: defaultContactProfile(), collection: CONTACT_COL, account: ACCOUNT, target, raw, etag: "\"e1\"", rand: () => 0.42, ...overrides };
}

const EXISTING_EVENT_TARGET: CommandTarget = { kind: "event", source: "a1/c1", href: "https://dav.example/cal/simple.ics", uid: "simple-1@test" };
const ATTENDEE_EVENT_TARGET: CommandTarget = { kind: "event", source: "a1/c1", href: "https://dav.example/cal/attendees.ics", uid: "att-1@test" };
const NEW_EVENT_TARGET: CommandTarget = { kind: "event", source: "a1/c1", new: true };
const EXISTING_CONTACT_TARGET: CommandTarget = { kind: "contact", source: "a1/ab1", href: "https://dav.example/ab/v3-full.vcf", uid: "c3-1@test" };
const NEW_CONTACT_TARGET: CommandTarget = { kind: "contact", source: "a1/ab1", new: true };

function findCmd(all: CommandDescriptor[], id: string): CommandDescriptor {
  const d = all.find((c) => c.id === id);
  if (!d) throw new Error(`Kommando ${id} nicht gefunden`);
  return d;
}

const ALL_COMMANDS: CommandDescriptor[] = [...EVENT_COMMANDS, ...CONTACT_COMMANDS, UNDO_LAST_COMMAND];

/** Ein Plan je konkretem Aufruf — deckt beide Formulierungs-Varianten ab (`.changed`/
 *  `.removed`) bei Kommandos, die je nach Eingabe strukturell unterschiedlich formulieren. */
function realPlans(): CommandPlan[] {
  const plans: CommandPlan[] = [];
  const simple = eventCtx(read("ical/simple.ics"), EXISTING_EVENT_TARGET);
  const attendees = eventCtx(read("ical/attendees.ics"), ATTENDEE_EVENT_TARGET);
  const contact = contactCtx(read("vcard/v3-full.vcf"), EXISTING_CONTACT_TARGET);

  plans.push(findCmd(EVENT_COMMANDS, "event.move").plan({ start: "2026-09-02T14:00", end: "2026-09-02T15:30" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-title").plan({ title: "Neuer Titel" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-location").plan({ location: "Büro" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-location").plan({ location: "" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-url").plan({ url: "https://x.test" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-url").plan({ url: "" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-description").plan({ description: "Text" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-description").plan({ description: "" }, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.add-attendee").plan({ email: "neu@example.test" }, attendees));
  plans.push(findCmd(EVENT_COMMANDS, "event.remove-attendee").plan({ email: "sam@example.test" }, attendees));
  plans.push(findCmd(EVENT_COMMANDS, "event.set-partstat").plan({ partstat: "ACCEPTED" }, { ...attendees, scheduling: { addresses: ["sam@example.test"] } }));
  plans.push(findCmd(EVENT_COMMANDS, "event.delete").plan({}, simple));
  plans.push(findCmd(EVENT_COMMANDS, "event.create").plan({ title: "Kickoff", start: "2026-09-10T09:00" }, eventCtx(undefined as unknown as string, NEW_EVENT_TARGET)));

  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-name").plan({ fn: "Neuer Name" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-email").plan({ index: "0", value: "x@example.test" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.remove-email").plan({ index: 0 }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-phone").plan({ index: "0", value: "+49 1" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.remove-phone").plan({ index: 0 }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-org").plan({ org: ["A", "B"] }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-org").plan({ org: [] }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-title").plan({ title: "Arzt" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-title").plan({ title: "" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-note").plan({ note: "Text" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-note").plan({ note: "" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-birthday").plan({ bday: "1980-01-01" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.set-birthday").plan({ bday: "" }, contact));
  plans.push(findCmd(CONTACT_COMMANDS, "contact.create").plan({ fn: "Neuer Kontakt" }, contactCtx(undefined as unknown as string, NEW_CONTACT_TARGET)));

  const history = [{ etag: "\"e0\"", raw: read("ical/simple.ics"), at: "2026-08-20T09:00:00Z" }];
  const undoPlan = planUndoLast(simple, history);
  if (!undoPlan) throw new Error("undo.last: kein Plan");
  plans.push(undoPlan);

  const pushEvent = planPushHandEdits(simple, { title: "Anders" }, { title: "Zahnärztin Dr. Müller" });
  if (!pushEvent.plan) throw new Error("push-hand-edits (event): kein Plan");
  plans.push(pushEvent.plan);
  const pushContact = planPushHandEdits(contact, { title: "Anders" }, { title: "Hausarzt" });
  if (!pushContact.plan) throw new Error("push-hand-edits (contact): kein Plan");
  plans.push(pushContact.plan);

  return plans;
}

describe("Kommando-Deskriptoren: titleKey/descriptionKey/Feld-descriptionKey in DE UND EN", () => {
  it("jeder titleKey/descriptionKey des realen Kommando-Satzes hat einen Eintrag in beiden Woerterbuechern", () => {
    for (const d of ALL_COMMANDS) {
      expect(EN[d.titleKey], `EN[${d.titleKey}] (${d.id})`).toBeDefined();
      expect(DE[d.titleKey], `DE[${d.titleKey}] (${d.id})`).toBeDefined();
      expect(EN[d.descriptionKey], `EN[${d.descriptionKey}] (${d.id})`).toBeDefined();
      expect(DE[d.descriptionKey], `DE[${d.descriptionKey}] (${d.id})`).toBeDefined();
    }
  });

  it("jeder Feld-descriptionKey des realen Kommando-Satzes hat einen Eintrag in beiden Woerterbuechern", () => {
    for (const d of ALL_COMMANDS) {
      for (const [name, field] of Object.entries(d.schema.properties)) {
        if (!field.descriptionKey) continue;
        expect(EN[field.descriptionKey], `EN[${field.descriptionKey}] (${d.id}.${name})`).toBeDefined();
        expect(DE[field.descriptionKey], `DE[${field.descriptionKey}] (${d.id}.${name})`).toBeDefined();
      }
    }
  });
});

describe("Plan-Zusammenfassungen: summaryKey in DE UND EN", () => {
  it("jeder summaryKey, den der reale Kommando-Satz tatsaechlich erzeugt (inkl. .changed/.removed-Varianten), hat einen Eintrag in beiden Woerterbuechern", () => {
    const plans = realPlans();
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(EN[p.summaryKey], `EN[${p.summaryKey}] (${p.commandId})`).toBeDefined();
      expect(DE[p.summaryKey], `DE[${p.summaryKey}] (${p.commandId})`).toBeDefined();
    }
  });
});

describe("command-i18n: tr()/trTitle()/trDescription()/trPlan()/trFieldDescription()/trSchema()", () => {
  afterEach(() => {
    initI18n(null); // zurueck auf Englisch (Default)
  });

  it("tr() liefert den uebersetzten Text in der aktiven Sprache", () => {
    const d = findCmd(EVENT_COMMANDS, "event.move");
    initI18n("en");
    expect(tr(d)).toEqual({ title: "Move event", description: "Change the start/end time of an event" });
    initI18n("de");
    expect(tr(d)).toEqual({ title: "Termin verschieben", description: "Start-/Endzeit eines Termins ändern" });
  });

  it("trTitle()/trDescription() folgen derselben Sprachumschaltung", () => {
    const d = findCmd(CONTACT_COMMANDS, "contact.create");
    initI18n("de");
    expect(trTitle(d)).toBe("Kontakt anlegen");
    expect(trDescription(d)).toBe("Neuen Kontakt in der Ziel-Collection anlegen");
  });

  it("faellt bei einem Key, der in KEINEM Woerterbuch steht, auf den englischen Fallback-Text zurueck (Fremdplugin-Deskriptor ohne eigene i18n-Eintraege)", () => {
    const foreign: CommandDescriptor = {
      id: "foreign.thing", kind: "event",
      title: "Foreign fallback title", titleKey: "foreign.thing.title.does-not-exist",
      description: "Foreign fallback description", descriptionKey: "foreign.thing.desc.does-not-exist",
      schema: { type: "object", properties: {} },
      appliesTo: () => true,
      plan: () => { throw new Error("unused"); },
    };
    initI18n("de");
    expect(tr(foreign)).toEqual({ title: "Foreign fallback title", description: "Foreign fallback description" });
  });

  it("trFieldDescription(): uebersetzt mit descriptionKey, gibt den (englischen) description-Fallback ohne Key unveraendert zurueck, undefined bleibt undefined", () => {
    const d = findCmd(EVENT_COMMANDS, "event.move");
    const start = d.schema.properties["start"];
    if (!start) throw new Error("start-Feld fehlt");
    initI18n("de");
    expect(trFieldDescription(start)).toBe("neuer Start (ISO)");

    initI18n("de");
    expect(trFieldDescription({ type: "boolean" })).toBeUndefined();
    expect(trFieldDescription({ type: "string", description: "raw fallback" })).toBe("raw fallback");
  });

  it("trSchema(): uebersetzte Kopie — jede Feld-description ersetzt, restliches Schema unveraendert", () => {
    const d = findCmd(EVENT_COMMANDS, "event.move");
    initI18n("de");
    const translated = trSchema(d.schema);
    expect(translated.properties["start"]?.description).toBe("neuer Start (ISO)");
    expect(translated.properties["end"]?.description).toBe("neues Ende (ISO)");
    expect(translated.required).toEqual(d.schema.required);
    // Original bleibt unangetastet (keine Mutation).
    expect(d.schema.properties["start"]?.description).toBe("new start (ISO)");
  });

  it("trPlan(): uebersetzt summary mit summaryArgs, faellt bei unbekanntem Key auf plan.summary zurueck", () => {
    const simple = eventCtx(read("ical/simple.ics"), EXISTING_EVENT_TARGET);
    const plan = findCmd(EVENT_COMMANDS, "event.set-title").plan({ title: "Neuer Titel" }, simple);
    initI18n("en");
    expect(trPlan(plan)).toBe('Title changed: "Neuer Titel"');
    initI18n("de");
    expect(trPlan(plan)).toBe('Titel geändert: "Neuer Titel"');

    const unknownPlan: CommandPlan = { ...plan, summaryKey: "does.not.exist", summary: "raw fallback summary" };
    expect(trPlan(unknownPlan)).toBe("raw fallback summary");
  });
});
