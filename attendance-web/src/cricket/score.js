/**
 * Marks turned into cricket. Display only: nothing here is written anywhere, and
 * nothing here decides pay, which stays in ../pay.js.
 *
 * A present day is a four and a half day is a two, so a half keeps its true value
 * against a full day. The target is the Tuesday pay rule's twenty days, in runs.
 */
export const RUNS = { P: 4, H: 2 }
export const runsFor = (days) => days * RUNS.P

export function monthScores(staff, days, statusFor, todayKey, keyOf) {
  return staff.map((name) => {
    let runs = 0, wickets = 0, fours = 0, twos = 0, streak = 0, best = 0
    for (const d of days) {
      if (keyOf(d) > todayKey) break
      const st = statusFor(d, name)
      if (st === 'P') { runs += RUNS.P; fours++; streak++; best = Math.max(best, streak) }
      else if (st === 'H') { runs += RUNS.H; twos++ }
      else if (st === 'N') { wickets++; streak = 0 }
    }
    const faced = fours + twos + wickets
    return { name, runs, wickets, fours, twos, faced, best, rate: faced ? Math.round((runs / (faced * RUNS.P)) * 100) : 0 }
  })
}

export const byRuns = (rows) => [...rows].sort((a, b) => b.runs - a.runs || a.wickets - b.wickets || a.name.localeCompare(b.name))

export function dayScore(staff, statusFor, date) {
  let runs = 0, wickets = 0, closed = 0
  const yet = []
  for (const name of staff) {
    const st = statusFor(date, name)
    if (st === 'P' || st === 'H') runs += RUNS[st]
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
  R: 'Runs: present 4, half day 2',
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
  { id: 'six', name: 'Into the stands', hint: 'Tap the batter' },
  { id: 'hattrick', name: 'Three in a row', hint: 'Keep tapping the batter' },
  { id: 'newball', name: 'New ball', hint: 'Pull the screen down' },
]
