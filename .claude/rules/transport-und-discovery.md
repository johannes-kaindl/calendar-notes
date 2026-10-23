---
paths:
  - "src/core/dav/**"
  - "src/obsidian/transport.ts"
  - "src/core/settings.ts"
  - "src/obsidian/settings-tab.ts"
  - "fixtures/radicale/**"
  - "tests/fixtures/vcard/**"
  - "tests/core/dav/**"
  - "tests/integration/**"
---

# Transport, Discovery und Sammlungen — Gotchas

## Transport: `requestUrl` folgt Weiterleitungen selbst

- **`DavResponse` trägt keine finale URL und kann sie nicht tragen** — Obsidians `requestUrl` gibt sie nicht her. Wer eine Zieladresse braucht, liest sie deshalb aus der **Antwort** (`<d:href>` des Multistatus nennt die tatsächlich beantwortete Ressource), niemals aus der Anfrage-URL: der Redirect-Zweig in `wellKnown()` (`src/core/dav/discovery.ts`) wird mit diesem Transport nie betreten. Bis 0.1.6 wurde `/.well-known/caldav/` weiterverwendet — bei Nextcloud eine andere Route, die über `/index.php/…` in **405** endet. Fakes in Tests müssen beide Transport-Sorten abbilden (folgend **und** nicht folgend), sonst testen sie den anderen Fall.
- **Reale Kette messen** (die einzige Probe, die den echten Transport abdeckt): `discover()` mit einem redirect-folgenden `fetch`-Transport per `npx tsx` gegen einen echten Server fahren — dauert eine halbe Minute (Lesson 2026-08-25 in `oneiron:LESSONS.md`).

## Sammlungen: der Ressourcentyp sagt nicht, was drin sein darf

- **Eine Collection kann `<c:calendar/>` melden und trotzdem keine Termine annehmen** — Server führen `VEVENT` und `VTODO` in getrennten Sammlungen (bei mailbox.org der Normalfall). Die Antwort steht in `supported-calendar-component-set`, und dieselbe Sorte Frage stellt sich zweimal daneben: `current-user-privilege-set` (ein Kalender kann read-only sein, obwohl er wie jeder andere aussieht) und Schedule-Inbox/-Outbox, die als Geschwister im selben Home-Set erscheinen und keine Kalender sind. **Alle drei auswerten, keine aus dem Ressourcentyp ableiten** — `collectionFromResponse()` (`src/core/dav/discovery.ts`) tut das.
- **Erheben allein genügt nicht:** `components` wurde von Anfang an gelesen und bis 2026-08-29 **nirgends benutzt** — der Merge in `settings-tab.ts` ließ das Feld fallen, und eine Aufgaben-Sammlung war danach von einem Kalender nicht mehr zu unterscheiden. `collectionSupports(col, kind)` (`src/core/settings.ts`, löste `holdsEvents()` ab) beantwortet die Frage für Sync **und** Einstellungen aus einer Quelle; sie liegt bewusst dort und nicht im Sync, weil eine wortlos übersprungene Sammlung schlimmer ist als eine, die gar nicht erst einschaltbar aussieht. Die Prüfung hängt an der **Paarung** aus Sammlung und Profil, nicht an der Sammlung allein: mailbox.org führt VEVENT und VTODO in getrennten Sammlungen, die beide `kind === "calendar"` sind.
- **Grundregel für alle drei Eigenschaften: fehlt die Angabe, wird nichts angenommen** (Radicale liefert sie nicht zwingend).
- **Eine leere Sammlung antwortet regulär mit selbstschließendem `<D:multistatus/>`,** `fast-xml-parser` macht daraus einen leeren **String**, und eine Wurzelknoten-Prüfung `!ms || typeof ms !== "object"` hält das für eine fehlende Wurzel (0.1.9; betraf ausschließlich neue Nutzer, jede leere Sammlung beim Ersteinrichten). Gefunden wurde es erst, **nachdem die Fehlermeldung diagnostizierbar gemacht wurde** (sie stand wortgleich an sieben Aufrufstellen und nannte weder Anfrage noch Antwort).
- **Fixture-Ausnahme:** `fixtures/radicale/collections/collection-root/test/kontakte/c3-1.vcf` weicht im PHOTO-Padding bewusst von `tests/fixtures/vcard/v3-full.vcf` ab — Radicale/vobject verlangt gültiges Base64-Padding; nicht angleichen.
