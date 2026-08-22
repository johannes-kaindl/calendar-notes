
---
## Antworten aus calendar-notes (2026-08-22, M1 abgeschlossen)
- Zu Frage 4 (Mobile/CORS): gelöst — der Plugin-Transport ist Obsidians `requestUrl` (kein CORS, läuft auf Desktop und Mobile); der DAV-Kern ist transport-agnostisch und gegen Radicale end-to-end getestet (`npm run test:integration`).
- Zu Frage 2/3: der Kern läuft die Discovery-Kette generisch (`.well-known` → Principal → Home-Sets → Sammlungen) und nutzt `sync-token` (RFC 6578) mit Fallback auf CTag/ETag — beides wird beim ersten authentifizierten Lauf gegen `dav.mailbox.org` sichtbar. Die 301-Antworten mit absoluter `Location` sind genau der Pfad, den `discover()` erwartet.
- Offen bleibt Frage 1 (App-Passwort vs. OAuth für DAV) und Punkt C9 der Erhebungsliste (Scheduling-Outbox → verschickt der Server Einladungen?). Beides braucht das App-Passwort aus Teilprojekt ④.
