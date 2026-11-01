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

Money goes through one register, Staff Payments. The tab reads
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

## The Pay button (added the same day, owner's ask)

On this month only, a blue Pay button pays the worker today's wages, any amount,
by cash or online, with an optional note (`attendance-web/src/PaySheet.jsx`).
It calls the register's own `staffPay.pay`, so it is the same payment as
Cashier: it lands in Staff Payments and the cash book, and is reversed there.

- Wages only, up to what is earned and not yet paid (`payableMax`). The sheet
  offers "Cut advance" (the register's `due`) and "Full wages" when they differ.
  More than that is an advance, given in Cashier.
- The server's refusals are shown as they come: a closed cash register day, a
  later payment already recorded, and so on.
- The payment reference is kept on the phone (`shiv-attendance:staff-payment-pending`)
  until the server confirms, so a lost answer is retried without paying twice.

## Every worker on one screen (same day, owner's ask)

The worker picker is gone. Pay lists every worker at once: at the top, what is
to pay across all staff and how much advance is out; then one row per worker
with a blue edge (to pay), yellow (advance left) or green (settled), the
figure, a line for the month (days, earned, given) and a Pay button on this
month. Tapping a name opens that worker's sum, payments, Tuesday pay and every
day underneath. A worker not in the register says so and has no Pay button.
