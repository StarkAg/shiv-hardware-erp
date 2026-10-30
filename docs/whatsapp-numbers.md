# WhatsApp numbers

Which number sends what. Checked 2026-10-30. Update this file when a link changes.

| Label | Number | Sends from | What it sends | Checked how |
|---|---|---|---|---|
| Tony | +91 80928 50954 | Railway `whatsapp-bills` (`/data/auth`) | Sale bills, receipts and quotations to customers' chats | Service `/health` and the saved login on the volume |
| Shop | +91 79705 50954 | Not found yet | Not known | Owner's contact card "Shiv Hardware Store Shop"; the digits are in no repo, Convex variable or Railway variable |
| Meta (C) | Not looked up, ID `1348201888369392` | Convex `convex/whatsapp.ts` | Guarantee cards sent from the panel | Convex variable `WHATSAPP_PHONE_NUMBER_ID` |
| Twilio | +91 98357 16123 | Convex `convex/twilio.ts` | One notice when a template is approved | Convex variable `TWILIO_WHATSAPP_FROM` |

## Still open

- **Shop PC (`print-server`, `data/baileys-auth`):** sends quotations to the shop group, the auto-reply and guarantee messages, and hosts auto-print. Its login is only on the PC, and `/whatsapp-web/status` does not report the number, so which number it uses is unconfirmed. Read `me.id` in `creds.json` on the PC to settle it.
- **Railway `whatsapp-bridge`:** never deployed, but `whatsapp-bridge-volume` (mounted at `/app/store`) holds 150 MB. It may be an old WhatsApp login. Nothing is running to read it with, so reading it needs a temporary deployment.
- **+91 98353 50954:** printed on bills as "Shop" (`src/lib/types.ts`). No sender is known to use it, and it is not the Shop WhatsApp number above.

## Confusions already settled

- "The number that sends the bill pics" is Tony today: `whatsapp-bills` holds that one login and no older ones.
- "Shop" does not mean the number on the bill header. The Shop WhatsApp number is 79705 50954.

## Not a shop sender

`Mesh_Hack/worker` also uses Baileys. It is a separate project, and which number it uses was not checked.
