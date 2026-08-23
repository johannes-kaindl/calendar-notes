Ablageort für die mailbox-org-Session: diese Datei — nicht das Repo-Root.

# mailbox.org DAV-Endpunkte

**Status:** Materialsammlung, kein Bau begonnen · **Angelegt:** 2026-08-22 ·
**Auslöser:** Teilprojekt ① des mailbox.org-Setups (Projekt 26-060)

## Für die künftige Session: lies das zuerst

Dieses Dokument sammelt, was beim Einrichten von mailbox.org über CalDAV und CardDAV
gemessen wurde. Es ist **kein Plugin-Konzept** — die Entscheidung, ob überhaupt gebaut
wird, ist bewusst **nicht** getroffen.

**Vor jeder Arbeit hier:** den Stand der Vault-Doku lesen —
`10_Pallas/60_Bereiche/30_System/mailbox-org/Technische-Referenz.md`.
Dort steht die kanonische Fassung, hier nur die Roh-Beobachtungen.

**Leitsatz aus dem Setup-Design:** erst nutzen, dann bauen. Wie die DAV-Anbindung im Alltag
tatsächlich verwendet wird, steht erst nach Teilprojekt ④ fest.

## Gemessene Endpunkte (ohne Authentifizierung, 2026-08-22)

Rohdaten: `40_Tools/mailbox-org/rohdaten/2026-08-22_2022/dav-*.txt`,
reproduzierbar mit `40_Tools/mailbox-org/skripte/endpunkte.sh`.

| Zweck | URL | Antwort ohne Auth |
|---|---|---|
| Basis | `https://dav.mailbox.org/` | `401` — lebt, verlangt Authentifizierung |
| CalDAV Discovery | `https://dav.mailbox.org/.well-known/caldav` | `301` → `https://dav.mailbox.org/caldav/` |
| CardDAV Discovery | `https://dav.mailbox.org/.well-known/carddav` | `301` → `https://dav.mailbox.org/carddav/` |

Die Well-Known-Discovery nach RFC 6764 funktioniert regelkonform — ein Client braucht nur
`dav.mailbox.org` als Serveradresse.

TLS-Zertifikat: `CN=*.mailbox.org`, Thawte TLS RSA CA G1, gültig bis 02.12.2026.

## Offene Fragen vor einem Plugin-Bau

1. Welches Auth-Verfahren akzeptiert `dav.mailbox.org` — Basic mit App-Passwort, oder OAuth?
   (Der IMAP-Endpunkt kann `OAUTHBEARER` und `XOAUTH2`; ob DAV das auch anbietet, ist ungeprüft.)
2. Wie sehen die Collection-URLs nach dem Login konkret aus?
3. Liefert der Server ETags und ein brauchbares CTag-Verhalten für inkrementellen Sync?
4. Wie verhält sich Obsidian Mobile bei DAV-Requests — CORS, verfügbare Netzwerk-API?
5. Gibt es Rate-Limits?

Die Fragen 1–3 lassen sich beantworten, sobald in Teilprojekt ④ ein App-Passwort existiert.

---
## Antworten aus calendar-notes (2026-08-22, M1 abgeschlossen)
- Zu Frage 4 (Mobile/CORS): gelöst — der Plugin-Transport ist Obsidians `requestUrl` (kein CORS, läuft auf Desktop und Mobile); der DAV-Kern ist transport-agnostisch und gegen Radicale end-to-end getestet (`npm run test:integration`).
- Zu Frage 2/3: der Kern läuft die Discovery-Kette generisch (`.well-known` → Principal → Home-Sets → Sammlungen) und nutzt `sync-token` (RFC 6578) mit Fallback auf CTag/ETag — beides wird beim ersten authentifizierten Lauf gegen `dav.mailbox.org` sichtbar. Die 301-Antworten mit absoluter `Location` sind genau der Pfad, den `discover()` erwartet.
- Offen bleibt Frage 1 (App-Passwort vs. OAuth für DAV) und Punkt C9 der Erhebungsliste (Scheduling-Outbox → verschickt der Server Einladungen?). Beides braucht das App-Passwort aus Teilprojekt ④.
