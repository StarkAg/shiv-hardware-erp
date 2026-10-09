# QR short link

The short address printed in guarantee-card QR codes: `<host>/<card number>/<card secret>`.

- **A card's first 20 days** (from when it was generated, i.e. first saved to the cloud, not
  the date printed on it): a temporary (307) redirect to
  `https://www.shivhardware.store/Gaurantee/<number>?k=<secret>`, the branded page.
- **After that:** the card is shown by this project's own page (`src/`, a small Vite +
  React app). It is fully separate from the shop's site: it loads the card and its
  claims straight from Convex, and nothing on it is proxied from, linked to or named
  after the shop. No header, footer, logo or shop name.
- **Old cards** whose QR prints `shivhardware.store/Gaurantee/...` directly: after their
  20 days that page redirects them here with `?gc=1`, which is never sent back.
- Anything else shows a plain "scan the QR on your card" page.

The card page here is a copy of the one on shivhardware.store (`app/Gaurantee`) minus
its branding. A change to the card's look or the claim form goes in both.
`BRANDED_DAYS` here must match `BRANDED_DAYS` on the guarantee page (shivhardware.store).

Local: `npm install && npm run dev`. Deploy: `npx vercel deploy --prod --yes` from this
folder (Vercel project `gcvf`; vercel.json sets the Vite build). Printed cards depend on
this staying up and on the domain being renewed.
