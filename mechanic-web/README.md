# Shiv Mechanic

Production: https://shivhardware-mechanic.vercel.app

A phone app for measurements on the panel's Work list. Sign in with the shop
PIN, choose the mechanic's name, and open an assigned order. Enter a width,
height and optional remark for each piece; extra pieces can be added on site.
The chosen unit applies to the entire visit. No bill prices or totals are shown.

`Send partial sizes` keeps the order in To measure. `Finish measurement` sends
the sizes and moves it to Measured. Both update the panel's Work list, visit
slip and bill form. Billed orders leave this app.

Entries are retained as drafts on this phone until the server confirms a send.
After the first online visit the app can reopen offline. Reconnect and tap Send
to submit a draft. A newer measurement from another device blocks an old draft
from overwriting it; review the draft and load the latest sizes before editing.
Selecting a name filters the list; it is not separate staff authentication.

## Development

Run `npm install` then `npm run dev` here. The public Convex URL defaults to the
shop backend and can be overridden with `VITE_CONVEX_URL`. `npm run build`
creates `dist`. Run `npm run icons` to rebuild the ruler icons.

## Release

From the repository root, commit and push, then use `npm run deploy:convex` for
the backend and `npm run deploy -- --yes --only mechanic,panel,counter` for the
sites. The mechanic Vercel project is `shivhardware-mechanic`. The deployment script's normal synchronization
checks must pass. Copy future PIN-screen changes with
`node scripts/copy-device-trust.mjs`.
