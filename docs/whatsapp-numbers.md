# WhatsApp numbers

Which number sends what. Checked 2026-10-30. Update this file when a link changes.

| Label | Number | Sends from | What it sends | Checked how |
|---|---|---|---|---|
| Tony | +91 80928 50954 | Railway `whatsapp-bills` (`/data/auth`) | Sale bills, receipts and quotations to customers' chats | Service `/health` and the saved login on the volume |
| Shop | +91 79705 50954 | Shop PC, `print-server` (`data/baileys-auth`) | Ledger "Share to WhatsApp" PDFs, quotation and attachment shares, guarantee messages, the auto-reply | The owner sees ledger shares come from this number, and the code sends them through the shop PC (`LedgerView.jsx`, `/whatsapp-send-document`). The digits are in no repo, Convex variable or Railway variable, because the number comes from the login on the PC |
| Meta (C) | Not looked up, ID `1348201888369392` | Convex `convex/whatsapp.ts` | Guarantee cards sent from the panel | Convex variable `WHATSAPP_PHONE_NUMBER_ID` |
| Twilio | +91 98357 16123 | Convex `convex/twilio.ts` | One notice when a template is approved | Convex variable `TWILIO_WHATSAPP_FROM` |

## Birthday reminders

Railway service `whatsapp-reminders` sends the GradeX birthdays to 87099 64141 at 12:00 am India time. It is meant to be linked to Shop as its own linked device, separate from the shop PC's link, so it works with the PC off. It sends only when the linked number is `FROM_NUMBER` (917970550954), and sends nothing on the day it is first linked. Scan the QR at `/login?key=LOGIN_KEY` (`railway variables --service whatsapp-reminders --kv`). To change the list, edit `whatsapp-reminders/birthdays.json`, then `npm run deploy -- --only whatsapp-reminders`.

## Still open

- **Shop PC:** to confirm the number directly, read `me.id` in `print-server/data/baileys-auth/creds.json` on the PC. `/whatsapp-web/status` does not report it.
- **Railway `whatsapp-bridge`:** never deployed, but `whatsapp-bridge-volume` (mounted at `/app/store`) holds 150 MB. It may be an old WhatsApp login. Nothing is running to read it with, so reading it needs a temporary deployment.
- **+91 98353 50954:** printed on bills as "Shop" (`src/lib/types.ts`). No sender is known to use it, and it is not the Shop WhatsApp number above.

## Confusions already settled

- "The number that sends the bill pics" is Tony today: `whatsapp-bills` holds that one login and no older ones.
- "Shop" does not mean the number on the bill header. The Shop WhatsApp number is 79705 50954.
- Two senders, two jobs: bills from the panel's WhatsApp page go from Tony on Railway; a ledger's Share to WhatsApp goes from Shop on the shop PC, so it needs the PC on.

## Not a shop sender

`Mesh_Hack/worker` also uses Baileys. It is a separate project, and which number it uses was not checked.
