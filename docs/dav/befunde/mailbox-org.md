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

---
## Nachtrag aus der mailbox-org-Session (2026-08-23, nach Teilprojekt ②)

**Frage 1 und C9 bleiben offen** — beide hängen weiterhin am App-Passwort aus Teilprojekt ④.
Neu ist nur der Fahrplan: ② (Identität & Adressen) ist seit 2026-08-22 abgeschlossen und
abgenommen, ③ (Posteingang) ist startbereit, ④ folgt danach. Die Teilprojekte laufen streng
nacheinander — ④ wird also nicht vorgezogen, um DAV früher testen zu können. Sobald das
App-Passwort existiert, fallen Discovery-Kette, Collection-URLs, ETag/CTag-Verhalten und die
Scheduling-Outbox-Frage in einem Zug an; die Antworten kommen hierher.

### Zwei Betriebsbefunde, die den iMIP-Weg betreffen

**1. DMARC ist seit 2026-08-23 durchsetzend (`p=quarantine`, Ziel `p=reject` ab frühestens
2026-09-05).** Falls der DAV-Server keine Scheduling-Outbox hat und der Weg über den
registrierten Mail-Transport geht: Dieser Transport **muss** über den authentifizierten SMTP
des Anbieters laufen. Direkter MX-Versand oder ein lokaler MTA wird nicht DKIM-signiert und
ist nicht SPF-berechtigt — die Einladung landet dann beim Empfänger im Spam, ab Stufe 2 wird
sie abgewiesen. Eine Einladung im Spam ist schlechter als gar keine.

**2. `accounts()` darf nur echte Adressen liefern — das ist keine Formalie.** Das Postfach fährt
einen aktiven **Catch-All**: Post an beliebige, nirgends angelegte Kennungen kommt an. **Von
solchen Kennungen kann nicht gesendet werden.** Wenn calendar-notes dem Nutzer eine
Absenderauswahl aus `accounts()` zeigt, muss diese Liste aus den tatsächlich angelegten
Identitäten stammen, nicht aus beobachteten Empfängeradressen. Live sind zwei Rollen —
privat (Standard, zugleich Login-Adresse) und öffentlich — plus einige an Logins gebundene
Funktionsadressen. Der Standard ist bewusst die private Rolle.

Die vollständige Betriebssicht liegt jetzt drüben in
`mailstone/docs/2026-08-23-anforderungen-aus-mailbox-org-betrieb.md` — dort § 6 (Identitäten
und Catch-All) und § 7 (Versandweg) sind für die Konsumentenseite des Transport-Vertrags
ebenso relevant wie für mailstone selbst.

---
## Teilantwort auf Frage 1 (2026-08-23, aus Teilprojekt ③)

Frage 1 lautete: *„Welches Auth-Verfahren akzeptiert `dav.mailbox.org` — Basic mit
App-Passwort, oder OAuth?"* Ein Teil davon ist jetzt beantwortet — nicht am DAV-Endpunkt,
sondern an der Stelle, an der App-Passwörter entstehen.

**Ein App-Passwort bei mailbox.org kennt genau zwei Berechtigungen: „Erlaube IMAP-Zugriff"
und „Erlaube SMTP-Zugriff". Eine Option für DAV gibt es nicht.** Gemessen am 2026-08-23 in
der Oberfläche, beim Anlegen eines Passworts für den Postfach-Scan.

Was das heißt, und was es **nicht** heißt:

- Es ist **kein** Beleg, dass DAV mit App-Passwörtern nicht funktioniert. ManageSieve auf
  Port 4190 hat ebenfalls keine eigene Option und funktioniert trotzdem mit demselben
  Passwort (`AUTH: OK`, gemessen) — es fällt offenbar unter die IMAP-Berechtigung. Für DAV
  wäre dasselbe denkbar, ist aber ungeprüft.
- Es heißt aber, dass **der Anbieter DAV in seinem Berechtigungsmodell nicht vorsieht**. Wer
  darauf baut, dass es ein DAV-spezifisches App-Passwort geben wird, plant an der Oberfläche
  vorbei. Die zwei realistischen Ausgänge sind: DAV nimmt das Passwort über die
  IMAP-Berechtigung an, oder DAV verlangt das Hauptpasswort — Letzteres wäre für ein Plugin
  unschön, weil es bedeutet, dass der Nutzer sein Kontopasswort in die Plugin-Einstellungen
  legen müsste, und das hebt seine 2FA für diesen Weg auf.

Der authentifizierte Test steht weiterhin in Teilprojekt ④ an. Der Befund verschiebt nur die
Erwartung: **Rechnet nicht mit einer DAV-Checkbox.**

**Nebenbei, weil es euren Transport-Vertrag stützt:** Das Postfach hat seit heute ein
serverseitiges Sieve-Regelwerk, und der Ordner für Belege trägt ein IMAP-Keyword und bleibt
ungelesen, damit ein anderer Dienst dort abholen kann. Für euch relevant ist daraus nur die
allgemeine Linie, die auch für `mailstone` gilt und die wir dort dokumentiert haben:
**`BODY.PEEK` statt `BODY`, `EXAMINE` statt `SELECT`, wo nur gelesen wird.** Ein Client, der
beim Anzeigen `\Seen` setzt, zerstört Zustand, auf den andere Dienste sich verlassen.

---

## Frage 1 vollständig beantwortet (2026-08-23, aus Teilprojekt ④)

> [!warning] ÜBERHOLT — dieser Abschnitt ist als Messprotokoll erhalten, nicht als Anweisung.
> Die Kurzfassung unten ist **falsch**; richtig ist ein **Applikationspasswort mit dem Recht
> `dav`**. Widerlegt in § „KORREKTUR zu Frage 1 (2026-08-27)" und gemessen bestätigt in
> § „D11 — Auth" (2026-08-29): `PROPFIND /` mit App-Passwort → **207**. Wer nur diesen
> Abschnitt liest, richtet das Konto falsch ein und bekommt ein nacktes 401.

**Kurzfassung: `dav.mailbox.org` nimmt kein App-Passwort. Es verlangt das Kontopasswort.**
Basic-Auth, kein OAuth. Damit ist die Verzweigung entschieden, an der die geplante
Einstellungs-Warnung hängt — **der Fall ist eingetreten.**

### Wie das gemessen wurde

Ein read-only-Erheber (nur `PROPFIND`/`REPORT`/`OPTIONS`) mit Basic-Auth und einem
App-Passwort des Anbieters:

| Pfad | Status | `WWW-Authenticate` |
|---|---|---|
| `/` | 401 | `Basic realm="OX WebDAV", encoding="UTF-8"` |
| `/caldav/` | 401 | `Basic realm="OX WebDAV", encoding="UTF-8"` |
| `/carddav/` | 401 | `Basic realm="OX WebDAV", encoding="UTF-8"` |
| `/servlet/dav/` | 401 | `Basic realm="OX WebDAV", encoding="UTF-8"` |

`OPTIONS /caldav/` → 401, folglich keine `DAV:`- und `Allow:`-Header ohne Authentifizierung.

Der erste Lauf prüfte nur `/`. Das reichte bewusst nicht: Ein 401 auf der Wurzel kann ein
Pfad-Artefakt sein, und ohne den `WWW-Authenticate`-Header wäre unentschieden geblieben, ob
der Server überhaupt Basic anbietet. Beides ist mit der Gegenprobe ausgeschlossen.

### Bestätigt durch die Anbieter-Dokumentation

Der Onboarding-Assistent des Anbieters (Portal → *Ihr Gerät verbinden* → macOS →
*Kalender (CalDav)* → manuelle Optionen) nennt für CalDAV und CardDAV wörtlich:

```
Server-URL     https://dav.mailbox.org
Benutzername   <die Kontoadresse>
Passwort       Ihr Kontopasswort
```

Das ist die belastbarere Quelle als die Messung, weil sie nicht interpretiert werden muss.
Zwei Nebenbefunde daraus:

- **Der Benutzername ist die Kontoadresse selbst**, keine abweichende interne Kennung. Diese
  Frage wurde bewusst **nicht** durch Ausprobieren geklärt — wiederholte Fehlversuche mit
  verschiedenen Kennungen sehen für einen Server wie ein Angriff aus und können das Konto
  sperren. Die Anleitung beantwortet sie kostenlos.
- **Eine gesonderte DAV-Freischaltung existiert nicht.** Danach wurde ausdrücklich gesucht.

### Was das für das Plugin bedeutet

1. **Basic-Auth ist richtig** — kein OAuth-Pfad nötig.
2. **Die Einstellungs-Warnung wird gebraucht.** Bei diesem Anbieter kennt ein App-Passwort nur
   IMAP und SMTP; für DAV gibt es keins. Wer DAV nutzt, hinterlegt das **Kontopasswort** — und
   die Zwei-Faktor-Authentisierung, die das Webinterface schützt, greift für DAV nicht. Ein
   Gerät oder Plugin mit DAV-Zugang führt damit faktisch den Konto-Zugang.
   Das ist keine Fehlkonfiguration, sondern eine Eigenschaft des Anbieters.
3. **Ein Anbieter-Vergleich lohnt in der Warnung.** Nextcloud kennt App-Passwörter, die für
   DAV gelten; dieser Anbieter nicht. Eine Warnung, die pauschal bei jedem Server erscheint,
   erzieht zum Wegklicken — sie sollte an die Beobachtung „kein widerrufbares Sekundär-Credential
   verfügbar" geknüpft sein, nicht an den Servernamen.

### Was weiterhin offen ist

**Punkt C9 (Scheduling-Outbox) und die gesamte Discovery-Erhebung** — Collection-URLs,
`resourcetype`, Privilegien, CTag/ETag, `sync-collection`, Beispiel-Payloads. Alle diese
Messungen setzen einen erfolgreichen Login voraus, und der geht nur mit dem Kontopasswort.

In der mailbox-org-Session wurde entschieden, **kein** zweites Credential-Depot dafür
anzulegen: Die Erhebung wird nachgeholt, sobald der DAV-Zugang auf dem Rechner regulär
eingerichtet ist — dann liegt das Passwort ohnehin im System-Schlüsselbund, von der
Kalender-Anwendung selbst dort abgelegt, und der Erheber liest genau diesen Eintrag.

**Für die Bauplanung heißt das:** Die Frage, ob der Mail-Transport für iTIP-Einladungen
gebraucht wird, ist noch **nicht** beantwortet. Der Transport-Vertrag bleibt bis dahin gültig.

---

## KORREKTUR zu Frage 1 (2026-08-27) — der Befund oben ist falsch

**Kurzfassung: `dav.mailbox.org` nimmt sehr wohl ein App-Passwort. Es liegt nur in einem
anderen Abschnitt der Oberfläche als der, in dem wir gesucht haben.**

Das widerruft den Abschnitt „Frage 1 vollständig beantwortet" und die daraus abgeleitete
Empfehlung. Wir haben euch einen falschen Befund geliefert; hier steht, was gilt und wie er
zustande kam.

### Was tatsächlich existiert

Der Anbieter führt unter *Einstellungen → Sicherheit* **zwei getrennte** Passwort-Mechanismen:

| Abschnitt | Vergibt |
|---|---|
| **E-Mail-App-Passwörter** | ausschließlich IMAP und SMTP — hier haben wir gemessen |
| **Applikationspasswörter** | „zusätzliche Passwörter mit eingeschränktem Zugriff" |

Die Auswahl des zweiten Abschnitts, aus dem Dokument ausgelesen:

```
Kalender- und Adressbuch-Client (CalDAV/CardDAV)   → value="dav"
WebDAV-Client                                      → value="webdav"
Drive Sync-App                                     → value="driveapp"
Exchange ActiveSync                                → value="eas"
```

**Belegt ist auch, dass es funktioniert:** In der Liste der vorhandenen Applikationspasswörter
steht ein Eintrag mit `Gerät: CALDAV` und einer erfolgreichen Anmeldung am 2026-08-27. Ein
DAV-Client meldet sich damit tatsächlich an — das ist nicht nur ein Formularfeld.

### Wie der Fehler zustande kam

1. **Die Messung war richtig, der Schluss zu weit.** Dass ein *E-Mail*-App-Passwort mit 401
   abgewiesen wird, stimmt weiterhin. Daraus wurde „App-Passwörter gehen für DAV nicht" — das
   folgt nicht.
2. **Die Anbieter-Anleitung führt am zweiten Mechanismus vorbei.** Der Onboarding-Assistent
   nennt „Ihr Kontopasswort" und erwähnt Applikationspasswörter nicht. Wir hatten ihn als *die
   belastbarere Quelle, weil sie nicht interpretiert werden muss* eingestuft. Er war belastbar,
   aber unvollständig — und genau deshalb hat er den Fehler zementiert statt ihn aufzudecken.
3. **Der Satz, an dem es kippte:** *„Eine gesonderte DAV-Freischaltung existiert nicht. Danach
   wurde ausdrücklich gesucht."* Gesucht wurde im Abschnitt *E-Mail-App-Passwörter*. Dort steht
   sie wirklich nicht. **Eine Abwesenheit an einer Stelle ist keine Abwesenheit.**

Falls ihr eine Regel daraus mitnehmen wollt: Ein „gibt es nicht" braucht eine andere
Beweisführung als ein „gibt es". Für die Existenz genügt ein Fund; für die Nichtexistenz muss
man benennen können, wo überall gesucht wurde.

### Was das für euer Plugin ändert

1. **Basic-Auth bleibt richtig** — dieser Punkt war korrekt, kein OAuth-Pfad nötig.
2. **Die Einstellungs-Warnung in ihrer bisherigen Form wird nicht gebraucht.** Der Fall, für
   den sie gedacht war — „bei diesem Anbieter hängt am DAV-Zugang das ganze Konto samt
   2FA-Umgehung" — **tritt nicht ein**, sofern ein Applikationspasswort verwendet wird.
3. **Was stattdessen sinnvoll ist: ein Hinweis statt einer Warnung.** Etwa in der Art „Nutze
   ein anwendungsspezifisches Passwort deines Anbieters, nicht dein Kontopasswort" — also
   dieselbe Linie, die ihr für IMAP/SMTP ohnehin fahrt. Der Grund ist gut: Der
   Einrichtungs-Assistent dieses Anbieters führt aktiv zum Kontopasswort, und wer ihm folgt,
   landet genau in dem Zustand, vor dem die ursprüngliche Warnung schützen sollte. Der Hinweis
   ist also weiterhin nützlich — nur ist er ein Ratschlag, keine Unvermeidbarkeitsmeldung.
4. **Euer Vorschlag, die Warnung an eine Beobachtung statt an den Servernamen zu knüpfen,
   bleibt richtig** und wird durch diesen Befund eher gestützt: Die Eigenschaft, an der ihr
   festmachen wolltet — „kein widerrufbares Sekundär-Credential verfügbar" — trifft auf diesen
   Anbieter **nicht** zu. Eine pauschale Warnung hätte hier falsch gewarnt.

### Was sich für den Zeitplan ändert

**Die Discovery-Erhebung ist wieder ausführbar.** Sie war hinter die Client-Einrichtung
verschoben worden, weil wir kein Konto-Credential in ein zweites Depot legen wollten. Dieser
Grund entfällt: Ein Applikationspasswort mit ausschließlich DAV-Zugriff ist genau das
widerrufbare Sekundär-Credential, das dafür gefehlt hat.

**Punkt C9 (Scheduling-Outbox) rückt damit näher** — er ist die Frage, die entscheidet, ob ihr
den Mail-Transport für iTIP-Einladungen überhaupt braucht. Bis zur Antwort bleibt der
Transport-Vertrag mit `mailstone` gültig; baut weiter.

---
## Erhebung gefahren — alle offenen Punkte beantwortet (2026-08-29, aus Teilprojekt ④)

Der authentifizierte Lauf hat stattgefunden, mit einem Applikationspasswort nach der Korrektur
vom 2026-08-27. Werkzeug war ein read-only-Erheber (nur `PROPFIND`, `REPORT`, `OPTIONS`).
**Muster statt Werte:** Host, Kontokennung und Kalendernamen stehen hier nicht.

### D11 — Auth: beantwortet

`PROPFIND /` mit **Basic-Auth** und einem Applikationspasswort mit dem Recht `dav` → **HTTP 207**.
Benutzername ist die Login-Mailadresse. Kein OAuth nötig.

**Für eure Einstellungen heißt das:** Der Hinweistext lautet nicht mehr „bei diesem Anbieter
hängt das ganze Konto am Kalenderzugang", sondern schlicht: *nimm das Applikationspasswort mit
DAV-Recht, nicht das Kontopasswort und nicht das E-Mail-App-Passwort.* Ein E-Mail-App-Passwort
wird hier mit `401` und `WWW-Authenticate: Basic realm="OX WebDAV"` abgewiesen — das ist ein
plausibler Support-Fall, und die Fehlermeldung sagt es nicht.

### C9 — Scheduling: der Server kann es selbst. **Das ist die wichtige Nachricht.**

```
schedule-outbox-URL:  vorhanden
schedule-inbox-URL:   vorhanden
DAV-Header (OPTIONS): … calendar-auto-schedule, calendar-schedule …
```

Zwei unabhängige Belege. Der Server verschickt Termineinladungen nach RFC 6638 selbst: Ein
Client legt das Ereignis mit Teilnehmern in seiner Collection ab, der Versand passiert
serverseitig.

**Konsequenz für den Vertrag zwischen den beiden Plugins:** `calendar-notes` braucht für diesen
Anbieter **keinen** Mail-Transport aus `mailstone`. Der iMIP-Weg samt der beiden
DMARC-/SMTP-Auflagen aus dem Nachtrag vom 2026-08-23 entfällt hier ersatzlos. Die Auflagen
bleiben nur relevant, falls ihr später einen Server ohne Auto-Schedule unterstützt.

Ein Detail, das leicht zu übersehen ist: Der `calendar-user-address-set` des Principals hat
**mehrere** Einträge (hier vier), nicht einen. Wer prüft, ob der eigene Nutzer Organisator eines
Termins ist, muss gegen die ganze Menge vergleichen — sonst erkennt er eigene Termine unter einer
Nebenadresse nicht als eigene.

### A1–A4 — Discovery-Kette

Läuft regelkonform nach RFC 6764: `.well-known` → `301` mit absoluter `Location` →
`current-user-principal` auf `/` → Home-Sets per PROPFIND auf den Principal.

| Stufe | Form |
|---|---|
| Principal | `/principals/users/<zahl>` |
| Kalender-Home-Set | `/caldav/` |
| Adressbuch-Home-Set | `/carddav/` |

**Fallstrick:** Die Home-Sets sind **flache, kurze Pfade ohne Kontokennung**. Die Kennung steckt
nur im Principal-Pfad. Wer den Collection-Pfad aus dem Principal zusammensetzt, statt ihn zu
erfragen, baut hier eine falsche URL.

Die rohen XML-Antworten liegen auf der Betriebsseite (nicht in diesem Repo — sie enthalten
Kalendernamen). Falls ihr sie für Namespace-Prefixe braucht: anfragen, wir schicken eine
entschärfte Fassung.

### Collections — drei Eigenschaften, die einen Client brechen können

1. **Die Pfad-Kennungen folgen keinem Schema.** Im selben Home-Set stehen nebeneinander
   base64-artige Kennungen (`/caldav/<base64-artig>/`) und schlichte Zahlen (`/caldav/<zahl>/`),
   bei den Adressbüchern durchweg Zahlen. Es gibt nichts abzuleiten — der Pfad muss aus der
   Discovery kommen.
2. **Nicht jeder Kalender ist beschreibbar.** Eine der Kalender-Collections liefert in
   `current-user-privilege-set` nur `read` — eine aus den Kontakten abgeleitete Ansicht. Ein
   Client, der alle Kalender gleich behandelt, läuft dort in einen Fehler beim ersten
   Schreibversuch. **Das Privilege-Set auswerten, nicht die Ressourcentyp-Angabe allein.**
3. **`VEVENT` und `VTODO` liegen in getrennten Collections.** Jede Collection nennt ihr
   `supported-calendar-component-set`; die Aufgaben-Collection nimmt keine Termine an. Ebenfalls
   auswerten statt annehmen.

Neben den Nutzer-Collections erscheinen Schedule-Inbox und -Outbox als Geschwister im selben
Home-Set. Sie tragen kein CTag und sind keine Kalender — beim Auflisten herausfiltern.

### B5 — Sync: beides vorhanden

`REPORT sync-collection` → **HTTP 207 mit `sync-token`**, geprüft an je einer Kalender- und einer
Adressbuch-Collection. Zusätzlich führt jede Collection ein `getctag`. Ein Client kann also
inkrementell abgleichen und den CTag als billigen Vorabtest nutzen, ob überhaupt etwas
angefasst werden muss. Euer Kern-Verfahren (`sync-token` mit CTag/ETag-Fallback) passt ohne
Anpassung.

### B6 — Queries: für CardDAV inhaltlich belegt, für CalDAV weiterhin offen

**Nachtrag 2026-08-30.** Der Stand vom 2026-08-29 lautete „angenommen, inhaltlich nicht belegt":
`calendar-query` mit `time-range` und `addressbook-query` liefern beide **HTTP 207**, beide
ergaben **0 Treffer**, weil die Collections leer waren.

Inzwischen fand sich eine Collection, die **nicht** leer ist — eines der Adressbücher, die der
Anbieter serverseitig mitbringt, führt einen Eintrag. Damit ließ sich `addressbook-query`
inhaltlich prüfen, ohne auf den Datenumzug zu warten:

| Lauf | Ergebnis |
|---|---|
| `prop-filter` auf `FN`, `text-match match-type="contains"` mit einem Teilstring, der **vorkommt** | HTTP 207, **1 Treffer** |
| derselbe Filter mit einem Text, der **nicht vorkommt** | HTTP 207, **0 Treffer** |

Kollation `i;unicode-casemap`. **Der Filter trennt also tatsächlich** — er nickt nicht bloß jede
Anfrage ab. Für `addressbook-query` ist B6 damit erledigt.

**`calendar-query` mit `time-range` bleibt offen.** Alle Kalender-Collections dieses Kontos sind
weiterhin leer; eine Gegenprobe über ein absichtlich sehr weites Fenster (1970–2038) gegen alle
drei Collections liefert 207 und null Treffer. Das bestätigt die Leere und ist **kein**
Filterbefund. Der Beleg braucht mindestens einen echten Termin und **zwei** Fenster — eines,
das ihn enthält, und eines, das ihn ausschließt. Nachgereicht, sobald der Umzug durch ist.

> **Verallgemeinerbar, unabhängig von diesem Anbieter:** Ein Filter, der auf der leeren Menge
> null liefert, ist nicht geprüft, sondern nur befragt. Wer eine Server-Kompatibilität aus
> „REPORT wurde mit 207 beantwortet" ableitet, hat den Transport getestet und die Semantik
> angenommen. Das gilt für jede Test-Matrix, die ihr gegen fremde Server fahrt.

### B7 — `multiget`: beantwortet für CardDAV

**Nachtrag 2026-08-30**, an derselben nicht-leeren Adressbuch-Collection gemessen.
`addressbook-multiget` mit `getetag` und `address-data`, angefragt wurden die echte
Ressourcen-URL **und zusätzlich eine URL, die es sicher nicht gibt**:

| angefragte URL | Status im Multistatus | `getetag` | `address-data` |
|---|---|---|---|
| existierende Ressource | `200 OK` | ja | ja |
| erfundene Ressource | `404 NOT FOUND` | — | — |

Zwei Aussagen, und die zweite ist für einen Client die wichtigere:

1. Der Server liefert **ETag und Nutzdaten in einem Zug**. Ressourcen müssen nach dem
   `multiget` nicht noch einzeln per `GET` nachgeholt werden.
2. Eine unbekannte URL wird als **eigenes `<response>` mit 404 gemeldet, nicht still
   weggelassen**. Ein Client kann Antwort auf Anfrage abbilden, statt bei jeder Lücke zu raten,
   welche URL fehlt.

**Empfehlung für eure Tests:** Hängt an jeden `multiget` grundsätzlich eine garantiert nicht
existierende URL an. Ein Server, der sie verschweigt, ist an der Antwortlänge allein nicht von
einem zu unterscheiden, der eine echte Ressource verloren hat — und der Unterschied fällt sonst
erst im Sync auf.

**`calendar-multiget` bleibt offen**, aus demselben Grund wie oben: keine Termine vorhanden.

### B8 — ETag bei `PUT`: **nicht geprüft und in dieser Erhebung nicht prüfbar**

Das Werkzeug kann grundsätzlich nicht schreiben — bewusste Bauentscheidung, kein Versäumnis.

### D12 — Rate-Limits: keine aufgefallen

Rund fünfzehn Requests in etwa einer Minute, darunter mehrere `PROPFIND` mit `Depth: 1`. Kein
`429`, keine Verzögerung, kein `Retry-After`. Das ist eine Aussage über diese Größenordnung —
**nicht** über einen Erstabgleich mit tausenden Ressourcen. Wer das wissen muss, misst es beim
ersten vollen Sync.
