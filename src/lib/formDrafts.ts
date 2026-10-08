/**
 * Typing on a voucher that has not been saved, kept on this device.
 *
 * Clicking Home or any other menu entry used to throw it away without a word:
 * a receipt half typed was simply gone when the form was opened again. Now
 * the form's state is kept here as it is typed, and comes back the next time
 * the same form is opened — a new voucher of the same kind, or the same bill.
 * It is cleared when the voucher is saved, printed, discarded or deleted.
 *
 * Nothing here reaches the server or the books; it is not a saved bill.
 */
import type { Bill } from './types'

const PREFIX = 'shiv-panel:draft:'

/** Which form a draft belongs to: a bill by its id, a ledger voucher by its id, or a new one by kind. */
export function draftKey(o: { billId?: string; voucherId?: string; kind?: string; isNew: boolean }): string {
  if (o.voucherId) return `vch:${o.voucherId}`
  if (!o.isNew && o.billId) return `bill:${o.billId}`
  return `new:${o.kind ?? 'sale'}`
}

export function saveFormDraft(key: string, bill: Bill): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ bill, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function loadFormDraft(key: string): Bill | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { bill?: Bill }
    return parsed?.bill && typeof parsed.bill === 'object' ? parsed.bill : null
  } catch {
    return null
  }
}

export function clearFormDraft(key: string) {
  try { localStorage.removeItem(PREFIX + key) } catch { /* nothing to clear */ }
}
