import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { convexEnabled } from '../lib/convexSync'
import { formatINR } from '../lib/pricing'
import { toast } from './Toast'

const DISMISSED = 'shiv.rentReminder.dismissedOn'

/** Today in India as "2026-10-01" — the day a dismissal lasts for. */
function todayIST() {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

function dismissedToday() {
  try {
    return localStorage.getItem(DISMISSED) === todayIST()
  } catch {
    return false
  }
}

/**
 * Rent due this month, on every screen, from the 1st until it is paid.
 *
 * Dismissing hides it on this device for the rest of the day; it is back the
 * next morning. "Paid" writes the payment into the books against that
 * premises, and the premises drops off as soon as the books show it paid — on
 * every device, since the reminder reads the books rather than keeping its own
 * record.
 */
export function RentReminder() {
  return convexEnabled() ? <Reminder /> : null
}

function Reminder() {
  const data = useQuery(api.monthly.rentReminder, {})
  const [hidden, setHidden] = useState(dismissedToday)
  if (hidden || !data || data.unpaid.length === 0) return null

  const total = data.unpaid.reduce((t, r) => t + r.amount, 0)
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, todayIST())
    } catch {
      /* private mode: hidden until the page reloads */
    }
    setHidden(true)
  }

  return (
    <div className="no-print mx-3 mt-3 rounded-xl bg-red-600 px-4 py-3 text-white shadow-md shadow-red-900/20 sm:mx-4 md:mx-6" role="alert">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="shrink-0" />
        <div className="flex-1 text-sm font-bold">
          Rent due · {data.label} · {formatINR(total)}
        </div>
        <button
          onClick={dismiss}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-white/90 hover:bg-white/15 hover:text-white"
        >
          <X size={14} /> Dismiss
        </button>
      </div>
      <ul className="mt-2 divide-y divide-white/20">
        {data.unpaid.map((row) => (
          <RentRow key={row.ledgerId} row={row} label={data.label} accounts={data.accounts} />
        ))}
      </ul>
    </div>
  )
}

type Row = { ledgerId: Id<'ledgers'>; name: string; payee: string | null; amount: number }
type Account = { id: Id<'ledgers'>; name: string }

function RentRow({ row, label, accounts }: { row: Row; label: string; accounts: Account[] }) {
  const createPayment = useMutation(api.vouchers.createPayment)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(row.amount))
  const cash = accounts.find((a) => a.name === 'Cash') ?? accounts[0]
  const [from, setFrom] = useState<string>(cash?.id ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const value = Number(amount)
    if (!(value > 0) || !from) return
    setSaving(true)
    try {
      const [y, m, d] = todayIST().split('-').map(Number)
      await createPayment({
        date: Date.UTC(y, m - 1, d),
        partyLedgerId: row.ledgerId,
        paidFromLedgerId: from as Id<'ledgers'>,
        amount: value,
        narration: `Rent for ${label}${row.payee ? ` to ${row.payee}` : ''}`,
      })
      toast(`${row.name}: ${formatINR(value)} paid`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the payment', 'error')
      setSaving(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{row.name}</span>
        {row.payee && <span className="text-white/80"> · {row.payee}</span>}
      </div>
      {open ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28 rounded-lg border-0 px-2 py-1.5 text-right text-sm font-semibold text-stone-900"
            aria-label="Amount"
          />
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border-0 px-2 py-1.5 text-sm text-stone-900"
            aria-label="Paid from"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            <Check size={14} /> Save
          </button>
          <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-white/90 hover:bg-white/15" aria-label="Cancel">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="font-bold tabular-nums">{formatINR(row.amount)}</span>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
          >
            <Check size={14} /> Paid
          </button>
        </div>
      )}
    </li>
  )
}
