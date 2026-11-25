# WhatsApp numbers

Which number sends what. Checked 2026-10-30. Update this file when a link changes.

| Label | Number | Sends from | What it sends | Checked how |
|---|---|---|---|---|
| Tony | +91 80928 50954 | Railway `whatsapp-bills` (`/data/auth`) | Sale bills, receipts and quotations to customers' chats; the greeting and visiting card back to a customer's first "hi" (`docs/whatsapp-hi-card.md`) | Service `/health` and the saved login on the volume |
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
