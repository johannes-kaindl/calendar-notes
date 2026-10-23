# Entscheidungen — das Warum

Verdichtete Design-Essenz zu den Regeln im Kern (`AGENTS.md`). Vor dem Übernehmen einer Altentscheidung gilt: Grund aufsuchen, messen, ob er heute trägt.

## Der Server ist die Wahrheit, geschrieben wird nur über Kommandos

Termine und Kontakte sind ein Spiegel. Notizen werden vom Sync geschrieben, Änderungen am Server nur über explizite Kommandos mit Vorschau (`plan()`/`execute()`), nie als Nebenwirkung. Die Bestätigung liegt bei der UI bzw. beim Aufrufer der Plugin-API.

## Aufgaben (VTODO): Transport, nicht Verwaltung (2026-09-02)

Die Hauptspec (Cockpit: `_SDD/2026-08-22-calendar-notes-design.md`, daher „Spec §8“) führte `VTODO/Aufgaben (→ TaskNotes)` als Nicht-Ziel. Die Klammer nannte den **Zuständigen**, wurde aber als Verbot gelesen — *TaskNotes verwaltet Aufgaben* wurde zu *calendar-notes fasst Aufgaben nicht an*. Aufgehoben (Anlass und Zuschnitt: `_SDD/2026-09-02-vtodo-aufgaben-design.md` im Cockpit): Aufgaben zwischen zwei Klienten desselben Servers zu bewegen ist Transport, nicht Verwaltung — genau die Aufgabe dieses Plugins. Die Grenze der Rolle: `.claude/rules/aufgaben-vtodo.md`.

## Die Rückrichtung bündelt die Bestätigung, nicht das Schreiben

Das Sammel-Kommando `todo-sync` zeigt alle Unterschiede gruppiert und fragt je Zeile, welche Seite gewinnt; geschrieben wird nichts ohne diese Bestätigung. Löschen bleibt Nicht-Ziel.

## Kommandos tragen Schlüssel statt fertiger Texte

Die Übersetzung passiert erst in der Obsidian-Schicht, damit `src/core/commands/**` frei von i18n bleibt. Die Folge für die Plugin-API steht in `.claude/rules/kommandos-und-api.md`.

## Einladungen: eigenständige Kopie der iMIP-Typen

`imip.ts` und mailstone teilen einen Vertrag, aber keinen Import über `src/core/**` (PROF-OBS-09: kein Monorepo, eigener Release-Takt).

## Spezifikationen und Befunde außerhalb des Repos

Specs, Pläne, Erhebungen echter Server (mailbox.org, Nextcloud) und Release-Handover liegen im Coding-Cockpit des Maintainers (CORE-META-14), ohne Zugangsdaten; das Repo behält die Design-Essenz in diesen beiden Dateien. DAV-Befunde dürfen keine Zugangsdaten tragen; Rohantworten mit Auth-Headern gehören nicht ins Repo (der Ignore-Eintrag `docs/dav/befunde/roh/` fängt sie ab, sollten sie lokal landen).
