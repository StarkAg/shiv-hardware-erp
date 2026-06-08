import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import { useStore } from '../../lib/store'

export function BillSelectPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { bills } = useStore()

  const returnTo: string =
    (location.state as { returnTo?: string })?.returnTo ?? '/guarantee/card'

  const savedBills = bills
    .filter((b) => !b.isDraft)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))

  function openBill(billId: string) {
    navigate(`/guarantee/bill/${billId}`, { state: { returnTo } })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-stone-200/80 bg-stone-50/95 px-3 py-3 shadow-sm dark:border-white/10 dark:bg-stone-950/90">
        <button
          onClick={() => navigate(returnTo)}
          className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-base font-bold text-stone-900 dark:text-stone-100">Select a Bill</h1>
        <span className="ml-auto text-xs text-stone-400 dark:text-stone-500">
          {savedBills.length} bill{savedBills.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {savedBills.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-stone-400 dark:text-stone-500">
            <FileText size={40} strokeWidth={1.5} />
            <p className="text-sm font-medium">No saved bills yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-white/10">
            {savedBills.map((bill) => (
              <button
                key={bill.id}
                onClick={() => openBill(bill.id)}
                className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-stone-50 active:bg-stone-100 dark:hover:bg-white/5 dark:active:bg-white/10"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-100 dark:bg-white/10">
                  <FileText size={20} className="text-stone-500 dark:text-stone-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-stone-900 dark:text-stone-100">
                      #{bill.number}
                    </span>
                    {bill.customerName && (
                      <span className="truncate text-sm text-stone-500 dark:text-stone-400">
                        {bill.customerName}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
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
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
