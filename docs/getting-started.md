# Getting started

This walks you from the install to your first mirrored event note: an account, the calendars found on your server, a dry run and the first real sync. You need a CalDAV/CardDAV account — for example at mailbox.org or on a Nextcloud — and its address, user name and password. The plugin never changes anything on the server while you set up.

## 1. Install

*Settings* → *Community plugins* → *Browse* → search for **Calendar and Contact Notes** → *Install* → *Enable*. For the other ways see the [Install section of the README](https://github.com/johannes-kaindl/calendar-notes/blob/main/README.md#install). Obsidian 1.13.0 or newer is required.

## 2. Add an account

Open *Settings* → *Calendar and Contact Notes* → **Accounts** and press **Add account**. Fill in:

- **Name** — anything you like; it only tells several accounts apart.
- **Server address** — for example `https://dav.mailbox.org/` or the address of your Nextcloud. The plugin finds the calendars underneath by itself.
- **Username** — usually your full email address.
- **Password** — stored in Obsidian's keychain, not in the plugin settings. Use the button to pick or create the keychain entry. Many providers want an **app password** with calendar permission here, not your account password.

Then press **Test connection and find calendars**. A notice says how many collections were found, for example *3 collection(s) found (0 warning(s)).*

## 3. Choose what to mirror

Under **Calendars & address books** every calendar and address book of the account is listed. Switch on **Mirror as notes** for the ones you want; each one shows a **Profile** — the mapping between server fields and note fields, and the target folder. The defaults write events to `Events/` and contacts to `Contacts/`.

If you already have notes for these contacts or events, press **Match existing notes…** first, so the first sync links them instead of creating duplicates.

## 4. Preview, then sync

Under **Actions** press **Preview: what would a sync change?**. It works out a full sync and shows how many notes would be created, updated or deleted, and writes nothing. When it looks right, press **Sync everything now** (or run the command **Sync all collections**).

You should now find notes in `Events/` and `Contacts/`. Open an event note: the frontmatter carries `dav_uid`, `dav_source`, `start`, `end` and more, and the block between `%%dav:begin%%` and `%%dav:end%%` is kept in sync. Everything you write outside that block stays.

From here the plugin syncs on its own every 15 minutes while Obsidian is open.

## Where next

- Change an event or contact on the server through a command — **Change event/contact…**, **New event…**, **Undo last change**. Each one shows a diff before anything is sent.
- Tasks from your calendar server show up as TaskNotes-compatible notes; the README explains how to build the profile from your own TaskNotes settings.
- Something went differently? See [Troubleshooting](troubleshooting.md).
