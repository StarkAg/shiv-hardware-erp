# Shiv Bill (bill-web): a sale bill from a phone

https://shivhardware-bill.vercel.app, built 2026-11-20 because the panel's
bill form is a desktop screen and is cramped on a phone.

One screen, in the Signs look:

- **Customer**: Walk-in (W/B, a cash sale, always paid in full), or an
  account picked from the books' Sundry Debtors (search by name, place or
  phone). A name not in the books opens a new account when the bill is saved.
- **Items**: item, qty, unit, rate; the amount is worked out.
- **Paid**: for an account, On account / Paid full / Part paid; when money is
  taken, UPI (to Bank) or Cash (to the drawer).
- **Save bill** at the foot. It calls `billLedger.postBill`, the same function
  as the panel's bill form, so the books give the number, post the voucher and
  keep the bill in the panel's day book. A retry after a lost answer sends the
  same bill id, so it cannot post twice.
- After saving: the number, the total, and Send on WhatsApp (a text bill).

While a bill is typed it is also sent to the counter's customer screen through
`customerScreen.show` (docs/customer-screen.md); Save shows Thank you there.

The draft is kept on the phone (localStorage) until New bill, so a reload or
a closed tab loses nothing. "Today on this phone" lists what this phone saved.

Not in it (use the panel): discounts and round-off, GST, B/f old dues,
purchases and other vouchers, printing, catalogue items with sizes.

Deploy: `npm run deploy -- --only bill`. PIN screen app name: `Bill`.
