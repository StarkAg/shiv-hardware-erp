# QR short link

The short address printed in guarantee-card QR codes: `<host>/<card number>/<card secret>`.

- **A card's first 20 days** (from its own date): a temporary (307) redirect to
  `https://www.shivhardware.store/Gaurantee/<number>?k=<secret>`, the branded page.
- **After that:** the card is served from this host, so the shop's site never shows in
  the address bar. `middleware.js` proxies the same page (neutral by then) and
  `vercel.json` proxies its scripts and images. One page to maintain.
- **Old cards** whose QR prints `shivhardware.store/Gaurantee/...` directly: after their
  20 days that page redirects them here (`?gc=1`), so the shop's address goes too.
  Requests proxied from here carry `gc=1` so the page never sends them back.
- Anything else shows a plain page (`index.html`).

`BRANDED_DAYS` here must match `BRANDED_DAYS` on the guarantee page (shivhardware.store).
Deploy: `npx vercel deploy --prod --yes` from this folder (Vercel project `gcvf`).
Printed cards depend on this staying up and on the domain being renewed.
