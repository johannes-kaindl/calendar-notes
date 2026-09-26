# Troubleshooting

Each entry starts with what you see — the wording is the plugin's own English text (a German Obsidian shows the German equivalents) — then the cause and what to do. If yours is not here, see [Getting help](#getting-help).

## Connection test failed

> Connection test failed: …

The text after the colon says what the server answered. Common cases:

**Zugang verweigert (401)** (or **(403)**) — the server rejected the credentials. This one message is always shown in German.

**Cause:** wrong user name or password, or your provider requires an **app password** with calendar permission instead of your account password. A password without that permission is usually rejected with a bare "unauthorised" that does not name the reason.

**Fix:** create an app password at your provider, enter it under **Password** of the account, and press **Test connection and find calendars** again. The user name is usually your full email address.

**PROPFIND … → 404** — the server does not know that address.

**Cause:** the **Server address** is wrong or points below the DAV root.

**Fix:** use the base address of the server, for example `https://dav.mailbox.org/` or the address of your Nextcloud; the plugin finds the calendars underneath by itself.

## No keychain entry linked

> No keychain entry is linked to this account.

> No password stored on this device for this account.

**Cause:** the password is not in the plugin settings but in Obsidian's keychain, per device. On a new device, or after the entry was deleted, the account has none. The password row says *No keychain entry linked yet — use the button to pick or create one.*

**Fix:** open *Settings* → *Calendar and Contact Notes* → **Accounts**, use the button in the **Password** row to pick or create the entry, then test the connection again.

## No collections are enabled yet

> No collections are enabled yet — turn one on in the plugin settings first.

**Cause:** a sync or a new-event or new-contact command was started, but no calendar or address book has **Mirror as notes** switched on.

**Fix:** open **Calendars & address books** in the settings and switch on the ones you want. If the list is empty, press **Test connection and find calendars** on the account first.

## A collection is skipped

> This collection holds …, which does not match the selected mapping profile. Pick a matching profile — otherwise the sync skips it.

**Cause:** a calendar with events was given a contacts profile, or the other way round.

**Fix:** choose the matching **Profile** in that collection's row.

## This note is not a mirrored event or contact

> This note is not a mirrored event or contact.

> No synced version of this note was found — sync the collection first.

**Cause:** **Change event/contact…** and its siblings only work on notes the plugin created or adopted; they carry `dav_uid` and `dav_source` in the frontmatter. The second message means the note is known but no synced state exists yet.

**Fix:** open a mirrored note, or run **Sync all collections** first. Notes that already existed before the plugin can be linked with **Match existing notes…**.

## No command applies / no active note

> No active note — open one first.

> No command applies to this note.

**Cause:** no note is open, or the open note offers no command — for example a task note asked for an event command.

**Fix:** open the mirrored event or contact and run the command again.

## The object changed on the server in the meantime

> The object changed on the server in the meantime.

> … could not be written because they changed on the server in the meantime.

**Cause:** someone or something — another device, the provider's web interface — changed the same entry after the plugin last read it. The plugin sends every write with the version it saw and never overwrites a newer one.

**Fix:** run **Sync all collections** to fetch the fresh version, then repeat the change. With **Sync tasks with the server**, rows that changed on both sides stay untouched until you choose per row which side wins.

## Saved on the server, but the local note could not be updated

> Saved on the server, but the local note could not be updated: …

**Cause:** the change reached the server, but rewriting the note in your vault failed.

**Fix:** run **Sync all collections**; the next sync brings the note in line with the server.

## Hand edits do not reach the server

> No hand edits to write to the server.

> No supported field changed — skipped: …

**Cause:** editing the frontmatter of a mirrored note never writes to the server by itself; the next sync even overwrites it. **Write hand edits to the server** sends only supported fields, and reports the others as skipped.

**Fix:** run **Write hand edits to the server**, review the diff and confirm. For anything else use the change commands.

## Nothing to undo

> No earlier version to undo to.

**Cause:** **Undo last change** reverts the last change made through a command and recorded in the object's history; there is none for this note.

**Fix:** none — changes made in another client are not in this history.

## Profile problems

> Profile invalid: …

> Not valid JSON.

> This profile is still used by a collection — remove that link first.

**Cause:** a mapping profile edited as JSON does not follow the profile schema, or you tried to delete a profile that a collection still uses.

**Fix:** fix the JSON as the message says, or first pick another **Profile** in the collection row, then delete.

## TaskNotes was not found

> TaskNotes was not found, or it does not allow reading its settings.

**Cause:** **New profile from TaskNotes** reads the status names from the TaskNotes plugin of this vault, which is not installed, not enabled, or too old.

**Fix:** install and enable TaskNotes, then press the button again.

## Getting help

Still stuck? [Open an issue](https://github.com/johannes-kaindl/calendar-notes/issues) with your Obsidian version, the plugin version (*Settings* → *Community plugins*), the kind of server (mailbox.org, Nextcloud, …) and what you expected to happen. Never include your password.
