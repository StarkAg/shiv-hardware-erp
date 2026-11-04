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

- Wages only, up to what is earned and not yet paid (`payableMax`). More than
  that is an advance, given in Cashier.
- Staff are paid at the end of each day, so the box opens on **today's wage**
  (the register's `earnedToday`), or a full day at the rate while today is not
  marked. With an advance running it opens on the register's cut (`due`), as
  Cashier does. Buttons offer "Today's wage", "Cut advance" and "Everything
  owed" when they differ. (Before 1 Nov 2026 it opened on the whole balance,
  which offered ₹21,700 to a man paid daily.)
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

## History on the Pay screen (same day, owner's ask)

Under the staff list, "History, <month>" lists every pay event of the month
for all staff, newest first: wages and advances (date, shop time, cash or
online, note), payments reversed (on the day reversed, the struck-out payment
kept), rate changes and the day pay tracking began. It is built from the
register rows the screen already loads (`monthEvents` in `payBook.js`), so it
costs no extra read and shows exactly what the register holds. The app's
Change history (the clock in the header) keeps logging the same payments too.

## The attendance ladder (2 Nov 2026, owner's ask)

Tuesday pay became the first step of a ladder, worked out in
`attendance-web/src/pay.js` (`monthPay`, `ladderFor`) and pinned by
`tests/attendancePay.test.ts`. Attendance is a share of the month's open days:
every day but Tuesdays and days marked closed. Each step is rounded down to the
half day.

| Step | Share | 26 open days | Pays |
|---|---|---|---|
| 1 | 77%, never more than 20 days | 20 | Tuesday pay |
| 2 | 81% | 21 | Tuesday pay + ₹300 |
| 3 | 85% | 22 | Tuesday pay + ₹500 |

- Tuesday pay is earned week by week (owner's word, 4 Nov 2026): each Tuesday
  needs a full day on the Monday before and the Wednesday after. A miss loses
  that one Tuesday, and any miss in the month loses the bonus. The month's days
  above are still needed for any Tuesday pay. Only days inside the month are
  checked, so a Tuesday at the month's edge answers for the side it can see.
- It stops at 85% on purpose: the owner wants about 22 days from each, not
  everyone every day.
- The bonus, like Tuesday pay, is not in the register and stays out of the sum.
- The Bonus tab (no PIN, `attendance-web/src/Bonus.jsx`) shows the month's
  steps in days, then each worker's climb with a mark at each step, a line in
  days such as "Tuesday pay ✓ · 1 more day for ₹500" or "3rd Nov Tuesday lost",
  and every Monday and Wednesday of the month (green kept, yellow missed). The
  steps show their share beside the days. Stats shows each worker's %
  of open days. No wage or rate on either, only the fixed bonus amounts. Pay
  (PIN) shows the three steps with rupees.
- Run on May to Oct 2026 marks, before the week-by-week change: Tuesday pay
  unchanged (₹19,620), bonus ₹3,000 in all, ₹1,500 of it in October.
