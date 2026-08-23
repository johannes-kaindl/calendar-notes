# Plugin-API v1

`calendar-notes` (CalDAV/CardDAV → Notizen, Server = SSOT) bietet anderen Obsidian-Plugins
eine schmale, versionierte API an — Lese-Zugriff auf Termine/Kontakte, Kommandos als
LLM-Tool-Definitionen, ein zweistufiges Plan/Execute für Schreibvorgänge und einen
Registrierungspunkt für Mail-Transporte (RFC 6047 iMIP). Implementierung: `src/obsidian/api.ts`
(`createPluginApi`), Typen: `src/core/api/types.ts` (pure, kein Obsidian-Import).

Muster: `vault-rag/src/plugin_api.ts` (Anbieter-Seite), `koda-agent/src/obsidian/retrieval.ts`
(Konsumenten-Seite), Dach-`REGISTRY.md` § „Plugin-zu-Plugin".

## Zugriff

```ts
const cn = app.plugins.plugins["calendar-notes"]?.api;
if (cn?.version === 1) {
  const events = await cn.events({ from: "2026-09-01", to: "2026-09-30" });
}
```

## Konsumenten-Regeln (verbindlich für jeden Aufrufer)

1. **Bei jedem Aufruf frisch lesen, nie beim Laden cachen.** `calendar-notes` kann zur
   Laufzeit deaktiviert werden — der Zugriff über `app.plugins.plugins[...]` ist nur ein
   Objekt-Lookup, kein teurer Vorgang.
2. **`version` prüfen, bevor du dich auf die Form verlässt.** `version: 1` erhöht sich bei
   jeder brechenden Änderung. Ein Konsument, der eine andere Version sieht, behandelt die
   API als nicht vorhanden statt zu raten.
3. **Typen kopieren statt importieren, mit Herkunftsstempel.** `calendar-notes` und der
   konsumierende Plugin sind zwei eigenständige Store-Repos (kein Monorepo) — kein
   Build-Coupling über TypeScript-Importe. Die Versionsnummer ist der vereinbarte Ersatz
   für den Compiler.
4. **`{ error }` prüfen, nie auf einen Wurf hoffen.** Jede Methode fängt intern und liefert
   `{ error: string }` statt eine Ausnahme mitten in deinem eigenen Lauf zu werfen. `error`
   ist ein rohes, unübersetztes Diagnosewort.
5. **Die API öffnet nie ein Modal.** Bestätigung eines Schreibvorgangs liegt beim Aufrufer —
   ein Konsument mit Mensch danebensitzend (z. B. Koda) bestätigt je Schreibvorgang selbst;
   ein unbeaufsichtigter Konsument (z. B. eine `vault-crews`-Crew) darf nur schema-validiert
   `plan()` + `execute()` verwenden, nie ungeprüfte Eingaben durchreichen.

## Lesen

```ts
events(q?: { from?: string; to?: string; collectionId?: string }): Promise<ApiEvent[] | ApiError>
contacts(q?: { query?: string; collectionId?: string }): Promise<ApiContact[] | ApiError>
get(ref: { uid: string; source?: string }): Promise<ApiEvent | ApiContact | null | ApiError>
```

- `ApiEvent = { uid, source, collectionId, path?, data: EventData }`,
  `ApiContact = { uid, source, collectionId, path?, data: ContactData }` — `data` ist die
  bereits geparste ical.js-/vCard-Struktur (`src/core/ical/event.ts` / `src/core/vcard/contact.ts`),
  `path` fehlt nur, solange (noch) keine Master-Notiz existiert.
- `events()` filtert nur Sammlungen, deren Profil `kind: "event"` ist; `from`/`to` sind
  ISO-Strings und werden als einfacher String-Vergleich gegen `EventData.start` angewendet
  (kein Zeitzonen-Normalisieren — für die meisten Fälle ausreichend, bei gemischten
  Zeitzonen/floating-Zeiten mit Vorsicht zu genießen).
- `contacts()` filtert per Teilstring-Suche (case-insensitive) über `fn` und alle
  `emails[].value`.
- `get()` sucht über `uid` (+ optional `source` zur Eingrenzung) über alle Sammlungen;
  `null` ist ein regulärer „nichts gefunden"-Wert, kein `ApiError`.

## Kommandos / Tool-Calling

```ts
commands(): { id, kind, title, description, schema }[]
tools(): { name, description, parameters }[]
```

`tools()` ist `toolDefinitions()` aus der Kommando-Registry — `name` ersetzt Punkte durch
Unterstriche (`event.set-title` → `event_set-title`, Bindestriche bleiben), `parameters`
ist dasselbe Mini-JSON-Schema wie `commands()[i].schema` (flache Untermenge von JSON Schema,
tool-calling-tauglich). Die Registry ist mit einem eingebauten Kommando-Satz vorbefüllt
(`ensureDefaultCommands()`, `src/core/commands/registry.ts` — idempotent, läuft sowohl in
`main.ts::onload()` als auch defensiv beim Bau der API selbst): alle `event.*`/`contact.*`-
Kommandos plus `undo.last` (stellt den letzten Verlaufseintrag des Zielobjekts wieder her,
`kind: "any"` — wirkt auf Termine UND Kontakte, `appliesTo` prüft nur, ob überhaupt ein
Verlauf vorliegt).

## Schreiben: `plan()` → `execute()`

```ts
plan(commandId: string, input: Record<string, unknown>, target: { uid: string; source: string } | { new: true; collectionId: string }): Promise<ApiPlan | ApiError>
execute(plan: ApiPlan): Promise<ApiExecuteResult | ApiError>
```

`plan()` schreibt NICHTS — sie prüft die Eingabe zuerst gegen `descriptor.schema`
(`validateInput()`, `src/core/commands/schema.ts`; ein Verstoß kommt als `{ error: "validation:
<Meldungen>" }` zurück, BEVOR irgendein Ziel aufgelöst wird), löst dann das Ziel im
Collection-State auf (ohne Notiz-Frontmatter, die API hat keine „aktive Notiz") und baut den
`CommandContext`. `ApiPlan` ist ein serialisierbarer `CommandPlan` (Zusammenfassung, Diff,
neuer Rohtext, Ziel-Etag) plus — falls der Plan eine Einladung auslöst — `inviteRoute`
(`"server" | "transport" | "ics"`), damit ein Konsument VOR `execute()` weiß, ob eine E-Mail
verschickt würde.

`execute()` führt den Plan gegen den Server aus (PUT/DELETE mit `If-Match`/`If-None-Match`)
und synct das Objekt gezielt zurück. Bei Erfolg **und** einer Einladung im Plan:
- `route: "server"` — der DAV-Server verschickt selbst (RFC 6638 schedule-outbox), nichts zu tun.
- `route: "transport"` — ein registrierter `MailTransport` (s. u.) verschickt; `delivered`
  zeigt, ob `send()` erfolgreich war.
- `route: "ics"` — **die API öffnet nie das `.ics`-Modal**: der fertige iMIP-Text kommt im
  Feld `ics` zurück, der Aufrufer entscheidet selbst, was er damit tut (anzeigen, speichern,
  weiterreichen).

**Wann genau `"ics"` gewählt wird** (`InviteRouter.route()`, `src/obsidian/invite.ts` —
async seit Fix-Runde 1, Punkt 2): der Server hat KEINEN `scheduling.outbox` **UND** entweder
ist KEIN `MailTransport` registriert **ODER** kein registrierter Transport meldet über
`accounts()` mindestens eine Absender-Identität. Ein Transport ohne Identitäten (z. B.
mailstone ohne konfiguriertes Postfach) zählt also NICHT als „Transport verfügbar" — vorher
genügte allein die Registrierung, `deliver()` scheiterte dann live mit
„keine Absender-Konten". Ein werfender `accounts()`-Aufruf blockiert die Routen-Wahl
ebenfalls nicht (naechster Transport bzw. Fallback `ics`). Beim Transport-Weg selbst wählt
die API (anders als das UI-Modal) die ERSTE verfügbare Identität automatisch — kein Mensch
da, der wählen könnte.

Fehler laufen über den `ExecuteResult`-Vertrag von `core/sync/execute.ts` (`{ ok: false,
conflict: true, freshEtag? }` bei einem 412-Konflikt, `{ ok: false, conflict: false, error:
ExecuteErrorCode }` sonst) — ein unerwarteter Wurf (z. B. State-Store kaputt) wird zusätzlich
zu `{ error: string }` (`ApiError`).

### Beispiel: Koda (Tool-Calling, Mensch bestätigt)

```ts
const tools = cn.tools();               // ins System-Prompt / Tool-Register
// … LLM waehlt ein Tool + Argumente …
const plan = await cn.plan("event.move", { start: "2026-09-01T14:00" }, { uid, source });
if ("error" in plan) { /* melden, abbrechen */ }
// Mensch sieht plan.summary/plan.diff und bestaetigt …
const result = await cn.execute(plan);
if ("error" in result || !result.ok) { /* melden */ }
```

### Beispiel: eine Crew (`vault-crews`, unbeaufsichtigt, schema-validiert)

Ein Crew-Step, dessen `write_scope`/`allowed_actions` `calendar-notes`-Kommandos erlaubt, ruft
`plan()` + `execute()` mit bereits schema-validierten Argumenten — nie mit einem freien
Modell-Output ungeprüft durchgereicht.

## Mail-Transport (mailstone-Vertrag)

```ts
registerMailTransport(t: MailTransport): { ok: true } | ApiError
unregisterMailTransport(id: string): void
```

`mailstone` registriert sich bei `calendar-notes`, nicht umgekehrt — `calendar-notes` kennt
keine Plugin-ID von mailstone:

```ts
const cn = app.plugins.plugins["calendar-notes"]?.api;
if (cn?.version === 1) cn.registerMailTransport(transport);
// beim Entladen:
cn?.unregisterMailTransport(transport.id);
```

```ts
interface MailTransport {
  id: string;
  label: string;
  accounts(): Promise<{ id: string; address: string; label: string }[]>;
  send(msg: ImipMessage): Promise<{ ok: true; messageId?: string } | { ok: false; error: string }>;
}
interface ImipMessage {                 // RFC 6047
  method: "REQUEST" | "CANCEL" | "REPLY";
  from: string;                         // Account-ID aus accounts()
  to: string[];
  subject: string;
  text: string;
  ics: string;                          // vollstaendiges VCALENDAR mit METHOD:<method>
}
```

`registerMailTransport` validiert die Form defensiv (fremder Aufrufer, kein TS-Vertrauen) —
ein unvollständiges Objekt kommt als `{ error: "invalid-mail-transport" }` zurück, ohne
registriert zu werden. Details/Kontext: `../mailstone/docs/2026-08-22-anforderungen-aus-calendar-notes.md`.

`MailTransport` hat GENAU EINE Deklaration (`src/core/api/types.ts`, pure) — `src/obsidian/
invite.ts` und `src/obsidian/plugin-host.ts` importieren sie von dort (Fix-Runde 1, Punkt 4;
vorher trug `invite.ts` eine eigenständige Kopie, die auseinanderdriften konnte).

## Events

```ts
on(event: "synced", cb: (e: { collectionId: string; counts: {...} }) => void): () => void
on(event: "changed", cb: (e: { path: string; op: string; uid: string }) => void): () => void
```

- `synced` — einmal je Sammlungs-Ergebnis eines Sync-Laufs (Trockenlauf inklusive), mit den
  Zählern (`created`/`updated`/`skipped`/`archived`/`deleted`/`errors`) aus diesem Lauf.
- `changed` — je tatsächlich ausgeführtem Notiz-Plan: sowohl aus einem regulären Sync-Lauf
  als auch aus dem gezielten Resync nach einem Kommando (`executeCommandPlan`).
- Beide geben eine `unsubscribe()`-Funktion zurück. Es gibt keinen `off()` — abbestellen
  über den Rückgabewert von `on()`.
- Ein werfender Listener wird geschluckt (`src/core/sync/events.ts::createEmitter`,
  Fix-Runde 1, Punkt 1) — ein kaputter Callback in DEINEM Plugin stoppt weder `emit()` selbst
  noch (unabhängig davon nochmal abgesichert) den Sync-/Kommando-Lauf, der ihn ausgelöst hat.

## Fehlerformat

Jede Methode ist entweder `Promise<T | ApiError>` oder gibt synchron `T | ApiError` zurück,
nie eine Ausnahme. `ApiError = { error: string }`. Ausnahme: `get()` liefert zusätzlich
`null` als regulären „nichts gefunden"-Wert (kein Fehler).

## Versionierung

`version: 1` ist Teil jeder Antwort/des API-Objekts. Eine brechende Änderung (Feld entfernt/
umbenannt, Fehlerform geändert, ein Aufruf öffnet neu doch ein Modal) erhöht die Zahl; ein
altes `version === 1`-Objekt bleibt für bereits ausgelieferte Plugin-Versionen unverändert
erreichbar, solange `calendar-notes` beide Formen anbietet — oder die Major-Version wird
angehoben und alte Konsumenten sehen `version !== 1` und behandeln die API als fehlend.

Intern kommt der Wert aus `CALENDAR_NOTES_API_VERSION` (`src/core/api/types.ts`) — `src/
obsidian/api.ts` setzt `version` darüber, kein Literal `1` (Fix-Runde 1, Punkt 3): eine
künftige Versionserhöhung ändert genau EINE Konstante.
