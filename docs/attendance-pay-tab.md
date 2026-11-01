# Attendance Pay tab: read only, from the Staff Payments register

Changed 1 Nov 2026 at the owner's ask ("we are not using that advance pay tab,
make it transparent and simple").

## What was wrong

The Pay tab worked out its own take-home and took its own advances, apart from
the real register (Cashier, Staff Payments, `convex/staffPay.ts`):

- For anyone set up in Staff Payments, an advance typed in the Pay tab was
  refused by the server (`attendance.addAdvance`), but the app swallowed the
  error, so the advance looked saved and was not.
- Its take-home added Tuesday pay; the register does not, so the two screens
  could show different figures for the same person.
- Its Advances line was only the month's advances taken, not what is still owed.

## What it is now

Read only. Money is given in one place, Cashier, Staff Payments. The tab reads
`staffPay.board` as of the month's last day (today for this month), only while
Pay is open on a phone given the PIN, and shows for one worker:

1. The balance now: To pay (blue), Advance left (yellow) or Settled (green).
2. How it adds up: carried in + earned - wages paid - advances given = balance.
3. Every payment in the month, with cash or online and the note.
4. Tuesday pay, worked out by `attendance-web/src/pay.js` and kept OUT of the sum,
   because the register does not hold it.
5. Every day of the month: mark, earned, given, balance after.

The month is picked out of the register by `attendance-web/src/payBook.js`; the
screen is `attendance-web/src/PayView.jsx`. Daily rates are changed in Staff
Payments, not here. Staff not set up in the register show a line saying so.
