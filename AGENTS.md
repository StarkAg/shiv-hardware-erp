# Working in this repo

This repo is worked on from two computers (a Mac and the shop PC), often by AI
sessions on both at once. Every 5 minutes, each computer copies its uncommitted and
unpushed work to the private repo StarkAg/wip-backups (see `scripts/autosave.mjs`, a
copy of the tool there).

- Start of work: `npm run sync`. It pulls `main` and lists anything the other
  computer has not committed.
- Deploy Convex only with `npm run deploy:convex`, never a bare `npx convex deploy`.
  A Convex deploy replaces the whole function set, so deploying from a tree that
  lacks the other computer's files deletes those functions in production. The
  script refuses while anything is uncommitted, unpushed or behind here, or
  while the other computer has uncommitted work.
- Pushing deploys nothing. The panel website used to redeploy on every push,
  which spent Vercel's 100 deployments a day; `vercel.json` turns that off.
  Everything goes live with `npm run deploy` (it sends only the parts that
  changed; `-- --only panel` for the panel alone).
- The guarantee card is rendered by TWO separate apps that share one design: the
  gcvf QR link here (`qr-redirect/`, deployed with `npm run deploy -- --only qr`)
  and the Shiv Hardware shop site (separate repo StarkAg/shivhardware,
  `app/Gaurantee/[number]/page.jsx`, which auto-deploys on push). Any change to the
  guarantee card must be shipped to BOTH, or one link shows the old card: push for
  the shop site (its deploy is automatic) AND `npm run deploy -- --only qr` here.
- No emojis anywhere in the project: not in any app's screens, printed bills,
  generated HTML, WhatsApp text or log lines. Use an icon: lucide-react in the
  panel (`src/`), the app's own inline SVG icons in cash-web, order-web, sort-web
  and the other small apps, and an inline `<svg>` in HTML strings. Symbols such as
  ✓ ✕ ★ ☀ ⚠ count as emojis. `npm run check:emoji` lists any that slip in; run
  it before committing UI work.
  One exception, asked for by the owner: `whatsapp-bills/server.mjs` greets a
  number it has not sent a bill to before with a smile and folded hands, then
  the visiting card, as the shop does by hand. They are written as code points.
- Commit and push each finished piece of work. To take one file the other computer
  has: `git checkout refs/wip-others/<computer> -- <file>` (after `npm run sync`).
- One look for every app: the "Signs" design language in `DESIGN.md` (white, black print,
  blue = do this, green = done, yellow = wait, red = delete; Barlow lettering; one action
  at the foot of the screen). New screens follow it; an app still in the older parchment
  and brass look is brought over whole, not mixed. `workshop-web/` is the working copy.
