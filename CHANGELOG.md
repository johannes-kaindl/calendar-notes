# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.3.1] — 2026-10-03

### Added

- The GitHub release now also carries a ready-to-unpack `calendar-notes.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.

### Changed

- The changelog is now written entirely in English.
- Internal design notes moved out of the repository; the user documentation is unchanged.

## [0.3.0] — 2026-09-26

### Added

- Help row at the top of the settings with links to the documentation and the issue tracker.

## [0.2.1] — 2026-09-24

### Changed

- `authorUrl` in the manifest points to the GitHub profile again.
- Keychain module vendored from obsidian-kit 0.35.0 (previously a separate copy); behaviour unchanged.

## [0.2.0] — 2026-09-05

- **Tasks from the calendar are mirrored as notes.** If you keep your tasks in Thunderbird, the iOS Reminders app or another CalDAV client, you now find them in the vault again — with due date, status, priority and categories in the frontmatter, in the notation TaskNotes expects. A button in the settings reads the status names **from the TaskNotes installation of this vault** and enters them into the profile; bundled defaults would be wrong, because the names can be renamed freely. With most providers, tasks and events live in separate calendars — the plugin now detects this on its own and assigns the matching profile.
- **Tasks now travel in both directions.** If you tick off, move or rename a task in the vault, you send it back with the command **"Sync tasks with the server"** — and a task that was created in the vault is created on the server in the process. The command writes nothing on its own: it first shows **all** differences, grouped into "changed in the vault", "new" and "changed on both sides", and asks per row which side wins. What was evidently intended is preselected — ticked off and newly created go along, a conflict stays untouched until someone decides. What cannot be transferred is shown at the row **before** sending, instead of missing afterwards.
- **A cancelled task is not reinterpreted as a completed one in the process.** In TaskNotes, "done" and "cancelled" often carry the same status; in reverse, it cannot be told which was meant. The plugin therefore does not guess, but leaves the server state as it is as long as it still matches the value in the note.
- **Nothing is deleted.** If you delete a task note in the vault, you delete the note — the task on the server stays. This is intentional: an accidentally deleted mirror must not take data on the server with it.
- An open task is always mirrored, even if it has no date at all — unlike events, which only appear within the configured time window; completed tasks disappear as soon as their completion has run out of the window.

- **The calendars of an account are now offered for selection right at the account.** After "Check connection and find calendars", the list of what was found appears there with a toggle each — setup is thus one path: create the account, check, tick. Until then, the calendars found could only be seen under "Calendars & address books", one level deep behind a page that bears the **account** name; on first contact this read as "I only have one calendar, and it's named after my provider". The menu item stays and still carries the fine-tuning per calendar (profile, folder, sync now, link existing notes). It is the same toggle in both places, not a second state — and the warning "this collection holds no events" now appears at the selection instead of only afterwards.

## [0.1.9] — 2026-08-29

- **Fix (sync): An empty collection aborted the sync with "Response is not a DAV:multistatus".** A calendar without events answers regularly with a root node without children, and mailbox.org sends it self-closing (`<D:multistatus … />`). The XML parser returns an empty *string* for it instead of an empty object — the check took that for "no multistatus at all" and reported a protocol error. This affected **every empty calendar and every newly created address book**, i.e. exactly the state at first setup. Now only a **missing** root node is an error; an empty one simply means "no entries". Verified against mailbox.org: six collections, no error.
- **DAV parser error messages now name the request and the start of the response.** Previously the message read the same at seven different call sites, without saying which request had failed or what the server had sent instead — the error could not be narrowed down from it. This is exactly where the search for the cause above failed first.
- **The settings now explain themselves.** Every row says what it does — until then, they contained words from the DAV protocol without explanation ("collection", "profile", "folder override", "dry run"), and anyone who doesn't know CalDAV had no entry point. Concretely: "Collections" is now called **"Calendars & address books"**, and the page below it now carries the account name **including the count** ("mailbox.org — 6 found") instead of just the account name — before, it looked as if there were exactly one collection named like the provider. **"Create profile from the open note"** has become a labelled row with an explanation instead of an unlabelled wand icon whose meaning was only in the tooltip (so nowhere on mobile devices) — it is the central setup step and was practically undiscoverable. The language choice is no longer under "Synchronisation" but under "Appearance"; it stays because it is needed when you operate Obsidian in a different language than you want to read the plugin in.
- Fix: The hint on collections without events was grammatically without a referent ("It is not mirrored; there would be nothing to find") and did not name the subject. Rephrased.
- Fix (silent, but serious): A settings **list** counts its delete function via the index in the row list. An explanatory row inside it would have hit the **wrong account** on delete. Explanations now sit next to the list instead of in it, secured by a test that checks every list with a delete function for this.

## [0.1.8] — 2026-08-29

- **Fix (collections): A task collection looked like a calendar and was silently not mirrored.** Servers can keep `VEVENT` and `VTODO` in **separate** collections (with mailbox.org this is the normal case) — both report `<c:calendar/>` as the resource type, but only one of them accepts events. Which one is stated by `supported-calendar-component-set`; the plugin did collect the property during discovery, but dropped it afterwards. Anyone who enabled the task collection got a run without result and no hint as to why. The value is now passed all the way to the settings, a collection without `VEVENT` is skipped during sync with `unsupported-components`, and the row in the settings says so. If the server says nothing (Radicale, for instance, does not necessarily return the property), nothing changes — nothing is assumed.

## [0.1.7] — 2026-08-25

- **Fix (discovery): 405 against Nextcloud — the start address was guessed from the request URL instead of read from the response.** `wellKnown()` was built on seeing the redirect from `/.well-known/caldav` itself. Obsidian's `requestUrl`, however, follows redirects itself (and keeps the method), so a `207` arrived there directly — the 301 branch was dead code, and the 207 branch returned the **requested** address plus a slash (`/.well-known/caldav/`). With Nextcloud that is a different route: it redirects to `/index.php/.well-known/caldav/` and answers there with **405**. The correct address has long been in the response — the `<d:href>` of the multistatus names the resource the server actually answered; exactly that is now used. Verified against the real Nextcloud: 16 collections, no warnings.

## [0.1.6] — 2026-08-25

- **Fix (auth): The repair from 0.1.5 did not take effect in the normal case.** It only recognised accounts whose keychain entry carried its own ID as the value — the damage almost always arose differently, though: under the plugin's own ID lay the **name of the entry that the user had assigned in the dialog**. Exactly that is now the detection signature (the value is itself an existing entry), and the case is lossless: the account is re-linked to that entry, the password does not have to be selected again. `repairSelfReferencingSecrets()` is therefore now called `repairSecretLinks()`.

## [0.1.5] — 2026-08-25

- **Fix (auth): No account could log in — every server answered 401.** The password row in the settings uses Obsidian's `SecretComponent`, and that is a *reference* to a keychain entry, not a password field: its `onChange` returns the **ID** of the chosen or newly created entry, not its value. The plugin stored this ID as the password value and from then on logged in with the *name* of the entry. The account now remembers the ID (`account.secretId`), and Obsidian alone manages the value. Affected accounts are repaired automatically at startup by `repairSelfReferencingSecrets()`: they count as unlinked again, the unusable entry is emptied — **the real password is retained under the self-assigned ID and only has to be selected again.**
- Fix: The X on the password row (unlink) called the callback with `null` and ran into an error instead of unlinking.
- When an account is deleted, its keychain entry is no longer overwritten — in the reference model it belongs to the user and may be used by a second account.

## [0.1.4] — 2026-08-25

- Fix: A DAV password copied via the clipboard with a trailing line break (e.g. `pbcopy < file`) ended up unchanged in the keychain and led to 401 on sync despite the correct password. `stripCrLf()` now removes leading/trailing `\r`/`\n` on saving in both `SecretStore` implementations, without touching other whitespace in the password.

## [0.1.3] — 2026-08-23

- `fast-xml-parser` 4.5.7 → 5.11.0: the store gate scan reports every version <5.7.0 (GHSA-gh4j-gqv2-49f6, affects only the unused `XMLBuilder`) as a warning — a verdict by range, not by code path. Parser usage unchanged, all tests green.
## [0.1.2] — 2026-08-23

- Plugin name `Calendar & Contact Notes` → **`Calendar and Contact Notes`**: the Developer Dashboard rejects `&` (manifest rule: no punctuation except hyphen, plus and parentheses — docs.obsidian.md/Reference/Manifest#name); `eslint-plugin-obsidianmd` does not check this, the finding only came up at store registration.
## [0.1.1] — 2026-08-23

- CI gate: `tsconfig.test.json` no longer pulls in `scripts/` — the drivers import the central CDP bridge from the umbrella repo, which is missing in the GitHub checkout; `typecheck:scripts` (with an existence guard) still covers them. 0.1.0 failed exactly on this in the release action (no GitHub release, never in the store) — 0.1.1 is the first published state.
## [0.1.0] — 2026-08-23

- M1: Obsidian-free DAV core — discovery (well-known → principal → home sets), collection sync (sync-collection with fallback to ctag/etag diff), multiget, object client with If-Match/412; VEVENT and vCard parsers/mutations on ical.js; Radicale integration test (`npm run test:integration`).
- M2a: Obsidian-free mirror core — mapping profiles, managed values + attendee wikilinks, body block management, file name (kit template) + hash, time window + recurrence queries; plan types create/update/skip/archive/delete; collection state tracking with snapshot/history.
- M2b: Obsidian layer — settings model (accounts + secrets in the keychain), transport/state/secrets adapters, SyncService with injected interfaces (fully tested in vitest with fakes), settings tab (discovery, profile management, sync options), preview modal, commands (sync-all/sync-preview/sync-collection), start/interval triggers.
- M3: Adoption flow (link existing notes to server entries via modal after matching review), profile derivation from a frontmatter template, staging vault fixture, automated GUI smoke with baseline.
- M5 (addendum 2026-08-23): README images recorded (`npm run shots`, 5 images, contract `docs/images/README.md`); preview modal shows collection **names** instead of internal IDs.
- M4: Explicit commands (move, change fields, add/remove attendees, accept/decline, delete, create, contact fields, write manual edits to the server) with `If-Match`/412 conflict path + targeted re-sync, "Undo last change" from the history (`undo.last`, regular registry entry), invitation path server scheduling → mail transport → `.ics` (route only becomes "transport" when a registered transport also has at least one sender identity), plugin API v1 (`app.plugins.plugins["calendar-notes"].api`: read, plan/execute commands — with schema validation of the input —, `registerMailTransport`, `on`) — `docs/API.md`. The command registry is populated on load (`ensureDefaultCommands()`, idempotent). GUI smoke extended by P10–P13 (command via API, invitation without scheduling/transport, undo, API read) — generic 12/12, pallas 4/4.
- M5: i18n completion of the command titles/summaries (`titleKey`/`descriptionKey`/`summaryKey`), README de/en with recording recipe (`scripts/shots.ts`), release infrastructure per umbrella standard (`release.yml`, `versions.json`, `LICENSE`/`LICENSING.md`/`THIRD-PARTY.md`, `docs/AUDIT.md`), store preparation (`docs/STORE.md` scorecard preview, `docs/RELEASE.md` maintainer handover for remotes + first release + developer dashboard/rescan).
