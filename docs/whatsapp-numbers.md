# WhatsApp numbers

Which number sends what. Checked 2026-10-30. Update this file when a link changes.

| Label | Number | Sends from | What it sends | Checked how |
|---|---|---|---|---|
| Tony | +91 80928 50954 | Railway `whatsapp-bills` (`/data/auth`) | Sale bills, receipts and quotations to customers' chats; the greeting and visiting card back to a customer's first "hi" (`docs/whatsapp-hi-card.md`); and reads the supplier chats set to auto-print, since 2026-11-26 (see "Supplier chats" below) | Service `/health` and the saved login on the volume |
| Shop | +91 79705 50954 | Railway `whatsapp-reminders` (`/data/auth`), since 2026-10-30 | Ledger "Share to WhatsApp" PDFs, quotation and attachment shares, guarantee messages (with the Google review link under them, `REVIEW_URL`), the auto-reply, birthday reminders; and reads the shop group for printing (photo or PDF with `bw` / `cp`), since 2026-11-25 | The panel calls Convex `shopWhatsApp.*`, which calls the service with `SHOP_WHATSAPP_KEY`; the print server calls it for the card-printed message. Before 2026-10-30 this ran in the shop PC's print server. Group printing: see "WhatsApp group printing" below |
| Meta (C) | Not looked up, ID `1348201888369392` | Convex `convex/whatsapp.ts` | Guarantee cards sent from the panel | Convex variable `WHATSAPP_PHONE_NUMBER_ID` |
| Twilio | +91 98357 16123 | Convex `convex/twilio.ts` | One notice when a template is approved | Convex variable `TWILIO_WHATSAPP_FROM` |

## Birthday reminders

Railway service `whatsapp-reminders` sends the GradeX birthdays to 87099 64141 at 12:00 am India time. It is meant to be linked to Shop as its own linked device, separate from the shop PC's link, so it works with the PC off. It sends only when the linked number is `FROM_NUMBER` (917970550954), and sends nothing on the day it is first linked. Scan the QR at `/login?key=LOGIN_KEY` (`railway variables --service whatsapp-reminders --kv`). Since 1 Nov 2026, when the phone removes the link the service moves the dead login aside on the volume (`/data/auth-logged-out-<time>`) and shows a new QR there by itself; before, the page just said "Unlinked" until someone cleared the volume by hand. To change the list, edit `whatsapp-reminders/birthdays.json`, then `npm run deploy -- --only whatsapp-reminders`.

## Still open

- **Shop PC:** to confirm the number directly, read `me.id` in `print-server/data/baileys-auth/creds.json` on the PC. `/whatsapp-web/status` does not report it.
- **Railway `whatsapp-bridge`:** never deployed, but `whatsapp-bridge-volume` (mounted at `/app/store`) holds 150 MB. It may be an old WhatsApp login. Nothing is running to read it with, so reading it needs a temporary deployment.
- **+91 98353 50954:** printed on bills as "Shop" (`src/lib/types.ts`). No sender is known to use it, and it is not the Shop WhatsApp number above.

## Confusions already settled

- "The number that sends the bill pics" is Tony today: `whatsapp-bills` holds that one login and no older ones.
- "Shop" does not mean the number on the bill header. The Shop WhatsApp number is 79705 50954.
- Two senders, two jobs: bills from the panel's WhatsApp page go from Tony on Railway (`whatsapp-bills`); a ledger's Share to WhatsApp goes from Shop, also on Railway (`whatsapp-reminders`). Neither needs the shop PC on.

## Not a shop sender

`Mesh_Hack/worker` also uses Baileys. It is a separate project, and which number it uses was not checked.

## WhatsApp group printing

Since 2026-11-25 the shop group prints again, from Railway, with no WhatsApp link on the shop PC:

```text
Shop group (WhatsApp)
  -> Railway whatsapp-reminders (Shop number, group-print.mjs)
       downloads the photo / PDF, uploads it to Convex storage,
       queues a raw-file print job addressed to shiv-shop-printer
  -> shop PC print server (watches the queue live, SHIV_DEVICE_TOKEN in print-server/.env.local)
  -> HP (bw) or Epson (cp), each falling back to the other
```

- Photo or PDF with `bw` / `cp` in the caption: prints at once.
- Without a caption: waits up to 10 minutes for `bw` / `cp` from the same person.
- `bw` / `cp` sent as a reply to a photo or PDF: prints that one.
- An SBI PDF (`SBIDocument_*.pdf`) prints as soon as it is posted, black and white, with no `bw` / `cp` (Railway variable `PRINT_AUTO_NAMES`, "pattern=mode" pairs split by ";"; "off" for none). Group only: a PDF sent straight to the Shop number does not print.

Railway variables on `whatsapp-reminders`: `CONVEX_URL` (production), `SHIV_DEVICE_TOKEN` (a server key from `npx convex run --prod devices:issueServerKey '{"name":"whatsapp-print"}'`), `PRINT_GROUP_ID` (defaults to `SHOP_GROUP_ID`; the "Shiv Hardware" group is `120363396348781660@g.us`), optional `PRINTER_ID` (default `shiv-shop-printer`). Missing any of the first three, printing stays off and `/status` says which under `groupPrint.missing`.

The old way (the print server's own WhatsApp link, `WHATSAPP_AUTO_PRINT_ENABLED`) stays off. Turning it on as well would print everything twice.

### Supplier chats (auto-print, Tony's number)

Since 2026-11-26 the paper bills (handwritten slips) posted in the supplier
chat **"Simran Ply Rajan Rnc Pulkari Sunmica"** print at the shop by
themselves, black and white on the HP (falling back to the Epson), with no
`bw` needed (owner's ask). A `bw` / `cp` caption still decides the colour.

Only the slips: the owner wants "only this typo paper", and "no ai". So the
print server looks at each photo's colours (`print-server/paper-check.mjs`):
it prints when the photo is mostly pale, colourless paper and not a made
image on pure white; a vehicle, goods or person photo is skipped and logged
(`[cloud-print] ... skipped, not a paper slip`). PDFs from the chat always
print. Tuned on the chat's two real slips; a very pale design or a screenshot
of a white page can still pass, and a slip shot in deep shadow could be
skipped. If the check itself fails, the photo prints. The chat is in Tony's WhatsApp (80928 50954), not the Shop number's,
so `whatsapp-bills` reads it, with the same `group-print.mjs` as
`whatsapp-reminders` (a copy: change one, copy it to the other). It finds the
chat by its name and logs its id (`[print] auto-print chat ... is ...@g.us`).

- To add or change chats: Railway variable `PRINT_AUTO_CHATS` on
  `whatsapp-bills`, "chat name or id=bw|color" split by ";" ("off" for none);
  add ",paper" (as in `=bw,paper`) for paper slips only, or leave it off to
  print every photo.
  Without it the Simran Ply chat above is the default. A renamed group needs
  its new name, or its id, there.
- The shop group is never read by `whatsapp-bills` (Tony is in it too), so it
  does not print twice.

## Linking a number (both Railway services)

Since 2026-11-25, `whatsapp-reminders` (Shop) and `whatsapp-bills` (Tony) connect the same way, following https://baileys.wiki/:

- **Two ways to link**, both on `/login?key=LOGIN_KEY`: scan the QR, or press "Link with phone number instead", get the 8-character code and type it on the phone (WhatsApp, Linked devices, Link a device, Link with phone number instead). Each service only takes its own number (Shop 917970550954, Tony 918092850954). A code lasts about 3 minutes.
- **Right after a scan or code** WhatsApp closes the connection once on purpose ("restart required", 515); the service reconnects at once.
- **The login is kept in SQLite**, `AUTH_DIR/session.db` (`auth-store.mjs`, the same file in both folders), not as a folder of JSON files: the wiki calls the file store "not recommended for deployment in production". On the first start after the change the old files were read in as needed, so no number had to be linked again. A logout puts the whole folder aside (database included) and shows a new QR.
- **Resends**: sent messages are kept for WhatsApp's retry requests (`getMessage`, `msgRetryCounterCache`), and the Shop group's details are cached (`cachedGroupMetadata`).
- **Version**: Baileys' own WhatsApp Web version. Tony's service used to fetch WhatsApp's newest one at every start (`fetchLatestWaWebVersion`), and its links were thrown out right after a scan (22 and 25 Nov 2026).
- **Drop alerts** (`link-watch.mjs`, the same file in both folders): each service reads the other's `/health` once a minute. When the other has not been linked for 10 minutes, one WhatsApp message goes to `ALERT_TO` (the owner's chat, `TO_NUMBER`) with the other's login link; when it is linked again, one more says so. Railway variables `WATCH_HEALTH_URL`, `WATCH_LOGIN_URL` (a reference to the other service's `LOGIN_KEY`), `WATCH_NAME`. If both are down at once, nothing can be sent.
- **Deploys never run two copies at once.** Railway stops the old deployment before starting the new one for a service with a volume ("we prevent multiple deployments from being active and mounted to the same service"), so a deploy cannot cause a WhatsApp "conflict"; it costs a few seconds offline.

## Order photos typed out (since 2026-11-27)

In the shop group, a photo of a bill or order slip with "order" in its caption
(or "order" sent as a reply to it, or right after it by the same person) is not
printed: it goes to the shop PC's print server, where Claude Code (the desktop
app's own `claude.exe`, `print-server/order-read.mjs`) reads the handwriting,
and the Shop number posts the lines back as a reply to the photo:
`<item as written> - <qty>`, no rates or totals. Add "bw" / "cp" to the caption
to print it as well. Claude on the PC must be signed in once: run that
`claude.exe` in a terminal and `/login`. If it is not, the group gets "Could not
read this photo: ...". `ORDER_READ_MODEL` in the print server's `.env.local`
picks the model (default sonnet).

Signed in on the shop PC on 27 Nov 2026 (the sign-in is kept in
`%USERPROFILE%\.claude`, so the print server's headless runs use it). Tested on
real slips: a two-page hardware bill came back as all 21 item lines, labour
and totals left out, and the pink estimate slip as "DDLNT 3D 107 75x39 6/8 -
1 pc". Sonnet takes 16-23 s a photo. Haiku was tried and was no faster but
misread codes and words (3D107 as 32107, Aldrop as Alchop), so stay on sonnet.
After a Claude desktop app update the newest `claude.exe` is picked
automatically; if a new copy ever says "Not logged in", sign in again as above.