/**
 * The shop's calendar date, which is India's whatever the device says.
 *
 * `new Date().toISOString().slice(0, 10)` is the date in London: before 05:30
 * in the morning it is still yesterday there, so a bill written at 02:00 was
 * dated the day before — and on 1 April, in the year before. The device's own
 * clock is no better on a PC left on another time zone. Every "today" in the
 * panel comes from here.
 */
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** YYYY-MM-DD in India for a moment (now by default). */
export function indiaDate(at: Date | number = Date.now()): string {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Today in India, YYYY-MM-DD. */
export const indiaToday = () => indiaDate()

/** Today in India as the books store a date: midnight UTC of that day. */
export const indiaTodayMs = () => Date.parse(`${indiaToday()}T00:00:00Z`)

/** This year in India. */
export const indiaYear = () => Number(indiaToday().slice(0, 4))
