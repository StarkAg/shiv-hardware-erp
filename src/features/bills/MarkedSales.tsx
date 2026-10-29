import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ReceiptText, RotateCcw, ShieldCheck } from 'lucide-react'
import { useStore } from '../../lib/store'
import { openBillWindow } from '../../lib/billWindow'
import type { Bill } from '../../lib/types'
import VoucherBillPreviewUntyped from '../ledger/components/VoucherBillPreview'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import '../ledger/ledger.css'

/** The bill drawn from its figures, as the ledger opens it; plain JSX. */
const VoucherBillPreview = VoucherBillPreviewUntyped as unknown as (props: {
  bill: Bill
  onClose: () => void
}) => JSX.Element

/**
 * The sales marked at the counter for something still to do: a guarantee card
 * to make, or work to carry out. A sale is put on a list by its toggle in the
 * sale form and comes off when it is marked done (a card made from the bill
 * marks itself). Done ones stay below, so a slip can be undone.
 */
type ListKind = 'guarantee' | 'delivery'

const LISTS: Record<ListKind, {
  title: string
  empty: string
  doneLabel: string
  flag: (b: Bill) => boolean
  doneAt: (b: Bill) => number | undefined
  setDone: (b: Bill, at: number | undefined) => Bill
}> = {
  guarantee: {
    title: 'Guarantee list',
    empty: 'No sale is waiting for a guarantee card. Switch on "Guarantee card" in a sale to list it here.',
    doneLabel: 'Done',
    flag: (b) => !!b.guaranteeCard,
    doneAt: (b) => b.guaranteeDoneAt,
    setDone: (b, at) => ({ ...b, guaranteeDoneAt: at }),
  },
  delivery: {
    title: 'Delivery',
    empty: 'Every sale has been delivered. Untick "Delivered" in a sale whose goods go later to list it here.',
    doneLabel: 'Delivered',
    flag: (b) => !!b.undelivered,
    doneAt: (b) => b.deliveredAt,
    setDone: (b, at) => ({ ...b, deliveredAt: at }),
  },
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

export function GuaranteeList() { return <MarkedSales kind="guarantee" /> }
export function DeliveryList() { return <MarkedSales kind="delivery" /> }

function MarkedSales({ kind }: { kind: ListKind }) {
  const list = LISTS[kind]
  const navigate = useNavigate()
  const { bills, saveBill } = useStore()
  const dark = useLedgerTheme()
  // The bill shown over the list, when a window of its own could not be opened.
  const [viewing, setViewing] = useState<Bill | null>(null)
  // Only the Guarantee list can set a sale aside for now.
  const ignoredAt = (b: Bill) => (kind === 'guarantee' ? b.guaranteeIgnoredAt : undefined)

  const { pending, ignored, done } = useMemo(() => {
    const marked = bills.filter((b) => (b.kind ?? 'sale') === 'sale' && list.flag(b))
    return {
      // Oldest first: the one that has waited longest is at the top.
      pending: marked.filter((b) => !list.doneAt(b) && !ignoredAt(b)).sort((a, b) => a.date.localeCompare(b.date)),
      ignored: marked.filter((b) => !list.doneAt(b) && ignoredAt(b)).sort((a, b) => (ignoredAt(b) ?? 0) - (ignoredAt(a) ?? 0)),
      done: marked.filter((b) => list.doneAt(b)).sort((a, b) => (list.doneAt(b) ?? 0) - (list.doneAt(a) ?? 0)),
    }
  }, [bills, list])

  const [show, setShow] = useState<'todo' | 'ignored' | 'done'>('todo')
  const rows = show === 'todo' ? pending : show === 'ignored' ? ignored : done
  const isDone = show === 'done'

  const what = (b: Bill) =>
    b.items.map((it) => it.brandName || it.description).filter(Boolean).slice(0, 3).join(', ') || `${b.items.length} item(s)`

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        <h1 className="pagetitle">{list.title}</h1>
        <div className="toolbar">
          <div className="chips">
            <button className={`chip${show === 'todo' ? ' on' : ''}`} onClick={() => setShow('todo')}>To do ({pending.length})</button>
            {kind === 'guarantee' && (
              <button className={`chip${show === 'ignored' ? ' on' : ''}`} onClick={() => setShow('ignored')}>Ignored for now ({ignored.length})</button>
            )}
            <button className={`chip${show === 'done' ? ' on' : ''}`} onClick={() => setShow('done')}>{list.doneLabel} ({done.length})</button>
          </div>
        </div>

        {!rows.length ? (
          <div className="empty">
            {show === 'todo' ? list.empty : show === 'ignored' ? 'Nothing set aside for now.' : `Nothing marked ${list.doneLabel.toLowerCase()} yet.`}
          </div>
        ) : (
          <div className="table-wrap"><div className="scroller">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="w-date">Date</th>
                  <th className="w-no">Bill</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th className="num">Amount</th>
                  <th className="w-clip" />
                  <th className="w-acts" />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className={isDone ? 'quote' : undefined}>
                    <td className="mono" data-label="Date">{fmtDate(b.date)}</td>
                    <td className="mono entryno" data-label="Bill">#{b.number}</td>
                    <td className="particulars" data-label="Customer">
                      {b.ledgerId ? (
                        <button className="link plain" onClick={() => navigate(`/ledger/customers/${b.ledgerId}`)} title="Open the customer's account">
                          {b.customerName || 'Cash sale'}
                        </button>
                      ) : (
                        <span>{b.customerName || 'Cash sale'}</span>
                      )}
                      {b.customerPhone && <div className="ref">{b.customerPhone}</div>}
                    </td>
                    <td className="particulars" data-label="Items">{what(b)}</td>
                    <td className="num" data-label="Amount">{money(b.total)}</td>
                    <td className="w-clip" data-label="">
                      {/* In a window of its own, so the list (or the card being made) stays in view. */}
                      <button className="clip" onClick={() => { if (!openBillWindow(b)) setViewing(b) }} aria-label="Show the bill" title="Show the bill">
                        <ReceiptText size={13} aria-hidden="true" />
                      </button>
                    </td>
                    <td className="rowacts" data-label="">
                      <div className="qtn-acts">
                        {kind === 'guarantee' && !isDone && show !== 'ignored' && (
                          <button className="btn small" onClick={() => navigate(`/guarantee/bill/${b.id}`, { state: { returnTo: '/guarantee/list' } })}>
                            <ShieldCheck size={13} aria-hidden="true" /> Make card
                          </button>
                        )}
                        {kind === 'guarantee' && !isDone && (
                          <button
                            className="btn small ghost"
                            title={b.guaranteeIgnoredAt ? 'Put it back on the list' : 'Set aside for now; it stays under Ignored'}
                            onClick={() => saveBill({ ...b, guaranteeIgnoredAt: b.guaranteeIgnoredAt ? undefined : Date.now() })}
                          >
                            {b.guaranteeIgnoredAt ? 'Bring back' : 'Ignore'}
                          </button>
                        )}
                        <button
                          className="btn small ghost"
                          title={isDone ? `Not ${list.doneLabel.toLowerCase()} after all` : `Mark ${list.doneLabel.toLowerCase()}`}
                          onClick={() => saveBill(list.setDone(b, isDone ? undefined : Date.now()))}
                        >
                          {isDone ? <><RotateCcw size={13} aria-hidden="true" /> Undo</> : <><Check size={13} aria-hidden="true" /> {list.doneLabel}</>}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></div>
        )}

        {viewing && <VoucherBillPreview bill={viewing} onClose={() => setViewing(null)} />}
      </div>
    </div>
  )
}
