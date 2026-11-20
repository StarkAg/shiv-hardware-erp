import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/**
 * Shiv Bill: a sale bill from a phone, saved to the shop's books.
 *
 * One screen: who it is for (a walk-in W/B, or a customer's account), the
 * goods (item, qty, rate), what was paid and how, then Save at the foot. It
 * posts through the same server function as the panel's bill form
 * (Shiv_Panel convex/billLedger.ts postBill), which gives the bill its number,
 * opens the customer's account if it is new, and keeps the bill in the
 * panel's day book. While it is typed, the bill is also put on the counter's
 * customer screen (convex/customerScreen.ts).
 */

const WB = 'W/B'
const UNITS = ['Pc', 'Kg', 'M', 'Ft', 'Rft', 'Sqft', 'Set', 'Box', 'Bl', 'L']
const DRAFT_KEY = 'shiv-bill:draft'
const SAVED_KEY = 'shiv-bill:saved'

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const num = (s) => {
  const n = Number(String(s ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}
const round2 = (n) => Math.round(n * 100) / 100
const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const rs = (n) => `₹${money.format(n)}`
const fold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
/** Today in India, as the books write a date. */
function indiaToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

const newLine = () => ({ id: uid(), description: '', qty: '1', unit: 'Pc', rate: '' })
const newDraft = () => ({
  id: uid(),
  customer: { name: WB, phone: '', ledgerId: null, place: '' },
  lines: [newLine()],
  paidHow: 'credit', // for an account: credit | full | part
  part: '',
  mode: 'upi',       // UPI and online go to Bank, cash to the drawer
})

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return v ?? fallback } catch { return fallback }
}
function keep(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private window: works, not kept */ }
}

const lineAmount = (l) => round2(num(l.qty) * num(l.rate))
const isWalkIn = (name) => fold(name) === 'wb'

/* Small line icons, drawn here: the project has no emojis. */
const Plus = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden><path d="M12 4v16M4 12h16" /></svg>
const Cross = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden><path d="M5 5l14 14M19 5L5 19" /></svg>
const Tick = () => <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>

/**
 * What the phone's bill puts on the counter's customer screen. One call at a
 * time, always the newest; a fault (no signal) is let go, the next change
 * tries again.
 */
function useCustomerScreen() {
  const show = useMutation(anyApi.customerScreen.show)
  const next = useRef(null)
  const busy = useRef(false)
  const lastSent = useRef('')
  return useRef((state) => {
    const json = JSON.stringify(state)
    if (json === lastSent.current) return
    lastSent.current = json
    next.current = state
    if (busy.current) return
    busy.current = true
    void (async () => {
      while (next.current) {
        const sending = next.current
        next.current = null
        try { await show({ state: sending, from: 'phone' }) } catch { /* the screen is a courtesy */ }
      }
      busy.current = false
    })()
  }).current
}

function CustomerPicker({ customer, onPick, customers }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const found = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return customers
      .filter((c) => words.every((w) => `${c.name} ${c.place ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(w)))
      .slice(0, 8)
  }, [customers, search])
  const typed = search.trim()
  const exact = customers.some((c) => fold(c.name) === fold(typed))

  if (!open) {
    const walkIn = isWalkIn(customer.name)
    return (
      <div className="who">
        <div className="who-name">
          <strong>{walkIn ? 'Walk-in (W/B)' : customer.name}</strong>
          <small>
            {walkIn
              ? 'Cash sale, paid in full'
              : customer.ledgerId
                ? [customer.place, customer.phone].filter(Boolean).join(' · ') || 'Customer account'
                : 'New customer: an account opens on Save'}
          </small>
        </div>
        <button type="button" className="key ghost small" onClick={() => { setOpen(true); setSearch('') }}>
          {walkIn ? 'Account' : 'Change'}
        </button>
      </div>
    )
  }

  return (
    <div className="pick">
      <input
        className="field"
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Customer name, place or phone"
        autoComplete="off"
      />
      <div className="pick-list">
        {found.map((c) => (
          <button type="button" key={c._id} onClick={() => { onPick({ name: c.name, phone: c.phone ?? '', place: c.place ?? '', ledgerId: c._id }); setOpen(false) }}>
            <strong>{c.name}</strong>
            <small>{[c.place, c.phone].filter(Boolean).join(' · ') || 'Customer'}</small>
          </button>
        ))}
        {typed && !exact && (
          <button type="button" className="pick-new" onClick={() => { onPick({ name: typed, phone: '', place: '', ledgerId: null }); setOpen(false) }}>
            <strong>New customer: {typed}</strong>
            <small>An account opens with this name when the bill is saved</small>
          </button>
        )}
        {typed && !found.length && exact && <p className="hint">Already an account: pick it above.</p>}
      </div>
      <div className="pick-keys">
        <button type="button" className="key ghost" onClick={() => { onPick({ name: WB, phone: '', place: '', ledgerId: null }); setOpen(false) }}>Walk-in W/B</button>
        <button type="button" className="key ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}

export default function App() {
  const [draft, setDraft] = useState(() => load(DRAFT_KEY, null) ?? newDraft())
  const [saved, setSaved] = useState(() => load(SAVED_KEY, []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const postBill = useMutation(anyApi.billLedger.postBill)
  const toScreen = useCustomerScreen()
  const masters = useQuery(anyApi.masters.all, {})
  const customers = useMemo(
    () => (masters?.ledgers ?? []).filter((l) => l.groupName === 'Sundry Debtors' && l.active !== false),
    [masters],
  )

  useEffect(() => { keep(DRAFT_KEY, draft) }, [draft])

  const { customer, lines } = draft
  const walkIn = isWalkIn(customer.name)
  const total = round2(lines.reduce((t, l) => t + lineAmount(l), 0))
  const paidAmount = walkIn || draft.paidHow === 'full' ? total : draft.paidHow === 'part' ? Math.min(total, round2(num(draft.part))) : 0
  const filled = lines.filter((l) => l.description.trim() || num(l.rate))
  const problem =
    !filled.length ? 'Add an item'
      : filled.some((l) => !l.description.trim()) ? 'An item has no name'
        : filled.some((l) => !(num(l.qty) > 0)) ? 'An item has no quantity'
          : filled.some((l) => !(num(l.rate) > 0)) ? 'An item has no rate'
            : !customer.name.trim() ? 'Pick the customer'
              : ''

  // The counter's customer screen follows the bill as it is typed.
  useEffect(() => {
    if (done) return
    if (!filled.length) { toScreen({ mode: 'idle' }); return }
    toScreen({
      mode: 'bill',
      number: '',
      customerName: walkIn ? '' : customer.name,
      lines: filled.map((l) => ({
        id: l.id, description: l.description.trim(), qty: num(l.qty), unit: l.unit,
        rate: num(l.rate) || undefined, amount: lineAmount(l),
      })),
      total,
      paid: paidAmount,
      quotation: false,
    })
  }, [done, filled, walkIn, customer.name, total, paidAmount, toScreen])

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setLine = (id, patch) => setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const removeLine = (id) => setDraft((d) => {
    const rest = d.lines.filter((l) => l.id !== id)
    return { ...d, lines: rest.length ? rest : [newLine()] }
  })
  const addLine = () => {
    setDraft((d) => ({ ...d, lines: [...d.lines, newLine()] }))
    // The new line's item box, ready to type.
    setTimeout(() => {
      const boxes = document.querySelectorAll('.line-item')
      boxes[boxes.length - 1]?.focus()
    }, 0)
  }

  async function save() {
    if (problem || saving) return
    setSaving(true)
    setError('')
    const bill = {
      id: draft.id,
      number: '',
      date: indiaToday(),
      customerName: walkIn ? WB : customer.name.trim(),
      customerPhone: walkIn ? '' : (customer.phone ?? '').trim(),
      ref: '',
      items: filled.map((l) => ({
        id: l.id,
        description: l.description.trim(),
        qty: num(l.qty),
        unit: l.unit,
        amount: lineAmount(l),
      })),
      total,
      paid: paidAmount >= total && total > 0,
      paidAmount,
      paymentMode: draft.mode,
      upiRef: '',
      notes: '',
    }
    try {
      const args = { bill }
      if (customer.ledgerId) args.partyLedgerId = customer.ledgerId
      const answer = await postBill(args)
      const entry = {
        id: bill.id, number: String(answer?.number ?? ''), name: walkIn ? 'Walk-in' : bill.customerName,
        phone: bill.customerPhone, total, paid: paidAmount, mode: draft.mode, at: Date.now(),
        lines: bill.items.map((i) => `${i.description} ${i.qty} ${i.unit} ${money.format(i.amount)}`),
      }
      const list = [entry, ...saved.filter((s) => s.id !== entry.id)].slice(0, 30)
      setSaved(list)
      keep(SAVED_KEY, list)
      setDone(entry)
      toScreen({ mode: 'thanks', total, customerName: walkIn ? '' : bill.customerName })
    } catch (e) {
      // The books say why in their own words (billLedger.ts inWords).
      const said = e?.data?.message ?? e?.data ?? e?.message ?? 'The bill did not save.'
      setError(String(said).replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0])
    } finally {
      setSaving(false)
    }
  }

  function startNew() {
    const fresh = newDraft()
    setDraft(fresh)
    setDone(null)
    setError('')
    toScreen({ mode: 'idle' })
    window.scrollTo(0, 0)
  }

  const todays = saved.filter((s) => new Date(s.at).toDateString() === new Date().toDateString())

  if (done) {
    const text = [
      'Shiv Hardware, Ramgarh',
      `Bill ${done.number}${done.name && done.name !== 'Walk-in' ? ` · ${done.name}` : ''}`,
      ...done.lines,
      `Total ${rs(done.total)}`,
      done.paid > 0 ? `Paid ${rs(done.paid)}` : '',
      done.total - done.paid > 0 ? `Balance ${rs(done.total - done.paid)}` : '',
    ].filter(Boolean).join('\n')
    const phone = String(done.phone ?? '').replace(/\D/g, '').slice(-10)
    const wa = `https://wa.me/${phone.length === 10 ? `91${phone}` : ''}?text=${encodeURIComponent(text)}`
    return (
      <div className="site">
        <Top />
        <main className="done">
          <div className="done-mark"><Tick /></div>
          <h1>Bill {done.number} saved</h1>
          <p className="done-who">{done.name}</p>
          <p className="done-total">{rs(done.total)}</p>
          <p className="done-paid">
            {done.paid >= done.total ? `Paid in full · ${done.mode === 'cash' ? 'Cash' : 'UPI'}`
              : done.paid > 0 ? `Paid ${rs(done.paid)} · Balance ${rs(done.total - done.paid)}`
                : 'On account'}
          </p>
          <a className="key ghost wide" href={wa} target="_blank" rel="noreferrer">Send on WhatsApp</a>
        </main>
        <div className="dock"><button type="button" className="key must" onClick={startNew}>New bill</button></div>
      </div>
    )
  }

  return (
    <div className="site">
      <Top />
      <main className="form">
        <section>
          <h2>Customer</h2>
          <CustomerPicker customer={customer} customers={customers} onPick={(c) => set({ customer: c, paidHow: 'credit', part: '' })} />
          {!walkIn && !customer.ledgerId && (
            <input
              className="field"
              type="tel"
              inputMode="tel"
              value={customer.phone}
              onChange={(e) => set({ customer: { ...customer, phone: e.target.value } })}
              placeholder="Phone (optional)"
            />
          )}
        </section>

        <section>
          <h2>Items</h2>
          {lines.map((l, i) => (
            <div className="line" key={l.id}>
              <div className="line-head">
                <span className="line-no">{i + 1}</span>
                <input
                  className="field line-item"
                  value={l.description}
                  onChange={(e) => setLine(l.id, { description: e.target.value })}
                  placeholder="Item"
                  autoComplete="off"
                  enterKeyHint="next"
                />
                <button type="button" className="line-drop" aria-label={`Remove item ${i + 1}`} onClick={() => removeLine(l.id)}><Cross /></button>
              </div>
              <div className="line-figs">
                <label>
                  <span>Qty</span>
                  <input className="field num" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value })} onFocus={(e) => e.target.select()} />
                </label>
                <label>
                  <span>Unit</span>
                  <select className="field" value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })}>
                    {UNITS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </label>
                <label>
                  <span>Rate</span>
                  <input className="field num" inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.id, { rate: e.target.value })} placeholder="0" onFocus={(e) => e.target.select()} />
                </label>
                <div className="line-amt">
                  <span>Amount</span>
                  <strong>{money.format(lineAmount(l))}</strong>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="key ghost wide" onClick={addLine}><Plus /> Add item</button>
        </section>

        <section>
          <div className="total"><span>Total</span><strong>{rs(total)}</strong></div>
          {!walkIn && (
            <div className="choice three" role="radiogroup" aria-label="Paid">
              {[['credit', 'On account'], ['full', 'Paid full'], ['part', 'Part paid']].map(([k, label]) => (
                <button type="button" key={k} role="radio" aria-checked={draft.paidHow === k} className={draft.paidHow === k ? 'on' : ''} onClick={() => set({ paidHow: k })}>{label}</button>
              ))}
            </div>
          )}
          {!walkIn && draft.paidHow === 'part' && (
            <label className="part">
              <span>Paid now</span>
              <input className="field num" inputMode="decimal" value={draft.part} onChange={(e) => set({ part: e.target.value })} placeholder="0" />
            </label>
          )}
          {paidAmount > 0 && (
            <div className="choice two" role="radiogroup" aria-label="Paid by">
              {[['upi', 'UPI'], ['cash', 'Cash']].map(([k, label]) => (
                <button type="button" key={k} role="radio" aria-checked={draft.mode === k} className={draft.mode === k ? 'on' : ''} onClick={() => set({ mode: k })}>{label}</button>
              ))}
            </div>
          )}
          {paidAmount > 0 && paidAmount < total && <p className="hint">Balance {rs(total - paidAmount)} goes on the account.</p>}
        </section>

        {todays.length > 0 && (
          <section className="today">
            <h2>Today on this phone</h2>
            {todays.slice(0, 10).map((s) => (
              <div className="today-row" key={s.id}>
                <span className="today-no">{s.number}</span>
                <span className="today-name">{s.name}</span>
                <span className="today-amt">{rs(s.total)}</span>
              </div>
            ))}
          </section>
        )}
      </main>

      <div className="dock">
        {error && <p className="error">{error}</p>}
        <button type="button" className="key must" disabled={Boolean(problem) || saving} onClick={save}>
          {saving ? 'Saving' : problem || `Save bill · ${rs(total)}`}
        </button>
      </div>
    </div>
  )
}

function Top() {
  return (
    <header className="top">
      <div className="mark">S</div>
      <div className="top-copy">
        <h1>Shiv Bill</h1>
        <small>Sale bill · Shiv Hardware</small>
      </div>
    </header>
  )
}
