# Shiv Hardware ERP

The working software of **Shiv Hardware Store**, Ramgarh Cantt — a hardware shop that
sells doors, boards, windows and the fittings that go with them.

It began as a replacement for four Excel files that produced quotations and guarantee
cards. It now keeps the shop's books: bills, party accounts, purchases, receipts and
payments, the cash drawer, attendance and the catalogue, on one Convex database that
every screen and every device reads.

> Private repository. It holds the shop's live configuration, including deployment
> credentials and third-party API keys. See [Configuration](#configuration).

---

## The parts

| Directory | What it is | Runs as |
|---|---|---|
| [`src/`](src/) | **The panel.** Day book, bill builder, Bill Flow intake and fulfillment, party accounts, account masters, trash, cash review, quotations, guarantee cards, inventory, rates, toto. React + TypeScript + Vite + Tailwind, HashRouter so it works from `file://` too. | Web (Vercel), desktop (Electron), Android (Capacitor) |
| [`convex/`](convex/) | **The books and the backend.** Vouchers and their Dr/Cr lines, ledgers and groups, the bill snapshot, trash, cash sync, the photo-bill reader, attendance, WhatsApp and Twilio. | Convex |
| [`cash-web/`](cash-web/) | **The cash book.** The counter's drawer, keyboard-first and offline-first, one line per note; it syncs through `convex/cash.ts` and posts Receipts and Payments into the books. Optional multi-page bill photos queue offline and appear in Bill Flow intake. | PWA (Vercel) |
| [`stock-web/`](stock-web/) | **The stock panel.** Catalogue and rates on a laptop, one Convex row. | PWA (Vercel) |
| [`attendance-web/`](attendance-web/) | **Attendance.** Who came in, and when. | PWA (Vercel) |
| [`voucher-web/`](voucher-web/) | **Voucher Bill Shooter.** Phone camera for photos to attach to a voucher. Its waiting queue is separate from bill sorting. | Web (Vercel) |
| [`sort-web/`](sort-web/) | **Bill sorting.** Photograph and name the old paper backlog, then place it by bookmark. | Web (Vercel) |
| [`cloud-api/`](cloud-api/) | Small relay the phone-side flows call when the shop machine is not reachable. | Node (Railway) |
| [`print-server/`](print-server/) | The shop machine's own service: printing, WhatsApp sending, and reading a photographed bill. | Node, on the shop PC |
| [`electron/`](electron/) · [`android/`](android/) | Desktop and Android wrappers around the same panel build. | — |
| [`tests/`](tests/) | Convex tests — posting, numbering, deletions, the drawer. | `npm test` |
| [`docs/`](docs/) | [Integration review](docs/INTEGRATION_REVIEW.md) — what is and is not joined up, ranked. | — |

---

## How the books work

The shop runs on Tally's model, because that is the model the accountant already knows.

- Every transaction is a **voucher** of a type — Sale, Purchase, Receipt, Payment, Goods
  Return, Purchase Return, Discount, Expense — with balanced **Dr/Cr lines** under it.
  Nothing that does not balance is written: [`convex/lib/entries.ts`](convex/lib/entries.ts)
  refuses it.
- **A bill and its voucher are one save.** [`convex/billLedger.ts`](convex/billLedger.ts)
  opens the party's account if it is new, writes the voucher, writes its lines and writes
  the bill itself in a single Convex transaction — all of it or none of it. A failure
  keeps the bill on the device that typed it, marked unposted and held back from sync,
  with a retry in the day book. "Saved" means the books took it.
- **Numbers come from the server.** One counter per voucher series per financial year,
  one for bill numbers, and each checked against what is already used — live and in the
  trash — before it is issued: [`convex/lib/numbering.ts`](convex/lib/numbering.ts). Two
  counters saving at the same moment cannot collide.
- **Part payment rides on the same voucher.** ₹10,000 sold with ₹4,000 in hand is
  `Dr Customer 6,000 · Dr Cash 4,000 · Cr Sales 10,000` — one document to edit, delete
  or restore.
- **Deleting is reversible and travels.** A deleted bill and its voucher go to a shared
  Trash together and come back together. A tombstone outlives the trash row, so a delete
  on one counter removes it on the other and a stale device cannot push it back.
- **The drawer is part of the books.** Every cash note posts itself as a Receipt or a
  Payment when it syncs ([`convex/cash.ts`](convex/cash.ts)); notes naming somebody the
  books do not know wait in **Cash Review** rather than having an account invented for
  them.

What is not done yet is written down honestly in the
[integration review](docs/INTEGRATION_REVIEW.md): stock is still a catalogue rather than
a quantity ledger, receipts are not allocated against individual bills, there is no
period lock, and there is no per-person sign-in.

---

## Running it

```bash
npm install
npm run dev          # the panel on http://localhost:5180
npm test             # Convex tests (vitest + convex-test)
npm run lint         # tsc --noEmit
npm run build        # production build into dist/
```

On the shop's Wi-Fi, `npm run dev -- --host` serves the panel to the other counter at
`http://<this-machine-ip>:5180`. Camera capture needs a secure context, so the phone
must use the hosted app rather than the plain HTTP address.

**Backend**

```bash
npx convex dev                 # schema + functions against the dev deployment
npm run deploy:convex          # push to production (refuses if either computer has unsaved work)
```

**Two computers**

```bash
npm run sync                   # start of work: pull main, list the other computer's uncommitted files
```

Each computer runs StarkAg/wip-backups (set up once per computer, see its README), which
copies every repo's uncommitted work to that private repo every 5 minutes.

> `npx convex dev` rewrites `VITE_CONVEX_URL` in `.env.local` to the dev deployment.
> Put it back before building, or the build ships an app that writes to the wrong
> database.

**The shop machine**

```bash
npm run shop                   # panel + print server together
npm run print:server           # print server alone, on :3333
```

**Everything else**

```bash
npm --prefix cash-web run dev
npm --prefix stock-web run dev
npm --prefix attendance-web run dev
npm run cloud:api
```

**Desktop and Android**

```bash
npm run desktop:dev            # Electron against a fresh build
npm run dist:win               # Windows installer
npm run android:apk            # debug APK through Capacitor
```

---

## Deploying

One command for every part — Convex, the Railway services, each Vercel site and its
shop domain, the QR link, the Quotation app on the shop PC and the desktop release
for the counters:

```bash
npm run deploy               # shows what changed since each part last went out, asks, deploys those
npm run deploy -- --dry-run  # the plan only
npm run deploy -- --only cash,qr
npm run deploy -- --list     # every part and where it lives
```

It reads "last deployed" from where each part actually lives (Vercel, Railway, the
GitHub releases, the installed app), so it is right from any machine. It deploys
what is committed on `main`, pushing first if needed. Sites are always deployed with
their Vercel project named outright and their `shivhardware-*` domain moved onto the
new build. The per-app `npm run deploy` scripts still work for one-offs.

Convex must go out with the panel when a function's arguments change, and open tabs
need a reload.

The voucher shooter is a separate project at `https://shivhardware-voucher.vercel.app`.
Deploy the `voucherInbox` functions before its first use, then run
`npm --prefix voucher-web run deploy`. On the bill or voucher editor, open the photo
control and select the new image under **From the phone**. The sorting site uses
its own backlog workflow.

---

## Configuration

Environment files are committed deliberately, so a fresh machine can run the shop
without hunting for values. **They contain live credentials** — a Convex deployment key,
the cloud relay key, and Anthropic and Sarvam API keys that bill by use. That is safe
only while this repository stays private and single-owner. If it is ever made public, or
a collaborator is added, rotate every key first.

| File | Holds |
|---|---|
| `.env.local` | `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, cloud relay URL and key |
| `cash-web/.env`, `stock-web/.env`, `attendance-web/.env` | the Convex URL each PWA talks to |
| `cloud-api/.env` | Convex URL, relay key, port |
| `print-server/.env` | printer names, relay credentials, `ANTHROPIC_API_KEY`, `SARVAM_API_KEY` |

Server-side secrets that never belong in the bundle — the ledger PIN, Twilio and
WhatsApp credentials — live in the Convex dashboard's environment, not in these files.

---

## Conventions

- **Comments explain why, not what.** A comment on a fix says what went wrong and what
  it cost, so the next person does not undo it.
- **No hand-holding text on screen.** The staff are trained; a caption under every
  figure is one more thing between them and the number.
- **Lucide icons only**, never emoji, in the interface or on paper.
- **One palette.** Colours are tokens in [`src/index.css`](src/index.css), light and dark,
  every pair measured at 4.5:1 or better. Chart series are checked for colour-blind
  separation rather than chosen by eye.
- **Print layouts are the shop's paper.** [`src/features/print/`](src/features/print/)
  and [`src/lib/billHtml.ts`](src/lib/billHtml.ts) change only when the paper is meant
  to change.

---

## Tests

`npm test` runs the Convex suite against an in-memory deployment — posting and
re-posting, concurrent numbering, refused saves, deletions between devices, the trash
pair, part payments and the cash drawer. They use synthetic records; no real
transaction is touched.
