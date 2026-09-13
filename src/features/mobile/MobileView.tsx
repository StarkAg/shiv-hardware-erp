import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { ChevronLeft, Paperclip, Phone, ReceiptText, Search, X } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useStore } from '../../lib/store'
import type { Bill } from '../../lib/types'
import { rupees, shortDate } from '../ledger/lib/format'
import VoucherBillPreviewUntyped from '../ledger/components/VoucherBillPreview'
import '../ledger/ledger.css'

/**
 * The books on a phone, to read and nothing else.
 *
 * Opened from the website on a phone so the family can look anything up —
 * a party's balance, what was sold yesterday, which bill a payment settled —
 * without a single button that writes. One search box answers across both
 * vouchers and ledgers; the full panel is still a tap away for the shop.
 */

const VoucherBillPreview = VoucherBillPreviewUntyped as unknown as (props: {
  bill: Bill
  onClose: () => void
}) => JSX.Element

type Voucher = {
  _id: string
  date: number
  vchType: string
  vchLabel: string
  party: string
  partyLedgerId: string
  refNo: string
  narration: string
  amount: number
  status: string
  createdAt?: number
  contra: string[]
  attachmentUrls: { url?: string }[]
}

type Party = { id: string; name: string; phone: string; group: string; balance: number }

// Voucher dates are stored as UTC midnight, so days are counted in UTC too.
const DAY = 864e5
const todayUtc = () => {
  const n = new Date()
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())
}
const dayKey = (ms: number) => Math.floor(ms / DAY)

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All' },
] as const
type Period = (typeof PERIODS)[number]['id']

const inPeriod = (ms: number, p: Period) => {
  const t = todayUtc()
  if (p === 'today') return dayKey(ms) === dayKey(t)
  if (p === 'yesterday') return dayKey(ms) === dayKey(t - DAY)
  if (p === 'month') {
    const d = new Date(t)
    return ms >= Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  }
  return true
}

const dayHeading = (ms: number) => {
  const k = dayKey(ms)
  const t = dayKey(todayUtc())
  const stamp = new Date(ms).toLocaleDateString('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
  if (k === t) return `Today · ${stamp}`
  if (k === t - 1) return `Yesterday · ${stamp}`
  return stamp
}

/** A balance the way the books state it: the amount and the side it sits on. */
const balance = (signed: number) =>
  `${rupees(Math.abs(signed))} ${signed >= 0 ? 'Dr' : 'Cr'}`

/** Lower-cased, and with the commas out so "1,06,670" finds 106670. */
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/,/g, '')

const matches = (q: string, ...fields: unknown[]) => {
  const words = norm(q).split(/\s+/).filter(Boolean)
  const hay = fields.map(norm).join(' ')
  return words.every((w) => hay.includes(w))
}

/** The bill a voucher posted, by the voucher it names or its BILL-n ref. */
function billOf(bills: Bill[], voucherId: string, refNo: string) {
  return (
    bills.find((b) => b.voucherId === voucherId) ??
    (refNo.startsWith('BILL-') ? bills.find((b) => `BILL-${b.number}` === refNo) : undefined)
  )
}

const chip = (on: boolean) =>
  `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
    on
      ? 'bg-shiv-green text-stone-950'
      : 'bg-stone-200/70 text-stone-700 dark:bg-white/10 dark:text-stone-300'
  }`

export function MobileView() {
  const [params, setParams] = useSearchParams()
  const ledgerId = params.get('ledger')
  const tab = params.get('tab') === 'ledgers' ? 'ledgers' : 'vouchers'
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState<Period>('month')
  const [bill, setBill] = useState<Bill | null>(null)

  const bills = useStore((s) => s.bills)
  const vouchers = useQuery(api.reports.dayBook, {}) as Voucher[] | undefined
  const parties = useQuery(api.ledgerViews.parties, {}) as Party[] | undefined

  const openLedger = (id: string) => setParams({ ledger: id })
  const setTab = (t: string) => setParams(t === 'ledgers' ? { tab: t } : {}, { replace: true })

  const searching = q.trim().length > 0

  const foundVouchers = useMemo(() => {
    const list = (vouchers ?? []).filter((v) =>
      searching
        ? matches(q, v.vchLabel, v.vchType, v.party, v.refNo, v.narration, v.contra.join(' '), v.amount, shortDate(v.date))
        : inPeriod(v.date, period),
    )
    // Latest entered first, whatever date the bill carries.
    return list.sort((a, b) =>
      (b.createdAt ?? b.date) - (a.createdAt ?? a.date) || b.vchLabel.localeCompare(a.vchLabel))
  }, [vouchers, q, searching, period])

  const foundParties = useMemo(() => {
    const list = (parties ?? []).filter((p) => !searching || matches(q, p.name, p.phone, p.group))
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [parties, q, searching])

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      {bill && (
        <div className="ledger-root">
          <VoucherBillPreview bill={bill} onClose={() => setBill(null)} />
        </div>
      )}

      {ledgerId ? (
        <LedgerScreen id={ledgerId} bills={bills} onBill={setBill} />
      ) : (
        <>
          <header className="sticky top-0 z-10 space-y-3 border-b border-stone-200 bg-stone-50/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur dark:border-white/10 dark:bg-stone-950/95">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-base font-bold leading-tight">Shiv Hardware</h1>
                <p className="text-[11px] text-stone-500">Books · read only</p>
              </div>
              <Link
                to="/home"
                onClick={() => { try { sessionStorage.setItem('shiv-panel:full-panel', '1') } catch { /* ignore */ } }}
                className="text-xs font-semibold text-stone-500 underline"
              >
                Full panel
              </Link>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2.5 dark:border-white/15 dark:bg-white/5">
              <Search size={16} className="shrink-0 text-stone-400" aria-hidden="true" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search party, phone, bill, amount…"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400"
                inputMode="search"
                enterKeyHint="search"
              />
              {searching && (
                <button onClick={() => setQ('')} aria-label="Clear search" className="text-stone-400">
                  <X size={16} />
                </button>
              )}
            </label>

            {!searching && (
              <div className="flex gap-2">
                {(['vouchers', 'ledgers'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={`flex-1 ${chip(tab === t)} py-2 text-sm`}>
                    {t === 'vouchers' ? 'Vouchers' : 'Ledgers'}
                  </button>
                ))}
              </div>
            )}
          </header>

          <main className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
            {searching ? (
              <>
                <SectionTitle>Ledgers · {foundParties.length}</SectionTitle>
                <PartyList parties={foundParties.slice(0, 30)} loading={!parties} onOpen={openLedger} />
                {foundParties.length > 30 && (
                  <p className="py-2 text-center text-xs text-stone-500">Showing 30 of {foundParties.length} — type more to narrow</p>
                )}
                <SectionTitle>Vouchers · {foundVouchers.length}</SectionTitle>
                <VoucherList
                  vouchers={foundVouchers.slice(0, 200)}
                  loading={!vouchers}
                  bills={bills}
                  onBill={setBill}
                  onParty={openLedger}
                />
              </>
            ) : tab === 'vouchers' ? (
              <>
                <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
                  {PERIODS.map((p) => (
                    <button key={p.id} onClick={() => setPeriod(p.id)} className={chip(period === p.id)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {vouchers && (
                  <p className="mb-2 text-xs text-stone-500">
                    {foundVouchers.length} vouchers · ₹{rupees(foundVouchers.reduce((s, v) => s + (v.status === 'pending' ? 0 : v.amount), 0))}
                  </p>
                )}
                <VoucherList vouchers={foundVouchers} loading={!vouchers} bills={bills} onBill={setBill} onParty={openLedger} />
              </>
            ) : (
              <PartyList parties={foundParties} loading={!parties} onOpen={openLedger} />
            )}
          </main>
        </>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-stone-500 first:mt-0">{children}</h2>
}

function Empty({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-stone-500">{loading ? 'Loading…' : children}</p>
}

const card = 'rounded-xl border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-white/5'

function PartyList({ parties, loading, onOpen }: { parties: Party[]; loading: boolean; onOpen: (id: string) => void }) {
  if (loading || parties.length === 0) return <Empty loading={loading}>No ledgers found</Empty>
  return (
    <ul className="space-y-2">
      {parties.map((p) => (
        <li key={p.id}>
          <button onClick={() => onOpen(p.id)} className={`${card} flex w-full items-center justify-between gap-3 text-left`}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{p.name}</span>
              <span className="block truncate text-xs text-stone-500">
                {[p.group, p.phone].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{balance(p.balance)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function VoucherList({ vouchers, loading, bills, onBill, onParty, grouped }: {
  vouchers: Voucher[]
  loading: boolean
  bills: Bill[]
  onBill: (b: Bill) => void
  onParty: (id: string) => void
  grouped?: boolean
}) {
  if (loading || vouchers.length === 0) return <Empty loading={loading}>No vouchers found</Empty>

  const days: { key: number; date: number; rows: Voucher[] }[] = []
  for (const v of vouchers) {
    const last = days[days.length - 1]
    if (grouped && last && last.key === dayKey(v.date)) last.rows.push(v)
    else if (grouped || !last) days.push({ key: dayKey(v.date), date: v.date, rows: [v] })
    else last.rows.push(v)
  }

  return (
    <div className="space-y-4">
      {days.map((d) => (
        <section key={d.key}>
          {grouped && (
            <div className="mb-2 flex items-baseline justify-between text-xs font-bold text-stone-500">
              <span>{dayHeading(d.date)}</span>
              <span className="tabular-nums">₹{rupees(d.rows.reduce((s, v) => s + (v.status === 'pending' ? 0 : v.amount), 0))}</span>
            </div>
          )}
          <ul className="space-y-2">
            {d.rows.map((v) => {
              const b = billOf(bills, v._id, v.refNo)
              const photos = v.attachmentUrls.map((a) => a?.url).filter(Boolean) as string[]
              return (
                <li key={v._id} className={card}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                        <span className="font-mono font-semibold text-stone-700 dark:text-stone-300">{v.vchLabel}</span>
                        <span>{v.vchType}</span>
                        {!grouped && <span>{shortDate(v.date)}</span>}
                      </div>
                      <button onClick={() => onParty(v.partyLedgerId)} className="mt-0.5 block text-left text-sm font-semibold underline-offset-2 active:underline">
                        {v.party}
                      </button>
                    </div>
                    <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
                      {v.status === 'pending' ? <span className="text-amber-600">awaiting amount</span> : `₹${rupees(v.amount)}`}
                    </div>
                  </div>
                  {(v.contra.length > 0 || v.refNo || (v.narration && v.narration !== v.vchType)) && (
                    <p className="mt-1 text-xs text-stone-500">
                      {[v.contra.join(', '), v.refNo && `Ref ${v.refNo}`, v.narration !== v.vchType && v.narration]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  <Attachments bill={b} photos={photos} onBill={onBill} />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Attachments({ bill, photos, onBill }: { bill?: Bill; photos: string[]; onBill: (b: Bill) => void }) {
  if (!bill && photos.length === 0) return null
  const btn = 'inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs font-semibold text-stone-700 dark:bg-white/10 dark:text-stone-200'
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {bill && (
        <button className={btn} onClick={() => onBill(bill)}>
          <ReceiptText size={14} aria-hidden="true" /> View bill
        </button>
      )}
      {photos.map((url, i) => (
        <a key={url} className={btn} href={url} target="_blank" rel="noopener noreferrer">
          <Paperclip size={14} aria-hidden="true" /> Photo{photos.length > 1 ? ` ${i + 1}` : ''}
        </a>
      ))}
    </div>
  )
}

type StatementRow = {
  voucherId: string
  date: number
  vchType: string
  vchLabel: string
  refNo: string
  narration: string
  contra: string[]
  side: 'Dr' | 'Cr'
  amount: number
  balance: number
  balanceSide: 'Dr' | 'Cr'
  attachmentUrls: { url?: string }[]
}

function LedgerScreen({ id, bills, onBill }: { id: string; bills: Bill[]; onBill: (b: Bill) => void }) {
  const data = useQuery(api.reports.ledger, { ledgerId: id as Id<'ledgers'> }) as
    | {
        account: { name: string; phone?: string }
        opening: number
        openingSide: string
        rows: StatementRow[]
        totals: { debit: number; credit: number }
        closing: number
        closingSide: string
        pendingCount: number
      }
    | null
    | undefined
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((r) =>
      !q.trim() || matches(q, r.vchLabel, r.vchType, r.refNo, r.narration, r.contra.join(' '), r.amount, shortDate(r.date)),
    )
    return [...list].reverse()
  }, [data, q])

  return (
    <>
      <header className="sticky top-0 z-10 space-y-3 border-b border-stone-200 bg-stone-50/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur dark:border-white/10 dark:bg-stone-950/95">
        <div className="flex items-center gap-2">
          <button onClick={() => window.history.back()} aria-label="Back" className="-ml-2 p-2">
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight">{data?.account.name ?? 'Ledger'}</h1>
            {data?.account.phone && (
              <a href={`tel:${data.account.phone}`} className="inline-flex items-center gap-1 text-xs text-stone-500 underline">
                <Phone size={11} aria-hidden="true" /> {data.account.phone}
              </a>
            )}
          </div>
        </div>
        {data && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Opening', `${rupees(data.opening)} ${data.openingSide}`],
              ['Debit / Credit', `${rupees(data.totals.debit)} / ${rupees(data.totals.credit)}`],
              ['Balance', `${rupees(data.closing)} ${data.closingSide}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white px-2 py-1.5 dark:bg-white/5">
                <div className="text-[10px] font-semibold uppercase text-stone-500">{k}</div>
                <div className="text-xs font-bold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 dark:border-white/15 dark:bg-white/5">
          <Search size={15} className="shrink-0 text-stone-400" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search in this ledger…"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400"
            inputMode="search"
          />
        </label>
      </header>

      <main className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        {data === null ? (
          <Empty loading={false}>This ledger no longer exists</Empty>
        ) : !data || rows.length === 0 ? (
          <Empty loading={!data}>No entries</Empty>
        ) : (
          <ul className="space-y-2">
            {data.pendingCount > 0 && !q && (
              <li className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                {data.pendingCount} bill{data.pendingCount > 1 ? 's' : ''} awaiting an amount
              </li>
            )}
            {rows.map((r) => {
              const photos = r.attachmentUrls.map((a) => a?.url).filter(Boolean) as string[]
              return (
                <li key={`${r.voucherId}-${r.side}`} className={card}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-xs text-stone-500">
                      <div>
                        <span className="font-mono font-semibold text-stone-700 dark:text-stone-300">{r.vchLabel}</span>
                        {' · '}{r.vchType}{' · '}{shortDate(r.date)}
                      </div>
                      <div className="mt-0.5 text-stone-600 dark:text-stone-400">
                        {[r.contra.join(', '), r.refNo && `Ref ${r.refNo}`, r.narration !== r.vchType && r.narration]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className={`text-sm font-semibold ${r.side === 'Dr' ? '' : 'text-shiv-green'}`}>
                        {rupees(r.amount)} {r.side}
                      </div>
                      <div className="text-[11px] text-stone-500">Bal {rupees(Math.abs(r.balance))} {r.balanceSide}</div>
                    </div>
                  </div>
                  <Attachments bill={billOf(bills, r.voucherId, r.refNo)} photos={photos} onBill={onBill} />
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </>
  )
}
