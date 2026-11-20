# The customer's screen (second display of the counter POS)

Bought for the till: a Posiflex dual-screen touch POS. Its second display
faces the customer. Windows sees it as a second monitor once it is set to
**Extend** (Win + P, Extend). A model with only a 2-line pole display (PD
series, on a COM port) is a different thing and is not covered here.

## What it shows

- No bill open: the shop's logo and name, "Welcome".
- A sale or quotation being typed: every line (item, qty, rate, amount), the
  newest lit yellow for a moment, then discount/GST/round-off and the total
  in big figures. With money taken: Paid and Balance.
- A UPI code for the amount due, to the shop's UPI ID 8709964141@ptyes
  (`VITE_SHOP_UPI_ID` overrides it; `VITE_SHOP_UPI_NAME` the payee name).
- The sale saved: "Thank you", the total, for 8 seconds, then back to the name.

Purchases, payments and the other vouchers never reach it.

## How it works

- Page: `#/customer` (`src/features/customer/CustomerScreen.tsx`). It only reads.
- The bill form (`BillBuilder`) sends what it shows through
  `src/lib/customerDisplay.ts`: Electron IPC in the desktop app, a
  BroadcastChannel and localStorage in a browser. Nothing goes to a server.
- The desktop panel (`electron/main.cjs`) finds the monitor it is not on,
  and opens `#/customer` there full screen, unfocusable (a customer's tap
  never takes the keyboard from the counter). It looks again when a monitor
  is plugged in or taken away. One monitor: nothing opens.
- `SHIV_CUSTOMER_SCREEN=window` opens it as an ordinary window instead (to
  try on a one-screen PC); `=off` never opens it.

## Showing it without the POS

In a browser: `npm run dev`, then two windows side by side,
`http://localhost:5180/#/bills` and `http://localhost:5180/#/customer`.
Start a sale in the first; the second follows.

In the desktop app on one screen:
`SHIV_CUSTOMER_SCREEN=window npm run desktop:dev`.
