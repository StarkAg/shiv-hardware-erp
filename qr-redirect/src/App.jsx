// The guarantee card, served from this host on its own: nothing here is fetched from,
// linked to or named after the shop's site. The card and its claims come straight from
// Convex with the number and secret in the QR (the same gate the shop's page used).
import { useCallback, useEffect, useState } from 'react'
import Verified from './Verified'
import FitToScreen from './FitToScreen'
import CardActions from './CardActions'

const CONVEX_URL = 'https://sensible-panther-176.convex.cloud'
// <host>/<card number>/<card secret>, as printed in the QR (same as middleware.js).
const CARD_PATH = /^\/(GC-[A-Za-z0-9-]+)\/([A-Z0-9]{8,64})\/?$/

async function query(path, args) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (json.status !== 'success') throw new Error('query failed')
  return json.value
}

async function loadCard(number, token) {
  const v = await query('documents:getGuaranteeByNumber', { number, token })
  if (!v) return null
  // Convex stores the full payload under `document`; flatten it up.
  return v.document && typeof v.document === 'object' ? { ...v, ...v.document } : v
}

async function loadClaims(number, token) {
  try {
    const v = await query('guaranteeClaims:forCard', { number, token })
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

const CLAIM_STATUS = { new: 'Received', reviewing: 'Under review', approved: 'Approved', rejected: 'Not approved', replaced: 'Replaced' }
const CLAIM_ISSUE = { borer: 'Borer', air: 'Air bubbles' }

// Sizes are inches + eighths (soot). Eighths print as their fraction glyph: 44 4/8" -> 44½″.
const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
const NBSP = ' '
function fmtDim(d) {
  if (!d || (!d.inches && !d.soot)) return ''
  const soot = Number(d.soot) || 0
  const frac = soot > 0 && soot < 8 ? EIGHTHS[soot] : ''
  return `${d.inches || (frac ? '' : 0)}${frac}″`
}
/** An item's size as the bill wrote it ("7 X 4" feet) when the card carries one, else its inches. */
function itemSize(it) {
  return (it.sizeLabel && String(it.sizeLabel).trim()) || fmtSize(it.height, it.width)
}
function fmtSize(h, w) {
  const a = fmtDim(h)
  const b = fmtDim(w)
  return a && b ? `${a}${NBSP}×${NBSP}${b}` : a || b || ''
}
// "19MM" -> "19 mm"; anything else is shown as typed.
function fmtThickness(t) {
  const s = String(t || '').trim()
  const m = s.match(/^(\d+(?:\.\d+)?)\s*mm$/i)
  return m ? `${m[1]}${NBSP}mm` : s
}
// The wax seals (public/assets, the web versions from the shop site's card page). One goes on the card by the total,
// stamped at the angle a hand would leave it. The angle comes from the card number,
// so a card looks the same every time it is opened.
const SEAL_YEARS = [1, 3, 7, 10, 20, 25]
function stampPose(seed) {
  // -span/2 .. +span/2, from its own FNV-1a hash per value so they vary independently.
  const pick = (salt, span) => {
    let h = 2166136261
    for (const c of `${seed}|${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    return (h % 1000) / 1000 * span - span / 2
  }
  const turn = pick('turn', 40)
  return {
    turn: Math.abs(turn) < 6 ? turn + Math.sign(turn || 1) * 6 : turn, // never almost straight
    x: Math.round(pick('x', 12)),
    y: Math.round(pick('y', 8)),
  }
}
function Stamp({ years, seed }) {
  if (!years) return null
  const { turn, x, y } = stampPose(seed)
  const style = { '--turn': `${turn.toFixed(1)}deg`, '--dx': `${x}px`, '--dy': `${y}px` }
  const label = `${years} year guarantee against borer`
  return SEAL_YEARS.includes(years)
    ? <img className="gc-stamp" style={style} src={`/assets/seal-${years}yr.png`} alt={label} width="220" height="220" />
    : <span className="gc-stamp gc-stamp-ink" style={style} role="img" aria-label={label}><b>{years}</b>{years === 1 ? 'YEAR' : 'YEARS'}<small>GUARANTEE</small></span>
}
const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`

export default function App() {
  const m = window.location.pathname.match(CARD_PATH)
  const number = m ? decodeURIComponent(m[1]) : ''
  const token = m ? m[2] : ''
  const [state, setState] = useState(m ? { status: 'loading' } : { status: 'none' })

  useEffect(() => {
    document.title = number ? `Guarantee Card ${number}` : 'Guarantee card'
    if (!number) return
    let live = true
    Promise.all([loadCard(number, token), loadClaims(number, token)])
      .then(([doc, claims]) => live && setState(doc ? { status: 'card', doc, claims } : { status: 'missing' }))
      .catch(() => live && setState({ status: 'error' }))
    return () => { live = false }
  }, [number, token])

  const refreshClaims = useCallback(async () => {
    const claims = await loadClaims(number, token)
    setState((s) => (s.status === 'card' ? { ...s, claims } : s))
  }, [number, token])

  if (state.status === 'card') {
    const { doc, claims } = state
    return (
      <div className="gc-page">
        <Verified number={doc.number || number} />
        <div className="gc-wrap">
          <FitToScreen>
            <Head number={doc.number || number} verified />
            <CardView doc={doc} token={token} claims={claims} onClaimed={refreshClaims} />
          </FitToScreen>
        </div>
      </div>
    )
  }

  const message = {
    none: ['Guarantee card', 'Scan the QR code on your guarantee card to open it.'],
    loading: [null, 'Opening the card…'],
    missing: ['Card not found', <>No guarantee card matches <b>{number}</b>. Please check the link, or contact the seller.</>],
    error: ['Could not open the card', 'Please check your connection and try again.'],
  }[state.status]
  return (
    <div className="gc-page">
      <div className="gc-wrap">
        <Head number={number} />
        <div className="gc-miss">
          {message[0] ? <h2>{message[0]}</h2> : null}
          <p>{message[1]}</p>
        </div>
      </div>
    </div>
  )
}

function Head({ number, verified = false }) {
  return (
    <div className="gc-head">
      <span className="gc-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2.5c2.2 1.7 4.9 2.6 7.5 2.6v5.6c0 4.9-3.2 8.4-7.5 9.8-4.3-1.4-7.5-4.9-7.5-9.8V5.1c2.6 0 5.3-.9 7.5-2.6z" />
        </svg>
      </span>
      <div className="gc-brand">
        Guarantee Card
        <small>Online record</small>
      </div>
      <div className="gc-head-right">
        {number ? <span className="gc-tag">{number}</span> : null}
        {verified ? (
          <span className="gc-verified">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Verified
          </span>
        ) : null}
      </div>
    </div>
  )
}

function CardView({ doc, token, claims, onClaimed }) {
  const cust = doc.customer || {}
  const items = Array.isArray(doc.items) ? doc.items : []
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  const maxYears = Math.max(0, ...items.map((it) => Number(it.guaranteeYears) || 0))
  const dateStr = doc.date ? new Date(doc.date).toLocaleDateString('en-GB') : ''

  return (
    <>
      <div className="gc-card">
        <div className="gc-name">{cust.name || '—'}</div>
        <div className="gc-facts">
          <div className="gc-fact"><span className="k">Aadhaar</span><span className="v">{cust.uid || 'N/A'}</span></div>
          <div className="gc-fact"><span className="k">Phone</span><span className="v">{cust.mobile ? <a href={`tel:${cust.mobile}`}>{cust.mobile}</a> : 'N/A'}</span></div>
          {dateStr ? <div className="gc-fact"><span className="k">Date</span><span className="v">{dateStr}</span></div> : null}
        </div>
      </div>

      <div className="gc-card">
        <h2>Items</h2>
        {items.length ? items.map((it, i) => {
          const spec = [fmtThickness(it.thickness), itemSize(it)].filter(Boolean)
          const qty = Number(it.qty) || 0
          return (
            <div className="gc-item" key={i}>
              <div className="gc-item-body">
                <div className="gc-item-top">
                  <div className="brand">{it.brandName || '—'}</div>
                  {Number(it.amount) ? <span className="gc-amt">{rupees(it.amount)}</span> : null}
                </div>
                {spec.length || qty ? (
                  <div className="gc-item-bottom">
                    {spec.length ? (
                      <span className="gc-spec">
                        {spec.map((s, j) => <span key={j}>{j ? <span className="dot">·</span> : null}{s}</span>)}
                      </span>
                    ) : null}
                    {qty ? <span className="gc-qty">{qty} {qty === 1 ? 'pc' : 'pcs'}</span> : null}
                  </div>
                ) : null}
              </div>
            </div>
          )
        }) : <div className="gc-empty">No items listed on this card.</div>}
        {total > 0 || maxYears > 0 ? (
          <div className="gc-total">
            <Stamp years={maxYears} seed={doc.number} />
            {total > 0 ? <div className="gc-total-sum"><span>Total</span><b>{rupees(total)}</b></div> : null}
          </div>
        ) : null}
      </div>
      {claims.length ? (
        <div className="gc-card gc-claims">
          <h2>Your claims</h2>
          {claims.map((c) => (
            <div className="gc-claim" key={c.ref}>
              <div className="gc-claim-top">
                <span className="gc-claim-ref">{c.ref}</span>
                <span className={`gc-status is-${c.status}`}>{CLAIM_STATUS[c.status] || c.status}</span>
              </div>
              <div className="gc-claim-sub">
                {CLAIM_ISSUE[c.issue] || c.issue} · {c.doors} {c.doors === 1 ? 'door' : 'doors'} · {new Date(c.createdAt).toLocaleDateString('en-GB')}
              </div>
              {c.note ? <div className="gc-claim-note">{c.note}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="gc-terms-short">
        <span>Terms</span>
        <ul>
          {/* A card made with its termite line switched off is guaranteed against termites too. */}
          {doc.termiteNote === false
            ? <li>Covers borer, termite and air bubbles.</li>
            : <><li>Covers borer and air bubbles only.</li><li>Termite damage is not covered.</li></>}
          <li>Valid for the years shown, from the date on this card.</li>
          <li>Replacement requires the original card and bill, subject to inspection.</li>
        </ul>
      </div>
      <CardActions
        onClaimed={onClaimed}
        convexUrl={CONVEX_URL}
        number={doc.number}
        token={token}
        termiteCovered={doc.termiteNote === false}
        items={items.map((it) => ({
          label: [it.brandName || 'Item', fmtThickness(it.thickness), itemSize(it)].filter(Boolean).join(' · '),
          qty: Number(it.qty) || 0,
        }))}
      />
    </>
  )
}
