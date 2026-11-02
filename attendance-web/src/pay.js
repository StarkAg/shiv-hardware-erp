/**
 * What a month comes to for one staff member.
 *
 * Kept apart from the screen because it is the only part of this app that
 * decides what somebody is paid, and a rule about money should be checkable
 * without rendering anything. tests/attendancePay.test.ts exercises it.
 *
 * THE LADDER (owner's ask, 2 Nov 2026)
 * Attendance is a share of the month's OPEN days: every day except Tuesdays
 * (the weekly holiday) and days marked closed. A half day counts as half, and
 * a Tuesday that is worked counts as an extra day on top. Each step's days are
 * the share of the open days, rounded DOWN to the half day, so rounding always
 * goes the worker's way.
 *
 *   77%  Tuesday pay, never asking more than 20 days (a fixed 20 used to be
 *        87% in a month the shop shut for festivals)
 *   81%  Tuesday pay + ₹300
 *   85%  Tuesday pay + ₹500 (the top: nothing more for coming every day)
 *
 * The ladder stops at 85% on purpose. The owner wants a steady team of about
 * 22 days each, not everyone every day; a day past that is a wage paid on a
 * day the shop may not need it.
 *
 * And on top of the days, a full day present on EVERY Monday and EVERY
 * Wednesday of the month. This is what stops the holiday being stretched into
 * a long weekend from either side. It is strict on purpose (owner's word,
 * 2 Nov 2026: mandatory): a half day satisfies neither, and one missed day of
 * either kind costs the whole month's Tuesday pay and the bonus with it.
 *
 * Two things are deliberately not held against anybody. A day the shop was
 * shut cannot be attended, so it is neither open nor missed. And a day that
 * has not happened yet cannot have been missed, so a month in progress
 * reports only what is already behind it.
 *
 * A Tuesday that is worked is not paid twice: it counts towards attendance,
 * and Tuesday pay covers every Tuesday kept, so it never enters the base.
 */

export const TUESDAY_SHARE = 0.77;
export const TUESDAY_MAX_DAYS = 20;
export const BONUS_STEPS = [
  { share: 0.81, amount: 300 },
  { share: 0.85, amount: 500 },
];

/** 'P' full day · 'H' half day · 'C' shop closed · 'N' or '' not attended. */
const PRESENT = 'P';
const HALF = 'H';
const CLOSED = 'C';

const weight = (status) => (status === PRESENT ? 1 : status === HALF ? 0.5 : 0);
// The epsilon keeps 0.85 x 20 from landing a hair under 17.
const downToHalf = (n) => Math.floor(n * 2 + 1e-9) / 2;

/** Days needed for each step, for a month with `open` open days. */
export function ladderFor(open) {
  return {
    tuesday: Math.min(TUESDAY_MAX_DAYS, downToHalf(open * TUESDAY_SHARE)),
    bonus: BONUS_STEPS.map((s) => ({ amount: s.amount, need: downToHalf(open * s.share) })),
  };
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** 20.5 as "20½". */
export const halves = (n) => `${Math.floor(n)}${n % 1 ? '½' : ''}`;

/**
 * Where somebody stands on the ladder, in days, for screens any phone can see:
 * no wage or rate in it, only the fixed bonus amounts everybody is told.
 */
export function ladderLine(r) {
  if (r.missed.length) {
    return `No Tuesday pay this month: ${r.missed.map((d) => `${WD[d.getDay()]} ${d.getDate()}`).join(', ')} not a full day`;
  }
  const goals = [
    { need: r.need, say: 'Tuesday pay', reached: r.enough },
    ...r.steps.map((s) => ({ need: s.need, say: `₹${s.amount}`, reached: s.reached })),
  ];
  const parts = goals.filter((g) => g.reached).map((g) => `${g.say} ✓`);
  const next = goals.find((g) => !g.reached && r.best >= g.need);
  if (next) {
    const more = next.need - r.attended;
    parts.push(`${halves(more)} more day${more === 1 ? '' : 's'} for ${next.say}`);
  } else if (!parts.length) {
    parts.push(`Tuesday pay needs ${halves(r.need)} days`);
  }
  return parts.join(' · ');
}

/**
 * @param entries  [{ date: Date, status, future?: boolean }] — every day of the month
 * @param rate     the day's pay
 * @param advances already drawn this month
 */
export function monthPay({ entries, rate = 0, advances = 0 }) {
  let attended = 0;
  let paidDays = 0;
  let open = 0;
  let openPast = 0;
  let attendedOpen = 0;
  let openAhead = 0;
  let tuesdays = 0;
  const missed = [];

  for (const { date, status, future } of entries) {
    const day = date.getDay();
    const isTue = day === 2;
    if (isTue) tuesdays += 1;
    if ((day === 1 || day === 3) && !future && status !== PRESENT && status !== CLOSED) {
      missed.push(date);
    }
    const w = weight(status);
    if (!isTue && status !== CLOSED) {
      open += 1;
      if (future) openAhead += 1;
      else { openPast += 1; attendedOpen += w; }
    }
    if (!w) continue;
    attended += w;
    if (!isTue) paidDays += w;
  }

  const ladder = ladderFor(open);
  const enough = attended >= ladder.tuesday;
  const unlocked = enough && missed.length === 0;
  const steps = ladder.bonus.map((s) => ({ ...s, reached: attended >= s.need }));
  // Each step is Tuesday pay plus its bonus, so the bonus needs Tuesday pay.
  const bonus = unlocked ? steps.reduce((n, s) => (s.reached ? s.amount : n), 0) : 0;
  const base = paidDays * rate;
  const tueBonus = unlocked ? tuesdays * rate : 0;
  // The most attendance the rest of the month can still reach.
  const best = attended + openAhead;

  return {
    attended,
    paidDays,
    open,
    share: openPast ? attendedOpen / openPast : 0,
    leaves: openPast - attendedOpen,
    best,
    need: ladder.tuesday,
    steps,
    tuesdays,
    missed,
    enough,
    unlocked,
    base,
    tueBonus,
    bonus,
    advTotal: advances,
    net: base + tueBonus + bonus - advances,
  };
}
