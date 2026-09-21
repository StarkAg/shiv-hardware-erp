/**
 * What a month comes to for one staff member.
 *
 * Kept apart from the screen because it is the only part of this app that
 * decides what somebody is paid, and a rule about money should be checkable
 * without rendering anything. tests/attendancePay.test.ts exercises it.
 *
 * THE RULE
 * Tuesday is the shop's weekly holiday. It is paid, but only to somebody who
 * has earned it, and there are two conditions rather than one:
 *
 *   1. twenty days attended in the month, a half day counting as half; and
 *   2. a full day present on EVERY Monday and EVERY Wednesday of that month.
 *
 * The second condition is what stops the holiday being stretched into a long
 * weekend from either side. It is strict on purpose: a half day satisfies
 * neither Monday nor Wednesday, even though its half still counts towards the
 * twenty, and one missed day of either kind costs the whole month's Tuesday
 * pay — not just the Tuesday beside it.
 *
 * Two things are deliberately not held against anybody. A day the shop was
 * shut cannot be attended, so a closed Monday is not a missed one. And a day
 * that has not happened yet cannot have been missed, so a month in progress
 * reports only what is already behind it, rather than showing the bonus as
 * lost from the first of the month.
 *
 * A Tuesday that is worked is not paid twice: it counts towards the twenty,
 * and the bonus pays every Tuesday in the month regardless, so it never enters
 * the base.
 */

export const ATTEND_THRESHOLD = 20;

/** 'P' full day · 'H' half day · 'C' shop closed · 'N' or '' not attended. */
const PRESENT = 'P';
const HALF = 'H';
const CLOSED = 'C';

const weight = (status) => (status === PRESENT ? 1 : status === HALF ? 0.5 : 0);

/**
 * @param entries  [{ date: Date, status, future?: boolean }] — every day of the month
 * @param rate     the day's pay
 * @param advances already drawn this month
 */
export function monthPay({ entries, rate = 0, advances = 0 }) {
  let attended = 0;
  let paidDays = 0;
  let tuesdays = 0;
  const missed = [];

  for (const { date, status, future } of entries) {
    const day = date.getDay();
    if (day === 2) tuesdays += 1;

    if ((day === 1 || day === 3) && !future && status !== PRESENT && status !== CLOSED) {
      missed.push(date);
    }

    const w = weight(status);
    if (!w) continue;
    attended += w;
    if (day !== 2) paidDays += w;
  }

  const enough = attended >= ATTEND_THRESHOLD;
  const unlocked = enough && missed.length === 0;
  const base = paidDays * rate;
  const tueBonus = unlocked ? tuesdays * rate : 0;

  return {
    attended,
    paidDays,
    tuesdays,
    enough,
    missed,
    unlocked,
    base,
    tueBonus,
    advTotal: advances,
    net: base + tueBonus - advances,
  };
}
