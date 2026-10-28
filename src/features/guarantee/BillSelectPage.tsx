import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useConvex } from 'convex/react'
import { ArrowLeft, Camera, FileText, Search } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { useStore } from '../../lib/store'
import { toast } from '../../components/Toast'
import { MONEY_BILL_KINDS, type Bill } from '../../lib/types'

/** Everything a bill can be found by, in one lowercase line: number, customer, phones, ref, brands, total, date. */
function searchText(b: Bill): string {
  const day = new Date(b.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return [
    b.number, b.customerName, b.customerPhone, b.customerPhone2, b.ref, String(Math.round(b.total)), day, b.date.slice(0, 10),
    ...b.items.flatMap((it) => [it.description, it.brandName ?? '']),
  ].filter(Boolean).join(' ').toLowerCase()
}

export function BillSelectPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { bills } = useStore()
  const convex = useConvex()
  const [search, setSearch] = useState('')

  const returnTo: string =
    (location.state as { returnTo?: string })?.returnTo ?? '/guarantee/card'

  // Every bill is a saved bill now — there are no drafts to leave out, and
  // filtering on the old flag would hide bills written before it went. A
  // receipt, payment or refund is money, not goods, so it carries no guarantee.
  const savedBills = bills
    .filter((b) => !MONEY_BILL_KINDS.includes(b.kind ?? 'sale'))
    .sort((a, b) => b.date.localeCompare(a.date))

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = useMemo(
    () => (words.length ? savedBills.filter((b) => { const t = searchText(b); return words.every((w) => t.includes(w)) }) : savedBills),
    [savedBills, search], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** The bill's photo in a window of its own, to read beside the card. The window is opened first (a click allows it), then pointed at the picture. */
  async function openPhoto(bill: Bill) {
    const shot = bill.attachments?.[0]
    if (!shot) { toast(`Bill ${bill.number} has no photo.`, 'info'); return }
    const win = window.open('', '_blank')
    try {
      const url = await convex.query(api.files.getUrl, { storageId: shot.storageId as never })
      if (!url) throw new Error('The photo is not available.')
      if (win) win.location.href = url
      else window.open(url, '_blank')
    } catch (err) {
      win?.close()
      toast(`Could not open the photo: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  function openBill(billId: string) {
    navigate(`/guarantee/bill/${billId}`, { state: { returnTo } })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-stone-200/80 bg-stone-50/95 px-3 py-3 shadow-sm dark:border-white/10 dark:bg-stone-950/90">
        <button
          onClick={() => navigate(returnTo)}
          className="rounded-lg p-2 text-muted hover:bg-stone-100 dark:hover:bg-white/10"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-bold text-stone-900 dark:text-stone-100">Select a Bill</h1>
        <span className="ml-auto text-xs text-muted">
          {shown.length} bill{shown.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="border-b border-stone-200/80 bg-stone-50/95 px-3 py-2 dark:border-white/10 dark:bg-stone-950/90">
        <label className="flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 dark:border-white/15 dark:bg-stone-900">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter opens the photo of the first match, in its own window.
              if (e.key === 'Enter' && shown[0]) { e.preventDefault(); void openPhoto(shown[0]) }
            }}
            placeholder="Search bill no., customer, phone, brand, amount…  (Enter opens the photo)"
            aria-label="Search bills"
            autoFocus
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted">
            <FileText size={40} strokeWidth={1.5} />
            <p className="text-sm font-medium">{savedBills.length === 0 ? 'No saved bills yet.' : 'No bill matches that.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-white/10">
            {shown.map((bill) => (
              <div key={bill.id} className="flex items-stretch hover:bg-stone-50 dark:hover:bg-white/5">
              <button
                onClick={() => openBill(bill.id)}
                className="flex min-w-0 flex-1 items-center gap-4 px-4 py-4 text-left transition active:bg-stone-100 dark:active:bg-white/10"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-100 dark:bg-white/10">
                  <FileText size={20} className="text-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-stone-900 dark:text-stone-100">
                      #{bill.number}
                    </span>
                    {bill.customerName && (
                      <span className="truncate text-sm text-muted">
                        {bill.customerName}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {new Date(bill.date).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {' · '}
                    {bill.items.length} item{bill.items.length !== 1 ? 's' : ''}
                    {' · '}₹{bill.total.toLocaleString('en-IN')}
                  </div>
                </div>
              </button>
              {bill.attachments?.length ? (
                <button
                  onClick={() => void openPhoto(bill)}
                  title="Open the bill photo in a new window"
                  aria-label={`Open the photo of bill ${bill.number} in a new window`}
                  className="flex w-14 shrink-0 items-center justify-center text-muted transition hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-stone-100"
                >
                  <Camera size={20} />
                </button>
              ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
