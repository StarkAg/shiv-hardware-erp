/**
 * The last few pages the panel showed, so Back can return to the one a page
 * was reached from: an account opened from Advances goes back to Advances,
 * not to All customers. Kept in memory for this window; AppLayout notes each
 * page as it opens.
 */
const trail: string[] = []
const KEEP = 3 // this page and the two before it

export function noteVisit(path: string) {
  if (trail[trail.length - 1] === path) return
  trail.push(path)
  if (trail.length > KEEP) trail.shift()
}

/**
 * The page before `current`, if there is one worth going back to. A bill
 * screen is passed over: going back to it would open a new blank voucher, and
 * a saved bill lands on its account on purpose. So is the bare /ledger, which
 * only reopens the account that was open — the one being left.
 */
export function cameFrom(current: string): string | null {
  for (let i = trail.length - 1; i >= 0; i--) {
    const path = trail[i]
    if (path === current || path.startsWith('/bills') || path === '/ledger') continue
    return path
  }
  return null
}

const NAMES: Record<string, string> = {
  '/home': 'Home',
  '/day': 'Day Book',
  '/paper': 'Day Paper',
  '/cash-review': 'Cash',
  '/work-list': 'Work List',
  '/quotations': 'Quotations',
  '/delivery': 'Delivery',
  '/bill-flow': 'Bill Flow',
  '/guarantee/list': 'Guarantee List',
  '/guarantee/claims': 'Guarantee Claims',
  '/ledger/advances': 'Advances',
  '/ledger/all': 'All parties',
  '/ledger/customers': 'All customers',
  '/ledger/suppliers': 'All suppliers',
  '/ledger/monthly': 'Salary & Rent',
  '/ledger/trial': 'Trial Balance',
  '/ledger/tocome': 'Bills to Come',
  '/ledger/bills': 'Bills',
}

/** What the Back button says for a page. */
export const pageName = (path: string) => NAMES[path.split('?')[0]] ?? 'Back'
