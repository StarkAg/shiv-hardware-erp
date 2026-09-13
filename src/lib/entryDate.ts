/**
 * The date the last entry was written on, offered to the next one.
 *
 * Entering a day's slips the morning after means picking yesterday on every
 * voucher; Tally keeps the last date for exactly that reason, and so does the
 * panel. Held per device, as an ISO date (yyyy-mm-dd).
 */
const KEY = 'shiv-panel:last-entry-date'

const todayIso = () => {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export function lastEntryDate(): string {
  try {
    const saved = localStorage.getItem(KEY) ?? ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved
  } catch { /* ignore */ }
  return todayIso()
}

export function rememberEntryDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return
  try { localStorage.setItem(KEY, iso) } catch { /* ignore */ }
}
