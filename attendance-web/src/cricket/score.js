/**
 * Marks turned into cricket. Display only: nothing here is written anywhere, and
 * nothing here decides pay, which stays in ../pay.js.
 *
 * A present day is a four and a half day is a two, so a half keeps its true value
 * against a full day. The target is the Tuesday pay rule's twenty days, in runs.
 *
 * A good attender hits sixes: from the sixth present in a row, every present is a
 * six until the run breaks. A half day or an absence breaks it and the climb starts
 * again; a closed or unmarked day does not, and neither does the 1st of a month:
 * a run carries over from the month before (owner's ask, 1 Nov 2026). Only the
 * month before is loaded, so the run is counted back to its 1st at most.
 */
export const RUNS = { P: 4, H: 2 }
export const SIX_RUNS = 6
export const SIX_AFTER = 6
export const runsFor = (days) => days * RUNS.P

/** Presents in a row just before this day, back to the 1st of the month before. */
export function runBefore(statusFor, name, date) {
  let run = 0
  const stop = new Date(date.getFullYear(), date.getMonth() - 1, 1)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)
  for (; d >= stop; d.setDate(d.getDate() - 1)) {
    const st = statusFor(d, name)
    if (st === 'P') run++
    else if (st === 'H' || st === 'N') break
  }
  return run
}

/** How long the run is if this day is hit for six; otherwise 0. */
export function sixRun(statusFor, name, date) {
  const run = runBefore(statusFor, name, date) + 1
  return run >= SIX_AFTER ? run : 0
}

export function monthScores(staff, days, statusFor, todayKey, keyOf) {
  return staff.map((name) => {
    let runs = 0, wickets = 0, fours = 0, twos = 0, sixes = 0, streak = 0, best = 0
    let run = days.length ? runBefore(statusFor, name, days[0]) : 0
    for (const d of days) {
      if (keyOf(d) > todayKey) break
      const st = statusFor(d, name)
      if (st === 'P') {
        run++
        if (run >= SIX_AFTER) { runs += SIX_RUNS; sixes++ } else { runs += RUNS.P; fours++ }
        streak++
        best = Math.max(best, streak)
      } else if (st === 'H') { runs += RUNS.H; twos++; run = 0 }
      else if (st === 'N') { wickets++; streak = 0; run = 0 }
    }
    const presents = fours + sixes
    const faced = presents + twos + wickets
    const rate = faced ? Math.round(((presents * RUNS.P + twos * RUNS.H) / (faced * RUNS.P)) * 100) : 0
    return { name, runs, wickets, fours, twos, sixes, faced, best, rate }
  })
}

export const byRuns = (rows) => [...rows].sort((a, b) => b.runs - a.runs || a.wickets - b.wickets || a.name.localeCompare(b.name))

export function dayScore(staff, statusFor, date) {
  let runs = 0, wickets = 0, closed = 0
  const yet = []
  for (const name of staff) {
    const st = statusFor(date, name)
    if (st === 'P') runs += sixRun(statusFor, name, date) ? SIX_RUNS : RUNS.P
    else if (st === 'H') runs += RUNS.H
    else if (st === 'N') wickets++
    else if (st === 'C') closed++
    else yet.push(name)
  }
  return { runs, wickets, yet, rain: staff.length > 0 && closed === staff.length }
}

/** Honours earned in the month. Good things only: nobody is named for their absences. */
export function honours(row) {
  const out = []
  if (row.runs >= 100) out.push('Century')
  else if (row.runs >= 50) out.push('Fifty')
  if (row.best >= 14) out.push('Fortnight unbeaten')
  else if (row.best >= 7) out.push('Long innings')
  if (row.faced >= 10 && row.wickets === 0) out.push('Not out')
  return out
}

/** Each honour's icon, and what a tap on it says. */
export const HONOUR_INFO = {
  Fifty: { icon: 'bat', say: '50 runs this month' },
  Century: { icon: 'stats', say: '100 runs this month' },
  'Long innings': { icon: 'flame', say: 'Present 7 days in a row' },
  'Fortnight unbeaten': { icon: 'shield', say: 'Present 14 days in a row' },
  'Not out': { icon: 'stumps', say: 'No absence in 10 or more days this month' },
}

export const COLUMN_INFO = {
  R: 'Runs: present 4, half day 2. After 6 presents in a row, every present is 6 until a half day or absence. A run carries over into the next month',
  W: 'Wickets: days absent',
  SR: 'Strike rate: out of 100, 100 means present every day',
}

/** The line that runs along the top. Attendance facts only, never a rupee. */
export function tickerLines({ day, rows, isToday }) {
  const lines = []
  const when = isToday ? 'Today' : 'That day'
  if (day.rain) lines.push(`${when}: rain stopped play, shop closed`)
  else lines.push(`${when}: ${day.runs} for ${day.wickets}`)
  if (isToday && day.yet.length > 0 && !day.rain) lines.push(`Yet to walk in: ${day.yet.join(', ')}`)
  if (isToday && day.yet.length === 0 && !day.rain) lines.push('Everyone has been to the middle today')
  const top = byRuns(rows)[0]
  if (top?.runs > 0) lines.push(`Top of the table: ${top.name}, ${top.runs} runs`)
  for (const r of rows) for (const h of honours(r)) if (h === 'Century') lines.push(`${r.name} has a century this month`)
  return lines
}

export const IDLE_LINES = [
  'Khel shuru karein?',
  'Light is good. Pitch is good.',
  'Scorer is waiting, boss.',
  'Bowler is ready.',
  'Mark them and we play.',
]

export const MOMENTS = [
  { id: 'cover', name: 'Cover drive', hint: 'Mark someone present' },
  { id: 'two', name: 'Quick two', hint: 'Mark a half day' },
  { id: 'bowled', name: 'Clean bowled', hint: 'Mark someone absent' },
  { id: 'allin', name: 'All in', hint: 'Mark the whole team present' },
  { id: 'rain', name: 'Rain stops play', hint: 'Mark the shop closed' },
  { id: 'stumps', name: 'Stumps', hint: 'Save and lock a day' },
  { id: 'third', name: 'Third umpire', hint: 'Unlock a past day' },
  { id: 'six', name: 'Into the stands', hint: 'Present 6 days in a row, or tap the batter' },
  { id: 'hattrick', name: 'Three in a row', hint: 'Keep tapping the batter' },
  { id: 'newball', name: 'New ball', hint: 'Pull the screen down' },
]
