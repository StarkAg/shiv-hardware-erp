/**
 * Whether the cricket theme is on, and the words that change with it. Always
 * loaded, so it stays tiny; the theme itself comes through lazy.jsx only when on.
 * The rules and the why: docs/cricket-theme-design.md.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

const THEME_KEY = 'shiv-attendance:theme'
const TRY_KEY = 'shiv-attendance:theme-try'

/** ?cricket=1 tries it on this one tab, ?cricket=0 forces it off, without touching anyone else. */
function readTryOut() {
  try {
    const asked = new URLSearchParams(window.location.search).get('cricket')
    if (asked === '1' || asked === '0') sessionStorage.setItem(TRY_KEY, asked)
    const held = sessionStorage.getItem(TRY_KEY)
    return held === '1' ? true : held === '0' ? false : null
  } catch { return null }
}

export function useAttendanceTheme(convex) {
  const [shared, setShared] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === 'cricket' } catch { return false }
  })
  const [tryOut, setTryOut] = useState(readTryOut)
  const remember = (next) => {
    setShared(next)
    try { localStorage.setItem(THEME_KEY, next ? 'cricket' : '') } catch { /* ignore */ }
  }
  // Live, the one subscription in this app: flip it on one phone and every open
  // phone follows at once, without waiting to be reopened.
  const live = useQuery(anyApi.attendance.getTheme, {})
  useEffect(() => {
    if (live !== undefined) remember(live === 'cricket')
  }, [live])
  const setCricket = (next) => {
    // The switch outranks a tab's try-out, or this phone would ignore its own switch.
    try {
      sessionStorage.removeItem(TRY_KEY)
      const url = new URL(window.location.href)
      url.searchParams.delete('cricket')
      window.history.replaceState(null, '', url)
    } catch { /* ignore */ }
    setTryOut(null)
    remember(next)
    convex.mutation(anyApi.attendance.setTheme, { theme: next ? 'cricket' : '' }).catch(() => remember(!next))
  }
  const on = tryOut ?? shared
  useEffect(() => {
    document.documentElement.classList.toggle('ck-root', on)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#06101a' : '#ffffff')
  }, [on])
  return { on, shared, tryOut, setCricket }
}

const PLAIN = {
  tabs: { day: 'Daily', month: 'Month', stats: 'Stats', pay: 'Pay' },
  save: 'Save & lock this day',
  relock: 'Re-lock this day',
  lockedTitle: 'This day is locked',
  lockedSub: 'Enter the password to edit past attendance',
  historyTitle: 'Change history',
  legend: { p: 'P present', n: 'N absent', h: '½ half', c: 'C closed' },
}
const CRICKET = {
  tabs: { day: 'Play', month: 'Card', stats: 'Table', pay: 'Purse' },
  save: 'Stumps: save & lock the day',
  relock: 'Stumps again: re-lock',
  lockedTitle: 'Third umpire',
  lockedSub: 'This day is locked. Enter the password to review it.',
  historyTitle: 'Match referee: changes',
  legend: { p: 'P present, four', n: 'N absent, out', h: '½ half, two', c: 'C closed, rain' },
}
const Words = createContext(PLAIN)
export const WordsProvider = ({ on, children }) => (
  <Words.Provider value={on ? CRICKET : PLAIN}>{children}</Words.Provider>
)
export const useWords = () => useContext(Words)
