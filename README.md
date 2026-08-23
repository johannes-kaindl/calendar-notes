# Calendar & Contact Notes

> 🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

**Mirror CalDAV events and CardDAV contacts as notes in your vault — the server stays the
source of truth, and every change back to it goes through an explicit command.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
![Obsidian](https://img.shields.io/badge/obsidian-1.13.0%2B%20·%20desktop%20%26%20mobile-7c3aed)

Calendars and contacts usually live on a server you never see from inside Obsidian — not
linkable, not queryable, not part of your vault. This plugin mirrors CalDAV calendars and
CardDAV address books as Markdown notes, one note per event or contact, kept in sync on an
interval. The mirror is read-only by convention: editing a note's frontmatter by hand does
not write to the server. Changes go back through explicit commands — move an event, change a
phone number, add an attendee — each shown as a diff before anything is sent.

## Features

- **Two-way visibility, one-way writes.** The server's state becomes your notes automatically;
  your notes only change the server through a command you run and confirm.
- **CalDAV and CardDAV in one plugin**, sharing a transport, with server-agnostic discovery
  (RFC 4791/6352/6578) — tested against [Radicale](https://radicale.org), and designed to the
  same standards as mailbox.org and Nextcloud (not yet verified against either live server).
- **A managed block, not a managed note.** Frontmatter fields and a `%%dav:begin%%…%%dav:end%%`
  body block are kept in sync; everything else in the note — your own notes, links, whatever
  you add — survives every sync untouched.
- **Adopt notes you already have.** Point the plugin at an existing folder of contact or event
  notes and it proposes matches (by email, phone, fuzzy title/name) with a confidence level, so
  you link instead of duplicate.
- **Explicit commands for writing**, not free-text editing: move/resize an event, change a
  location or attendee, edit a contact field, undo the last change — each opens a small form,
  shows a diff, and writes only once you confirm.
- **A read/write API for other plugins** (`app.plugins.plugins["calendar-notes"].api`,
  versioned) — events/contacts as data, commands as LLM tool definitions, a `plan()` →
  `execute()` step for anything that writes. See [`docs/API.md`](docs/API.md).
- **No mail sending built in.** An invitation goes out via the server's own scheduling
  (RFC 6638) if it has one, otherwise via a mail plugin that registers itself with
  `calendar-notes`, otherwise as an `.ics` file you copy or save yourself.

## Requirements

- **Obsidian 1.13.0 or newer**, desktop or mobile (`isDesktopOnly` is not set).
- **A CalDAV/CardDAV server reachable over HTTPS** with Basic Auth — mailbox.org or Nextcloud
  are the intended targets; the plugin has been tested end-to-end against
  [Radicale](https://radicale.org) and follows the same standards (RFC 4791/6352/6578) those
  two servers implement, but neither has been verified live yet. Report a mismatch as an issue.
- Nothing else. There is no telemetry and no third-party service beyond the DAV server and,
  optionally, a mail plugin you register yourself.

## Install

### Community Plugins
Not yet submitted to the Obsidian community directory. Once listed:
Settings → Community plugins → Browse → search "Calendar & Contact Notes".

### Manual
Copy `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/johannes-kaindl/calendar-notes/releases) into
`<vault>/.obsidian/plugins/calendar-notes/`, then enable the plugin.

### BRAT (beta)
Add `johannes-kaindl/calendar-notes` in
[BRAT](https://github.com/TfTHacker/obsidian42-brat) to track pre-release builds.

### From source
```bash
git clone https://github.com/johannes-kaindl/calendar-notes
cd calendar-notes && npm install && npm run build
# main.js manifest.json styles.css → <vault>/.obsidian/plugins/calendar-notes/
```

## Usage

### Setup: account → discovery → collections → profile

1. **Settings → Calendar & Contact Notes → Accounts → Add account.** Enter a name, the
   server's base URL and your username, then **Test connection & find collections**. The
   password goes into Obsidian's own secret storage — see [Security](#security--privacy).
2. Successful discovery adds every calendar and address book the server reports under
   **Collections**, each with a **Mirror** toggle (off by default) and a **Profile** dropdown.
   Turn on the ones you want mirrored.
3. Each collection uses a **mapping profile** — which frontmatter fields to write, which
   folder, which filename pattern. Two defaults ship (`Contacts (default)`, `Events
   (default)`, writing to `Contacts/`/`Events/`); under **Profiles** you can edit one as JSON,
   import/export, or generate one from an existing note's frontmatter shape (**Create mapping
   profile from active note**) — handy if your vault already has a contact/event structure you
   want to keep.
4. Run **Sync all collections** (or wait for the interval) to pull the first batch of notes.
   **Preview sync (dry run)** shows what would happen — creates/updates/archives/deletes per
   collection — without writing anything, any time.

### Adoption: link existing notes instead of duplicating them

If a collection's target folder already has notes — migrated from another system, written by
hand — run **Adopt existing notes…** (or the button next to a collection). The plugin proposes
matches between server entries and your notes (email/phone exact, name/title fuzzy) at three
confidence levels — `sure` and `likely` link by default, `weak` is left for you to confirm —
shown in a table you can override row by row before anything is written. Linked notes get their
`dav_uid`/`dav_source` fields set and start updating in place on the next sync instead of
generating a duplicate.

### Commands

The middle column is what you type in the command palette; on a German Obsidian the commands
appear under their German names instead.

| Command | In the command palette | What it does |
|---|---|---|
| Sync everything | `Sync all collections` | Runs a real sync across every enabled collection |
| Preview | `Preview sync (dry run)` | Shows planned operations without writing |
| Sync one collection | `Sync one collection…` | Picks a single collection to sync |
| Adopt existing notes | `Adopt existing notes…` | Opens the adoption review for a collection |
| Profile from note | `Create mapping profile from active note` | Derives a mapping profile from the active note's frontmatter |
| Change event/contact | `Change event/contact…` | Suggests applicable commands for the active note, opens a form, shows a diff |
| New event | `New event…` | Creates an event on the server (and its note) via a form |
| New contact | `New contact…` | Creates a contact on the server (and its note) via a form |
| Undo | `Undo last change` | Reverts the target's last recorded change |
| Push hand edits | `Write hand edits to the server` | Diffs your manual frontmatter edits against the server and offers to write them |

### Configuration

| Setting | What it does | Default |
|---|---|---|
| Accounts | Server URL, username; password in Obsidian's secret storage | — |
| Collections → Mirror | Whether a discovered calendar/address book is synced | off |
| Collections → Profile | Which mapping profile a collection uses | the matching default profile |
| Collections → Folder override | Overrides the profile's folder for this collection only | profile's folder |
| Sync interval (desktop) | Minutes between automatic syncs | 15 |
| Sync interval (mobile) | Minutes between automatic syncs on mobile | 60 |
| Days back | How far into the past events are mirrored (older ones are archived, not deleted) | 90 |
| Days ahead | How far into the future events are mirrored | 365 |
| Startup delay | Seconds after Obsidian loads before the first sync runs | 10 |
| Language | UI language: Automatic (follows Obsidian), English, German | Automatic |

## How it works

**The server is the source of truth; the note is a mirror.** Every sync pulls the server's
current state — via sync-token or ctag/etag comparison, whichever the server supports — and
turns it into a plan: create a note, update its managed fields, archive it (fell outside the
sync window), or send it to Obsidian's trash (deleted on the server, unless the note has
backlinks or content you added, in which case it's marked `dav_state: deleted` instead so
nothing you wrote is silently lost). **Editing a note's frontmatter does not write to the
server** — there is no merge, in either direction, outside of an explicit command.

Writing goes the other way, deliberately narrow: a **command** takes the last-synced server
object, applies one mutation (move a date, change a field, add an attendee), and sends a `PUT`
with `If-Match: <etag>`. A conflicting change on the server (412) is surfaced as "sync the
fresh version and try again," never silently overwritten. Every command shows its diff before
it runs, and the previous state stays in a per-object history — **Undo last change** reverts
it. This is why editing a note by hand never reaches the server: a mirror that could be pushed
back by editing text would need a bidirectional merge, and this plugin deliberately doesn't
have one (see [Limits](#limits)).

## Plugin API

Other plugins can read events/contacts, get the plugin's commands as LLM tool definitions, and
write through the same `plan()` → `execute()` step the UI uses — never bypassing the diff, and
the API itself never opens a modal (confirmation is the caller's job). Full reference,
versioning rules and a mail-transport integration contract: [`docs/API.md`](docs/API.md).

## Security & privacy

- **Passwords live in Obsidian's own secret storage (keychain), per device.** They are not
  written into your notes, your settings file, or synced with the vault — a second device
  needs its own password entered once.
- **No mail is sent by this plugin.** An invitation goes through the server's own scheduling if
  it offers one, otherwise through a mail plugin you explicitly register, otherwise you get an
  `.ics` file to send yourself.
- **No telemetry, no analytics, no third-party service.** The only network traffic is to the
  DAV server(s) you configure and, if you use it, the mail transport you registered.

## Limits

- **No bidirectional merge.** The server is the source of truth; a note's frontmatter is
  read-only from the plugin's perspective outside of an explicit command (`Write hand edits to
  the server` is the one deliberate exception — a diff you review and confirm, not a silent
  merge).
- **Recurring events are one note per master**, not one note per occurrence. A server-side
  exception to a single occurrence gets its own note, linked to the master.
- **On mobile, the secret is per device** — there is no cross-device credential sync, by
  design (see [Security](#security--privacy)).
- **Calendars sync within a time window** (90 days back / 365 days ahead by default); events
  outside it are archived, not deleted, and reappear if the window is widened.
- **Not yet verified against mailbox.org or Nextcloud live** — the plugin follows the same
  standards those servers implement and has been tested end-to-end against Radicale; report a
  live mismatch as an issue.

## Development

```bash
npm install
npm run gate    # lint + typecheck + unit tests + build — the full pre-commit check
npm test        # unit tests only
npm run test:integration   # starts a disposable Radicale via uvx, runs integration tests
```

Architecture, milestone-by-milestone status and the manual smoke procedure:
[`AGENTS.md`](AGENTS.md). GUI smoke checklist (runs against a live, running Obsidian via CDP):
[`docs/SMOKE.md`](docs/SMOKE.md).

## License

- **Code:** AGPL-3.0-or-later ([`LICENSE`](LICENSE)).
- **Third-party:** [`ical.js`](https://github.com/kewisch/ical.js) (MPL-2.0, iCalendar/vCard
  parsing), [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) (MIT,
  WebDAV multistatus parsing).
- Full third-party notices: [`THIRD-PARTY.md`](THIRD-PARTY.md). A commercial license is
  available on request if AGPL-3.0's copyleft doesn't fit your use case: [`LICENSING.md`](LICENSING.md).

Copyright © 2026 Johannes Kaindl.
