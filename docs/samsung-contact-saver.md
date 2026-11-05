# Samsung Contact Saver: plan

Status: **not built.** Checked on 5 Nov 2026 as an idea only. Nothing has been tried on the Samsung yet.

## What Tony wants

Type a name and number on any phone, and it saves itself into the contacts on Tony's Samsung, with nobody touching the Samsung.

It must not depend on a Google or Samsung account. The contact is saved directly on the device.

## Is there a way?

**Yes, about 90% sure.** Android lets an app with the contacts permission write straight into the phone's own contacts, with no account.

| Way | Works? | Decision |
|---|---|---|
| Our own small app on the Samsung | Yes, automatic | **Do this** |
| Web page alone | No, websites cannot save contacts | Rejected |
| Send a contact file to the phone | Only with a tap for each contact | Rejected |
| Google Contacts sync | Works, but depends on Google | Rejected by Tony |

## How it works

1. **Type page (any phone):** Name, Number, Save. It warns if the number was already sent, then shows *Waiting* and changes to *Saved on phone*.
2. **Shop server (Convex):** holds each contact until the Samsung collects it. The two phones cannot reach each other directly, so this go-between is needed. It is Tony's own server, not Google's.
3. **App on the Samsung:** checks the server, writes the contact into the phone, and reports back saved or failed.

## What to build

### Server (`convex/`)

- New table `contactQueue`: name, phone, status (`pending`, `saved`, `failed`), error, createdAt, savedAt.
- An add mutation made with `lib/guarded`, so only trusted shop devices can add.
- Two HTTP routes for the app: one lists pending contacts, one reports a result.
- Both routes check their own key, the same way `backupKeyOk` does in `convex/http.ts`. Use a new Convex env var, not `CONTACTS_BACKUP_KEY`, and never commit or print the key.
- Saving twice must be harmless: the app reports by queue id, and a contact already `saved` stays saved.

### Type page

- Add it to the Counter site (`src/counter.tsx`), which already has trusted-device login, rather than making a new site.
- Use the Signs look in `DESIGN.md`: blue to do, yellow for waiting, green for saved.

### Android app

Decide first (see Open questions): add this to Contact Fixer, or make a new app.

- Write with `ContactsContract`, leaving the account name and type empty so the contact stays on the device.
- Permissions: `WRITE_CONTACTS`, `READ_CONTACTS`, `INTERNET`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `RECEIVE_BOOT_COMPLETED`.
- Use a foreground service that asks the server about every 30 seconds. Do not use Firebase, because that is Google's message service. Start it again after the phone restarts.
- Keep `targetSdk` at 34. Android limits this kind of background work to 6 hours a day for apps targeting 35.
- Before saving, look the number up on the phone. If it is already there, do not make a second contact; report that back.

## What Tony has to accept

- A small notification stays on the Samsung all the time.
- The app must be added to Samsung's **Never auto sleeping** list, or Samsung may stop it.
- Both phones need internet. If the Samsung is offline, contacts wait and save when it is back.
- Contacts saved this way live only on that phone. The weekly Contact Fixer backup needs to keep running, since it is what protects them.
- The app is installed once from a file, not from the Play Store. Keep the same signing key, or later updates will not install.

## Test on the real Samsung

1. Send a contact: it appears within about 30 seconds and the page shows *Saved on phone*.
2. Check it shows in the Samsung Contacts app as stored on the phone, with no Google or Samsung account.
3. Send the same number again: no second contact is made.
4. Put the phone in airplane mode, send a contact, then reconnect: it saves.
5. Restart the phone: the app starts itself and keeps working.
6. Leave the phone idle overnight, then send a contact: it still saves.

## Open questions

1. **Is the Contact Fixer code on the PC with the Android tools?** `convex/schema.ts` says it is in `Desktop/Code PlayGround/ContactFixer`. It is not on the shop PC. If found, adding this to Contact Fixer may be easier than a new app, because it is already on the Samsung and already reads the contacts.
2. **Who builds it?** The shop PC has no Android tools, by choice. Tony has another PC that does. Either open Claude Code there, or connect it so it can be reached from the shop PC.

## Before shipping

The Convex deploy is blocked until the Mac's 4 uncommitted files are committed (`.gitignore`, `.railwayignore`, `.vercelignore`, `scripts/copy-device-trust.mjs`). This feature needs Convex, so sort that out first.
