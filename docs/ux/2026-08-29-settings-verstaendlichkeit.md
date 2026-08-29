# Befund: Die Einstellungen sind für einen Erstnutzer nicht bedienbar

**Herkunft:** Erstkontakt am 2026-08-29 — der Maintainer richtet das Plugin zum ersten Mal
gegen ein echtes Konto ein (Rollout Teil A) und liest die Oberfläche dabei zum ersten Mal
*als Nutzer* statt als Autor. Alle Zitate sind wörtlich.

**Warum dieser Befund schwerer wiegt als eine Liste von Textwünschen:** Bis hierher wurde
die Verständlichkeit nie gemessen. Tests prüfen Verhalten, der GUI-Smoke prüft, dass ein Knopf
etwas auslöst — **keine Prüfschicht liest die Oberfläche.** Der erste Mensch, der es tat,
verstand sieben zentrale Begriffe nicht, und in mindestens einem Fall beschreibt die
Oberfläche etwas, das es gar nicht gibt (B6). Das ist kein Politur-Thema.

Die zentrale Diagnose in einem Satz: **Das Plugin benennt seine Gegenstände mit den Wörtern
des DAV-Protokolls und erklärt keines davon.** „Sammlung", „Profil", „verknüpfen",
„spiegeln", „Trockenlauf", „Override" sind Autoren-Vokabular. Wer CalDAV nicht kennt, hat
keinen Einstiegspunkt — und wer es kennt, braucht die Oberfläche nicht.

---

## A · Begriffe, die nirgends erklärt werden

> „Alle diese Begriffe sind nirgends erklärt!"

| Begriff | Was es tatsächlich ist | Wo es steht |
|---|---|---|
| **Sammlung** | Ein Kalender oder Adressbuch **auf dem Server**. Nicht im Plugin anlegbar — sie entstehen beim Anbieter und werden nur gefunden. | `settings.collections.heading` |
| **Profil** | Die Übersetzungstabelle Server-Feld ↔ Frontmatter-Feld, plus Zielordner und `onCreate`-Felder. | `src/core/mirror/profile.ts` |
| **Spiegeln** | Der laufende Abgleich: Server-Stand → Notiz. Dauerhaft, wiederholt. | `settings.collections.enabled` |
| **Verknüpfen** | **Einmalig**: bestehende Notizen einem Server-Objekt zuordnen, damit der erste Sync sie *aktualisiert* statt Dubletten anzulegen. | `settings.collections.adoptButton` |
| **Trockenlauf** | Vorschau des Syncs — rechnet alles aus, schreibt nichts. | `settings.actions.preview` |
| **Ordner-Override** | Abweichender Vault-Ordner **für diese eine Sammlung**; leer = der im Profil hinterlegte Ordner. | `settings.collections.folderDesc` |
| **Startverzögerung** | Sekunden nach Obsidian-Start bis zum ersten automatischen Sync — damit der Start nicht ausgebremst wird. | `settings.sync.startupDelaySeconds` |

Dass diese Tabelle sich überhaupt schreiben lässt, ist der Befund: **die Information existiert,
sie steht nur nirgends, wo jemand sie liest.**

---

## B · Einzelbefunde

### B1 · „Sammlungen" zeigt den Kontonamen, nicht Sammlungen
> „Bei ‚Sammlungen' steht bei mir nun nur ‚mailbox.org', das sieht also aus, als ob das eine
> Sammlung wäre und ich deswegen nur eine hätte."

**Bestätigt, kein Missverständnis.** `settings-tab.ts:187` legt unter der Überschrift
„Sammlungen" eine navigierbare Seite je **Konto** an (`name: account.name`); die Sammlungen
sind erst eine Ebene tiefer. Der Grund ist eine Typ-Beschränkung (eine Obsidian-`group` darf
keine `group` enthalten, nur `page`) — also eine technische Notwendigkeit, die ungefiltert
zur Beschriftung wurde.

Anschlussfrage des Nutzers, die berechtigt ist: *„ist das überhaupt notwendig, wenn diese
schon erscheinen, wenn man auf das Konto klickt?"* — Die Zweiteilung Konten/Sammlungen
verdoppelt die Navigation ohne erkennbaren Gewinn.

### B2 · Der Hinweis an Aufgaben-Sammlungen ist unverständlich
> „Sie (wer ist ‚sie') wird nicht gespiegelt; es wäre nichts zu finden" — Hä?

Text: `settings.collections.enabledNoEvents`. **Dieser Text ist von heute** (0.1.8) — er
entstand mit dem VTODO-Fix und ist damit der jüngste Beleg dafür, dass ein technisch
richtiger Fix mit einem unlesbaren Satz ausgeliefert werden kann. „Sie" meint die Sammlung;
„es wäre nichts zu finden" meint, dass der Server hier keine Termine führt.

### B3 · „Ordner-Override" erklärt sich mit einem Begriff, den es nicht erklärt
> „Woher weiß ich was der ‚Ordner des Profils' ist? Wie kann ich den einstellen? Ist dann
> damit der Ordner im Vault gemeint? Landen dann Termine, Aufgaben usw alle in einem Ordner?"

Antworten: ja, ein Vault-Ordner. Einstellbar nur im **Profil-JSON**, nicht an dieser Zeile.
Nein — je Profil ein Ordner, und pro Sammlung optional abweichend. Keine dieser drei
Antworten steht in der Oberfläche.

### B4 · „Vorschau (Trockenlauf)" ohne Gegenstand
> „man weiß nicht für was es ein Trockenlauf ist"

### B5 · Sprache und Startverzögerung ohne Begründung
> „Was meinst ‚Startverzögerung' bei Synchronisation? Warum kann ich dort auch eine ‚Sprache'
> einstellen? Wäre es jemals sinnvoll dort etwas anderes als ‚Automatisch' zu setzen?"

Die Sprach-Frage ist die schärfere: ein Einstellknopf, für den niemand einen Anwendungsfall
nennen kann, kostet Aufmerksamkeit und liefert nichts. Kandidat zum **Entfernen**, nicht zum
Erklären.

### B6 · `profile-from-note` ist unauffindbar — die Oberfläche erwähnt es nicht
> „Ich finde es muss auch unbedingt ein kurzen Erklärtext in den Settings gehen, wie das
> profile-from-note Prinzip funktioniert, also dass man ein Notiz öffnen oder anlegen soll,
> und dass man dann das schema der aktiven Notiz übernehmen kann."

**Korrektur zur ersten Fassung dieses Befunds:** Hier stand, der Schritt sei „in den
Einstellungen mit keinem Wort vertreten". Das war falsch — es gibt ihn, als
`extraButton` der Profil-Liste (`settings-tab.ts:254`). Er ist ein **unbeschriftetes
Zauberstab-Icon**, dessen Bedeutung erst beim Darüberfahren erscheint.

Der Befund wird dadurch nicht schwächer, sondern präziser: der zentrale Einrichtungsschritt
war ein Icon ohne Text neben zwei anderen Icons. Dass der Autor ihn beim Suchen nicht fand,
ist die Messung. Das ist der schwerste Einzelbefund, weil er nicht Verständlichkeit betrifft,
sondern **Erreichbarkeit** — und weil ein Tooltip auf Mobilgeräten gar nicht existiert.

### B7 · Keine mitgelieferten Schemata, keine Antwort auf „was ist das für ein Kalender?"
> „Ich denke wir müssen auch irgendwie Schemata als Standard anbieten, bzw. die Möglichkeit
> bieten sie zu konfigurieren. Ich wüsste nämlich nicht, was ich mit dem Geburtstagskalender
> anfangen soll: sind das ganztägige Termine oder Erinnerungen zu einem bestimmten Zeitpunkt?"

Zwei getrennte Dinge: (a) mitgelieferte Vorlagen für die häufigen Fälle, (b) eine Antwort
darauf, wie eine *bestimmte* Sammlung aussieht. (b) ist beantwortbar, ohne zu raten — die
Objekte liegen nach dem ersten Refresh vor und lassen sich auszählen („18 von 18 Einträgen
sind ganztägig"). Das ist eine Messung, keine Heuristik.

### B8 · TaskNotes-Schema übernehmen
> „Für TaskNotes braucht es einen einfachen Weg das dortige Schema zu übernehmen."

Berührt die Zuständigkeitsgrenze aus der Dach-`AGENTS.md`: TaskNotes besitzt Aufgaben. Zu
klären ist, ob das ein mitgeliefertes Profil ist (billig, dupliziert fremdes Wissen) oder
über TaskNotes' HTTP-API gelesen wird (teurer, bleibt korrekt).

---

## C · „Gibt es dafür Standards?" — ja, und sie sind konkret

> „Da muss es doch bereits für so Anwendungen etablierte UIX Standards und best practices
> geben, die wir befolgen können oder?"

Es gibt zwei Sorten, und beide sind hier anwendbar:

1. **Das eingeführte Muster der DAV-Clients.** Thunderbird, Apple Kalender, DAVx5 und die
   Nextcloud-Clients lösen dieselbe Aufgabe seit Jahren gleich: **ein** Einrichtungs-Assistent
   (Adresse + Zugang → „Verbindung prüfen" → **Liste der gefundenen Kalender mit
   Auswahlkästchen**), danach eine flache Liste pro Konto. Kein getrennter Menüpunkt für
   „Sammlungen", keine zweite Navigationsebene. Genau das beschreibt B1 als Problem — die
   Lösung ist nicht neu, sie ist Standard.
2. **Obsidians eigene Settings-Konventionen** (`UI-STANDARD.md` im Dach ist dafür verbindlich):
   sprechender Name + erklärender `desc` an *jeder* Zeile, Gruppen statt Verschachtelung.

Dazu die allgemeine Regel, die alle Einzelbefunde oben verbindet: **die Oberfläche benennt
Dinge nach dem, was der Nutzer erreichen will, nicht nach der Datenstruktur.** „Sammlung" ist
ein Protokollwort; „Kalender & Adressbücher" ist dasselbe Ding in der Sprache des Lesers.

---

## D · Was NICHT aus diesem Befund folgt

Er listet Beobachtungen, keine beschlossenen Umbauten. Insbesondere ist **nicht** entschieden,
ob die Navigation Konten/Sammlungen zusammengelegt wird (B1) — das ist ein Eingriff in eine
gewachsene Struktur mit Tests und GUI-Smoke-Prüfpunkten daran. Reihenfolge und Umfang
entscheidet der Maintainer.

Herkunft: Erstkontakt-Rückmeldung 2026-08-29, festgehalten von der Session, die den Rollout begleitet.
