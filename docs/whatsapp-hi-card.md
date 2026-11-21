# Hi on WhatsApp, card back

Added 2026-11-21, asked for by the owner: the fastest way for a customer to get
the shop's visiting card.

## What the customer does

Scans the counter sign (`docs/whatsapp-hi/sign-a5.pdf`, print on A5). WhatsApp
opens Tony's chat (+91 80928 50954) with "Hi" already typed; they tap Send.
The link inside the QR is `https://wa.me/918092850954?text=Hi`, which also works
as a plain link (Instagram bio, Google listing, a text message).

## What comes back

From Tony's number, within a few seconds: a smile, folded hands, then the
visiting card (`whatsapp-bills/visiting-card.jpg`). It is the same greeting a
new customer gets before their first bill. Done by the Railway service
`whatsapp-bills` (the "hi-reply" in `server.mjs`), so the shop PC can be off.

## Who gets it

- Only a message that is a greeting and nothing more: hi, hii, hello, hey,
  namaste, namaskar, good morning, jai shri ram, नमस्ते, with "sir", "ji",
  "bhaiya", "Shiv Hardware" and the like around it. "Hi, rate of hinges?" is
  left to the owner.
- Once per number, ever. The numbers already greeted (by a hi, a bill or Shiv
  Intro) are kept in `/data/greeted.json` on the service's volume.
- Never a chat the owner has written to since this went live (from his phone
  or from the panel): those are kept in the same file. A friend who writes "hi"
  before the owner has ever written to them since then will get the card once.
- Personal chats only, not groups. A hi older than 6 hours (the link was down)
  is left to the owner.
- Day or night: the customer has just written, so it answers at once. Bills
  still keep the 9 am to 9 pm rule.

To let a number have the card again, take it out of `/data/greeted.json`.
