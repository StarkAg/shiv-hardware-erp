/**
 * The customer's screen (#/customer): the POS's second display, facing the
 * customer across the counter. It shows the bill as the counter types it,
 * the total, a UPI code for that total, and thanks once the bill is saved.
 *
 * It only reads: no keys, no buttons, nothing a customer's finger can change.
 * What it shows comes from src/lib/customerDisplay.ts.
 *
 * The look is Signs (DESIGN.md). Its rules sit under `.cd`, so this screen's
 * stylesheet, fetched into the panel's own window too by preloadPages, leaves
 * the panel alone.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { onCustomerScreen, PHONE_FRESH_MS, type CustomerScreenState } from '../../lib/customerDisplay'
import { assetPath } from '../../lib/assets'
import './customer-screen.css'

const SHOP = 'Shiv Hardware'
const PLACE = 'Ramgarh'
/** The shop's UPI ID (Paytm), given by the owner on 2026-11-20. VITE_SHOP_UPI_ID overrides it. */
const UPI_ID = (import.meta.env.VITE_SHOP_UPI_ID as string | undefined)?.trim() || '8709964141@ptyes'
const UPI_NAME = (import.meta.env.VITE_SHOP_UPI_NAME as string | undefined)?.trim() || 'SHIV HARDWARE'

/** Thanks stays up this long, unless the next bill starts first. */
const THANKS_MS = 8000

const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const rs = (n: number) => `₹${money.format(n)}`

/** Where a state came from: this PC's bill form, or the phone POS through the cloud. */
type Source = 'here' | 'phone'
type Take = (next: CustomerScreenState, source: Source) => void

// The cloud feed (the phone POS's bills) needs Convex, which main.tsx only
// provides when the deployment's address is set.
const cloudReady = Boolean((import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim())

/**
 * What the phone POS put in the cloud (convex/customerScreen.ts). A stale
 * row, from a bill typed long ago, is not shown when the screen opens.
 */
function PhoneFeed({ take }: { take: Take }) {
  const row = useQuery(anyApi.customerScreen.current, {}) as
    | { state: CustomerScreenState; at: number }
    | null
    | undefined
  const seen = useRef(0)
  useEffect(() => {
    if (!row || row.at === seen.current) return
    seen.current = row.at
    if (Date.now() - row.at > PHONE_FRESH_MS) return
    take(row.state, 'phone')
  }, [row, take])
  return null
}

/**
 * A cloud fault (no signal, or the functions not deployed yet) stops only the
 * phone's feed. This PC's own bills keep showing.
 */
class QuietFail extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* the screen goes on without the phone */ }
  render() { return this.state.failed ? null : this.props.children }
}

function useScreenState() {
  const [state, setState] = useState<CustomerScreenState>({ mode: 'idle' })
  const thanksUntil = useRef(0)
  const shownFrom = useRef<Source>('here')
  const take = useRef<Take>((next, source) => {
    // A form closing on one device says "idle"; that must not blank a bill
    // the other device is typing. Only the device on screen can clear it.
    if (next.mode === 'idle' && source !== shownFrom.current) return
    if (next.mode === 'thanks') thanksUntil.current = Date.now() + THANKS_MS
    // The bill form goes back to its list as it saves, which says "idle" a
    // moment after "thanks"; thanks stays. A new bill with a line ends it.
    else if (Date.now() < thanksUntil.current) {
      const started = next.mode === 'bill' && next.lines.length > 0
      if (!started) return
      thanksUntil.current = 0
    }
    shownFrom.current = source
    setState(next)
  }).current
  useEffect(() => onCustomerScreen((next) => take(next, 'here')), [take])
  // Back to the shop's name once thanks has been read.
  useEffect(() => {
    if (state.mode !== 'thanks') return
    const t = setTimeout(() => {
      thanksUntil.current = 0
      setState({ mode: 'idle' })
    }, THANKS_MS)
    return () => clearTimeout(t)
  }, [state])
  return { state, take }
}

function UpiCode({ total }: { total: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!UPI_ID || !(total > 0)) { setSrc(''); return }
    const link = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${total.toFixed(2)}&cu=INR`
    let live = true
    QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'M' })
      .then((url) => { if (live) setSrc(url) })
      .catch(() => { if (live) setSrc('') })
    return () => { live = false }
  }, [total])
  if (!src) return null
  return (
    <div className="cd-upi">
      <img src={src} alt="" />
      <p className="cd-upi-label">Scan to pay by UPI</p>
      <p className="cd-upi-id">{UPI_ID}</p>
    </div>
  )
}

function Header({ right }: { right?: string }) {
  return (
    <header className="cd-head">
      <img src={assetPath('assets/letterhead/shiv-logo.png')} alt="" />
      <div className="cd-head-name">
        <strong>{SHOP}</strong>
        <span>{PLACE}</span>
      </div>
      {right && <span className="cd-head-right">{right}</span>}
    </header>
  )
}

export function CustomerScreen() {
  const { state, take } = useScreenState()
  return (
    <>
      {cloudReady && <QuietFail><PhoneFeed take={take} /></QuietFail>}
      <Screen state={state} />
    </>
  )
}

function Screen({ state }: { state: CustomerScreenState }) {

  // Hide the pointer: nobody works this screen.
  useEffect(() => {
    document.title = `${SHOP} | Customer screen`
    document.documentElement.classList.add('cd-page')
    return () => document.documentElement.classList.remove('cd-page')
  }, [])

  // The newest line, lit for a moment as it arrives.
  const prevIds = useRef<Set<string>>(new Set())
  const [fresh, setFresh] = useState<string | null>(null)
  const listEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.mode !== 'bill') { prevIds.current = new Set(); return }
    const added = state.lines.filter((l) => !l.worked && !prevIds.current.has(l.id)).pop()
    prevIds.current = new Set(state.lines.map((l) => l.id))
    if (added) {
      setFresh(added.id)
      listEnd.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
      const t = setTimeout(() => setFresh(null), 1600)
      return () => clearTimeout(t)
    }
  }, [state])

  if (state.mode === 'thanks') {
    return (
      <div className="cd cd-thanks">
        <Header />
        <main>
          <div className="cd-done-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="88" height="88" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square"><path d="M4 12.5l5 5L20 6.5" /></svg>
          </div>
          <h1>Thank you{state.customerName ? `, ${state.customerName}` : ''}</h1>
          <p className="cd-thanks-total">{rs(state.total)}</p>
          <p className="cd-thanks-line">Please visit again</p>
        </main>
      </div>
    )
  }

  if (state.mode === 'idle' || (state.mode === 'bill' && !state.lines.length && !state.total)) {
    return (
      <div className="cd cd-idle">
        <main>
          <img className="cd-idle-logo" src={assetPath('assets/letterhead/shiv-logo.png')} alt="" />
          <h1>{SHOP}</h1>
          <p className="cd-idle-place">{PLACE}</p>
          <div className="cd-idle-rule" />
          <p className="cd-welcome">Welcome</p>
        </main>
      </div>
    )
  }

  const goods = state.lines.filter((l) => !l.worked)
  const worked = state.lines.filter((l) => l.worked)
  const due = Math.max(0, state.total - state.paid)

  return (
    <div className="cd cd-bill">
      <Header right={state.quotation ? 'Quotation' : `Bill ${state.number}`} />
      <div className="cd-body">
        <section className="cd-lines">
          {state.customerName && <p className="cd-for">{state.customerName}</p>}
          <div className="cd-row cd-row-head">
            <span>Item</span>
            <span className="cd-num">Qty</span>
            <span className="cd-num">Rate</span>
            <span className="cd-num">Amount</span>
          </div>
          <div className="cd-scroll">
            {goods.map((l, i) => (
              <div key={l.id} className={`cd-row${fresh === l.id ? ' cd-fresh' : ''}`}>
                <span className="cd-item"><em>{i + 1}</em>{l.description || 'Item'}</span>
                <span className="cd-num">{l.qty ? `${whole.format(l.qty)} ${l.unit}`.trim() : ''}</span>
                <span className="cd-num">{l.rate !== undefined ? money.format(l.rate) : ''}</span>
                <span className="cd-num cd-amt">{money.format(l.amount)}</span>
              </div>
            ))}
            <div ref={listEnd} />
          </div>
        </section>

        <aside className="cd-side">
          <div className="cd-sums">
            {worked.length > 0 && (
              <>
                <div className="cd-sum"><span>Items</span><span>{rs(goods.reduce((s, l) => s + l.amount, 0))}</span></div>
                {worked.map((l) => (
                  <div key={l.id} className="cd-sum"><span>{l.description}</span><span>{l.amount < 0 ? `- ${rs(-l.amount)}` : rs(l.amount)}</span></div>
                ))}
              </>
            )}
            <div className="cd-total">
              <span>Total</span>
              <strong>{rs(state.total)}</strong>
              <small>{goods.length} {goods.length === 1 ? 'item' : 'items'}</small>
            </div>
            {state.paid > 0 && (
              <>
                <div className="cd-sum cd-paid"><span>Paid</span><span>{rs(state.paid)}</span></div>
                {due > 0 && <div className="cd-sum cd-due"><span>Balance</span><span>{rs(due)}</span></div>}
              </>
            )}
          </div>
          {!state.quotation && <UpiCode total={state.paid > 0 ? due : state.total} />}
        </aside>
      </div>
    </div>
  )
}
