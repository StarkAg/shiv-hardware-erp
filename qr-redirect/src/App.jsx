// The guarantee card, served from this host on its own: nothing here is fetched from,
// linked to or named after the shop's site. The card and its claims come straight from
// Convex with the number and secret in the QR (the same gate the shop's page used).
// It looks like the shop site's page (the card lying on the plywood it guarantees,
// app/Gaurantee/[number]/page.jsx there), without the shop's name or logo.
import { useCallback, useEffect, useState } from 'react'
import CardStage from './CardStage'
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
const NBSP = ' '
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
// Only the last four digits of the Aadhaar: the link can be shared, and a lost card read.
function maskUid(uid) {
  const digits = String(uid || '').replace(/\D/g, '')
  return digits.length >= 4 ? `XXXX XXXX ${digits.slice(-4)}` : uid || 'N/A'
}
// The wax seals (public/assets, the web versions from the shop site's card page). One goes
// on the card by the total, pressed at the angle a hand would leave it. The angle comes
// from the card number, so a card looks the same every time it is opened. A period with
// no seal of its own has none: the years stamped on the wood already say it.
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
function Seal({ years, seed }) {
  if (!SEAL_YEARS.includes(years)) return null
  const { turn, x, y } = stampPose(seed)
  const style = { '--turn': `${turn.toFixed(1)}deg`, '--dx': `${x}px`, '--dy': `${y}px` }
  return <img className="gc-seal" style={style} src={`/assets/seal-${years}yr.png`} alt={`${years} year guarantee seal`} width="264" height="264" />
}
const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
// Rows of one brand (and one guarantee period) together, in the card's order: the brand
// is said once, then one line per size. A card holds up to 18 rows (Shiv_Panel
// print-server/template.mjs CARD_ROW_STEP_MM), so this keeps a full one readable.
// The shop's short codes for the Signature range, written out where they stand as a word
// ("WPC Chowket S", "SGC"); the printed card keeps them short.
const BRAND_CODES = { S: 'Signature', SG: 'Signature Gold', SGC: 'Signature Gold Club' }
function brandLabel(name) {
  return String(name || '').trim().replace(/\b(SGC|SG|S)\b/g, (code) => BRAND_CODES[code])
}
function groupByBrand(items) {
  const groups = []
  for (const it of items) {
    const brand = brandLabel(it.brandName)
    const years = Number(it.guaranteeYears) || 0
    const last = groups[groups.length - 1]
    if (last && last.brand === brand && last.years === years) last.items.push(it)
    else groups.push({ brand, years, items: [it] })
  }
  return groups
}

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
    return (
      <div className="gc-page">
        <CardView doc={state.doc} number={state.doc.number || number} token={token} claims={state.claims} onClaimed={refreshClaims} />
      </div>
    )
  }

  const message = {
    none: ['Guarantee card', 'Scan the QR code on your guarantee card to open it.'],
    loading: [null, 'Opening the card…'],
    missing: ['Card not found', <>No guarantee card matches <b>{number}</b>. Please scan the QR on the card again, or ask the seller.</>],
    error: ['Could not open the card', 'Please check your connection and try again.'],
  }[state.status]
  return (
    <div className="gc-page">
      <main className="gc-door">
        <Top />
        <div className="gc-miss" role={state.status === 'loading' ? 'status' : undefined}>
          {message[0] ? <h1>{message[0]}</h1> : null}
          <p>{message[1]}</p>
        </div>
      </main>
    </div>
  )
}

function Top({ verified = false }) {
  return (
    <div className="gc-top">
      <span className="gc-who">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2.5c2.2 1.7 4.9 2.6 7.5 2.6v5.6c0 4.9-3.2 8.4-7.5 9.8-4.3-1.4-7.5-4.9-7.5-9.8V5.1c2.6 0 5.3-.9 7.5-2.6z" />
        </svg>
        Guarantee card
      </span>
      {verified ? (
        <span className="gc-ok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Verified
        </span>
      ) : null}
    </div>
  )
}

function CardView({ doc, number, token, claims, onClaimed }) {
  const cust = doc.customer || {}
  const items = Array.isArray(doc.items) ? doc.items : []
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  const maxYears = Math.max(0, ...items.map((it) => Number(it.guaranteeYears) || 0))
  const dateStr = doc.date ? new Date(doc.date).toLocaleDateString('en-GB').replaceAll('/', '.') : ''

  return (
    <main className="gc-door">
      <Top verified />

      {maxYears > 0 ? (
        <div className="gc-years" role="img" aria-label={`${maxYears} year guarantee against borer`}>
          <span className="n" aria-hidden="true">{maxYears}</span>
          <span className="w" aria-hidden="true">{maxYears === 1 ? 'Year' : 'Years'}<small>guarantee against borer</small></span>
        </div>
      ) : <div />}

      <CardStage label={`Guarantee card ${number}`} rows={items.length}>
        <div className="gc-face gc-front">
          <div className="gc-no">Guarantee card <b>{number}</b></div>
          <div>
            <h1>{cust.name || '—'}</h1>
            <dl className="gc-facts">
              <dt>Aadhaar</dt><dd>{maskUid(cust.uid)}</dd>
              <dt>Phone</dt><dd>{cust.mobile ? <a href={`tel:${cust.mobile}`}>{cust.mobile}</a> : 'N/A'}</dd>
              {dateStr ? <><dt>Date</dt><dd>{dateStr}</dd></> : null}
            </dl>
          </div>
          <div className="gc-rows">
            {items.length ? groupByBrand(items).map((g, i) => (
              <ul className="gc-items" key={i}>
                {g.brand || g.years !== maxYears ? (
                  <li className="brand">{g.brand}{g.years !== maxYears ? <span>{g.years ? `${g.years} ${g.years === 1 ? 'yr' : 'yrs'}` : 'No guarantee'}</span> : null}</li>
                ) : null}
                {g.items.map((it, j) => {
                  const qty = Number(it.qty) || 0
                  const spec = [fmtThickness(it.thickness), itemSize(it), qty ? `${qty} ${qty === 1 ? 'pc' : 'pcs'}` : ''].filter(Boolean)
                  return (
                    <li key={j}>
                      {/* Each part kept whole: a line breaks between "81″ × 36″" and "4 pcs", never inside one. */}
                      <span className="spec">{spec.length ? spec.map((s, k) => <span key={k}>{k ? ' · ' : ''}<span>{s}</span></span>) : '—'}</span>
                      {Number(it.amount) ? <span className="amt">{rupees(it.amount)}</span> : null}
                    </li>
                  )
                })}
              </ul>
            )) : <p className="gc-none">No items listed on this card.</p>}
          </div>
          <div className="gc-foot">
            <Seal years={maxYears} seed={number} />
            {total > 0 ? <div className="gc-sum"><small>Total</small><b>{rupees(total)}</b></div> : null}
          </div>
        </div>
      </CardStage>

      <div className="gc-act">
        {claims.length ? (
          <section className="gc-claims">
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
          </section>
        ) : null}
        <CardActions
          onClaimed={onClaimed}
          convexUrl={CONVEX_URL}
          number={number}
          token={token}
          termiteCovered={doc.termiteNote === false}
          items={items.map((it) => ({
            label: [brandLabel(it.brandName) || 'Item', fmtThickness(it.thickness), itemSize(it)].filter(Boolean).join(' · '),
            qty: Number(it.qty) || 0,
          }))}
        />
        {/* A card made with its termite line switched off is guaranteed against termites too. */}
        <p className="gc-terms">
          {doc.termiteNote === false ? 'Covers borer, termites and air bubbles' : 'Covers borer and air bubbles, not termites'}, from the card&apos;s date.
          {' '}Bring the original card and bill; the door is inspected.
        </p>
      </div>
    </main>
  )
}
