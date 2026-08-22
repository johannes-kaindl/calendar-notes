# DAV-Erhebung — was das Plugin `calendar-notes` von der mailbox.org-Einrichtung braucht

**Datum:** 2026-08-22 · **Von:** calendar-notes-Session (Brainstorming-Phase) · **An:** mailbox-org-Session (Teilprojekte ① und ④)
**Ablage der Antworten:** hier daneben in `docs/dav/befunde/<server>.md` (ein File je Server: `mailbox-org.md`, später `nextcloud-gruene.md`).
**Zugangsdaten gehören NICHT in diese Dateien** — nur URLs, Antwortstrukturen, Fähigkeiten.

## Design-Entscheidungen, die schon feststehen (damit ihr nichts doppelt entscheidet)

- Ein Plugin für CalDAV **und** CardDAV, server-agnostisch (RFC 4791 / 6352 / 6578). Ziel-Server: mailbox.org (OX App Suite) **und** Nextcloud — nichts Anbieterspezifisches einbacken.
- **Server ist SSOT, Notiz ist Spiegel.** Schreiben passiert nur über explizite Kommandos (`PUT` mit `If-Match: <ETag>`), nie durch Editieren der Notiz. Kein bidirektionaler Merge.
- WebDAV-Dateien (Remotely Save), IMAP und VTODO/Aufgaben (TaskNotes) sind **außerhalb**.
- Transport ausschließlich `requestUrl` (mobile-fähig, CORS-frei). Store-Bauart gemessen: Basic-Auth + Netzwerk + Notizen schreiben erreicht `Passed` (Belege: harang-contacts, nextcloud-tasks, powerdesk).

## Was wir je Server erhoben haben wollen

Alles read-only erhebbar, nichts davon verändert den Account. `curl -u user:pass` reicht; Passwort bitte nicht in Dateien/Logs.

### A. Discovery-Kette (die muss das Plugin generisch laufen können)
1. `PROPFIND /.well-known/caldav` und `/.well-known/carddav` — antwortet der Server mit Redirect (301/302 → wohin) oder direkt?
2. `PROPFIND <root>` Depth 0 mit `DAV:current-user-principal` → Principal-URL.
3. `PROPFIND <principal>` → `calendar-home-set` (CalDAV) bzw. `addressbook-home-set` (CardDAV).
4. `PROPFIND <home-set>` Depth 1 → Liste der Kalender/Adressbücher mit `displayname`, `resourcetype`, `supported-calendar-component-set` (VEVENT/VTODO/VJOURNAL?), `calendar-color`, `getctag`, `sync-token`, `current-user-privilege-set` (lesen/schreiben?).
   → Bitte die **rohen XML-Antworten** (gekürzt, anonymisiert) ablegen — Namespaces und Prefixe unterscheiden sich je Server, und genau daran scheitern Parser.

### B. Sync-Fähigkeiten
5. Unterstützt der Server **`sync-collection` REPORT (RFC 6578)** mit `sync-token`? Oder nur CTag + ETag-Vergleich? (Entscheidet über den Abgleich-Algorithmus.)
6. `calendar-query` REPORT mit `time-range`-Filter: funktioniert er, und **expandiert** der Server Wiederholungstermine (`<C:expand>`) oder liefert er nur den Master mit RRULE?
7. `addressbook-multiget` / `calendar-multiget`: funktioniert Batch-Abruf per `href`-Liste?
8. Liefert der Server bei `PUT` ein `ETag` zurück, oder muss man danach erneut `PROPFIND`en?

### C. Schreiben & Scheduling (für die spätere Kommando-Schicht)
9. **CalDAV-Scheduling (RFC 6638):** hat der Principal `schedule-outbox-URL` / `schedule-inbox-URL` und `calendar-user-address-set`? Wenn ja, verschickt der **Server** Einladungen (iTIP/iMIP) selbst, sobald ein VEVENT mit `ATTENDEE` gePUTtet wird — dann muss das Plugin nie Mail versenden. Das ist die Schlüsselfrage für „Teilnehmer:innen einladen“.
10. Wie verhält sich der Server bei `PUT` mit veraltetem `If-Match` — 412 Precondition Failed?

### D. Konto & Auth
11. **App-Passwörter** trotz 2FA: gibt es sie bei mailbox.org für DAV, oder gilt das Hauptpasswort? (Bei Nextcloud: App-Passwörter unter Sicherheit — bitte eins nur für den Plugin-Test anlegen.)
12. Rate-Limits / Auffälligkeiten bei vielen PROPFINDs kurz hintereinander?

### E. Beispiel-Payloads (anonymisiert)
13. Je ein echtes `VEVENT` (einmalig, wiederkehrend mit EXDATE, ganztägig, mit ATTENDEE/ORGANIZER) und `VCARD` (Version 3.0 oder 4.0? — mailbox.org und Nextcloud unterscheiden sich hier; mit PHOTO? mit mehreren TEL/EMAIL mit TYPE-Parametern) so, wie der Server sie **ausliefert** — nicht wie ein Client sie schreibt.

## Nextcloud-Gegenprobe
Beruflicher Account `https://nextcloud.ad.gruene-bayern.de` — Discovery und Lesen sind unkritisch; **für Schreibtests dort zuerst einen eigenen Test-Kalender und ein Test-Adressbuch anlegen**, niemals in die echten Sammlungen schreiben. Das kann auch die calendar-notes-Session später selbst erheben; hier nur, falls es nebenbei anfällt.

## Warum das hier steht und nicht im mailbox-org-Repo
Eure Spec nennt `calendar-notes/` als Plugin-Spur und Ablage für DAV-Erkenntnisse (§ 9, Teilprojekt ④ Schritt 6). Das ist der Leseort beider Seiten.
