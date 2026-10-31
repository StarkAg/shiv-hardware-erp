import { useSyncExternalStore } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { indiaDate, onWorkingDate, setWorkingDate, workingDate } from '../lib/businessDate'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const words = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`

/**
 * The date the panel is entering, under the shop's name.
 *
 * Today unless changed. Set back, every new entry in the panel takes that day
 * (lib/businessDate), and the box turns yellow so nobody forgets it is not
 * today. Never later than today, and a refresh puts it back on today.
 */
export function WorkingDate() {
  const picked = useSyncExternalStore(onWorkingDate, workingDate)
  const today = indiaDate()
  return (
    <div className="mt-3">
      <label
        className={`flex items-center gap-2 border px-2 py-1.5 text-xs font-semibold ${
          picked
            ? 'border-yellow-500 bg-yellow-300 text-stone-950'
            : 'border-stone-200 bg-white text-stone-700 dark:border-white/10 dark:bg-stone-900 dark:text-stone-200'
        }`}
        title="New entries across the panel take this date. Back to today on refresh."
      >
        <CalendarDays size={14} aria-hidden="true" className="shrink-0" />
        <span className="shrink-0">{picked ? 'Entering' : 'Date'}</span>
        <input
          type="date"
          aria-label="Working date for new entries"
          value={picked ?? today}
          max={today}
          onChange={(e) => setWorkingDate(e.target.value || null)}
          className="min-w-0 flex-1 bg-transparent text-right font-bold outline-none"
        />
        {picked && (
          <button
            type="button"
            onClick={() => setWorkingDate(null)}
            aria-label="Back to today"
            title="Back to today"
            className="shrink-0 hover:text-stone-600"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </label>
      {picked && <div className="mt-1 text-[11px] font-semibold text-stone-700 dark:text-yellow-300">New entries go in as {words(picked)}</div>}
    </div>
  )
}
