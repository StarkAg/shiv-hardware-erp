import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

const api = anyApi.prices

/**
 * Price List: the makers' rates, found by typing what the customer asks for —
 * "17x20x6 plain", "thali", "3883" — and narrowed to a brand with one key.
 *
 * Each row is one item as the maker's list prints it: what it is and its size
 * large, its grade, code and wire under it, and at the right the net rate
 * (what the shop pays) over the MRP. An item the list has no rate for is
 * marked yellow: waiting for one. A tap opens the rates to correct.
 */

/** The brands in the order the counter asks for them; others follow by name. */
const BRAND_ORDER = ['Godrej', 'Olive', 'Truluv', 'Silver Shine']

// The last list this phone saw, so the app opens at once and without signal.
const CACHE_KEY = 'shiv-prices:list'
const readCache = () => {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') } catch { return null }
}
const writeCache = (items) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)) } catch { /* full or blocked: the live list still shows */ }
}

const money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const rupees = (n) => (typeof n === 'number' ? `₹${money.format(n)}` : '')

/** One spelling for sizes and words: "17 X 20 x 6", "17*20*6" and "17×20×6" are one size. */
const fold = (s) => String(s ?? '').toLowerCase().replace(/[×*]/g, 'x').replace(/\s*x\s*/g, 'x').replace(/[″"]/g, 'in')

const haystack = (it) => fold([
  it.brand, it.grade && `grade ${it.grade} ss${it.grade}`, it.code, it.product, it.size, it.wire, it.finish, it.netLabel,
].filter(Boolean).join(' '))

/**
 * The keys at the top: a brand, and for Godrej its grade. Nothing finer — a
 * key for every item, size and wire came to fifty keys for Silver Shine; the
 * items are the list's subtitles instead, and a size is typed in the search.
 */
const STAGES = [
  { key: 'brand', label: 'Brand', show: (v) => v, order: (values) => [...values].sort((a, b) => {
    const ra = BRAND_ORDER.indexOf(a), rb = BRAND_ORDER.indexOf(b)
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.localeCompare(b)
  }) },
  { key: 'grade', label: 'Grade', show: (v) => `Grade ${v}`, order: (values) => [...values].sort() },
]

/** The numbers in a size, for ordering 15×20 before 17×20 and 4″ before 6″. */
const sizeKey = (size) => (String(size).match(/\d+/g) ?? []).map((n) => n.padStart(4, '0')).join('.')

function sortItems(items) {
  const brandRank = (b) => { const i = BRAND_ORDER.indexOf(b); return i < 0 ? BRAND_ORDER.length : i }
  return [...items].sort((a, b) =>
    brandRank(a.brand) - brandRank(b.brand) || a.brand.localeCompare(b.brand) ||
    String(a.grade ?? '').localeCompare(String(b.grade ?? '')) ||
    a.product.localeCompare(b.product) ||
    sizeKey(a.size).localeCompare(sizeKey(b.size)) ||
    String(a.wire ?? '').localeCompare(String(b.wire ?? '')))
}

export default function App() {
  const live = useQuery(api.list, {})
  const [cached] = useState(readCache)
  useEffect(() => { if (live) writeCache(live) }, [live])
  const items = live ?? cached

  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  /*
   * Filters as the Inventory app has them: the brands first, and once one is
   * chosen, its grades if it has more than one. A key pressed again lets go;
   * choosing another brand starts afresh.
   */
  const [picked, setPicked] = useState({})
  const pick = (stage, value) => setPicked((was) => {
    if (stage === 'brand') return was.brand === value ? {} : { brand: value }
    const next = { ...was }
    if (was[stage] === value) delete next[stage]
    else next[stage] = value
    return next
  })

  const sorted = useMemo(() => sortItems((items ?? []).map((it) => ({ ...it, hay: haystack(it) }))), [items])
  const stages = useMemo(() => STAGES
    .filter((s) => s.key === 'brand' || picked.brand !== undefined)
    .map((s) => {
      const pool = sorted.filter((it) => STAGES.every((o) => o.key === s.key || picked[o.key] === undefined || it[o.key] === picked[o.key]))
      return { ...s, values: s.order([...new Set(pool.map((it) => it[s.key]).filter((v) => v !== undefined && v !== ''))]) }
    })
    .filter((s) => s.values.length > 1 || picked[s.key] !== undefined), [sorted, picked])

  const shown = useMemo(() => {
    const words = fold(search).split(/\s+/).filter(Boolean)
    return sorted.filter((it) =>
      STAGES.every((s) => picked[s.key] === undefined || it[s.key] === picked[s.key]) &&
      words.every((w) => it.hay.includes(w)))
  }, [sorted, search, picked])

  // Grouped as the makers' lists are: a brand (and grade), then under it a
  // subtitle for each item — Plain, Thali, Cutlery — with its sizes beneath.
  const groups = useMemo(() => {
    const out = []
    for (const it of shown) {
      const head = it.grade ? `${it.brand} · Grade ${it.grade}` : it.brand
      let group = out[out.length - 1]
      if (group?.head !== head) { group = { head, parts: [] }; out.push(group) }
      let part = group.parts[group.parts.length - 1]
      if (part?.product !== it.product) { part = { product: it.product, items: [] }; group.parts.push(part) }
      part.items.push(it)
    }
    return out
  }, [shown])

  const categories = [...new Set((items ?? []).map((it) => it.category))]

  return (
    <div className="app">
      <header className="top">
        <div className="names">
          <h1 className="brandname">Price List</h1>
          {categories.length > 0 && <span className="sub">{categories.join(' · ')}</span>}
        </div>
        <span className="count">
          {items ? (shown.length === items.length ? `${items.length} items` : `${shown.length} of ${items.length}`) : ''}
        </span>
      </header>

      <div className="find">
        <label className="search">
          <span className="sr">Search</span>
          <input
            type="search"
            inputMode="search"
            placeholder="Size, item or code: 17x20x6 plain"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the price list"
          />
        </label>
        <div className="stages" aria-label="Filters">
          {stages.map((s) => (
            <div key={s.key} className="chips" role="group" aria-label={s.label}>
              {s.values.map((value) => (
                <button key={value} type="button" className={picked[s.key] === value ? 'on' : ''} aria-pressed={picked[s.key] === value}
                  onClick={() => pick(s.key, value)}>
                  {s.show(value)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <main className="list">
        {!items && <p className="quiet">Loading the list…</p>}
        {items && items.length === 0 && <p className="quiet">The list is empty. Seed it from a maker's list (scripts/seed-prices.mjs).</p>}
        {items && items.length > 0 && shown.length === 0 && <p className="quiet">Nothing matches “{search}”.</p>}
        {groups.map((g) => (
          <section key={g.head} className="group">
            <h2>{g.head}</h2>
            {g.parts.map((part) => (
              <div key={part.product} className="part">
                <h3>{part.product}</h3>
                <ul>
                  {part.items.map((it) => <Row key={it._id} it={it} onOpen={() => setEditing(it)} />)}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </main>

      {editing && <EditRates it={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function Row({ it, onOpen }) {
  const facts = [it.code && `Code ${it.code}`, it.wire, it.finish].filter(Boolean)
  const noRate = it.net == null && it.mrp == null
  return (
    <li>
      <button type="button" className="row" onClick={onOpen}>
        <span className="what">
          <span className="name size">{it.size || it.product}</span>
          {facts.length > 0 && <span className="facts">{facts.join(' · ')}</span>}
        </span>
        {noRate ? (
          <span className="norate">No rate</span>
        ) : (
          <span className="rates">
            {it.net != null && <span className="net">{rupees(it.net)}</span>}
            {it.net != null && <span className="label">{it.netLabel ?? 'Net'}</span>}
            {it.mrp != null && <span className={it.net != null ? 'mrp' : 'net'}>{it.net != null ? `MRP ${rupees(it.mrp)}` : rupees(it.mrp)}</span>}
            {it.net == null && <span className="label">MRP</span>}
          </span>
        )}
      </button>
    </li>
  )
}

/** The rates of one item, to put right. Blank clears a rate. */
function EditRates({ it, onClose }) {
  const setRates = useMutation(api.setRates)
  const [mrp, setMrp] = useState(it.mrp ?? '')
  const [net, setNet] = useState(it.net ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const back = useRef(null)

  // While the box is up, the list under it cannot be tabbed into or tapped.
  useEffect(() => {
    const under = [...(back.current?.parentElement?.children ?? [])].filter((el) => el !== back.current && !el.inert)
    for (const el of under) el.inert = true
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', esc)
    return () => { for (const el of under) el.inert = false; removeEventListener('keydown', esc) }
  }, [onClose])

  const asRate = (s) => (String(s).trim() === '' ? null : Number(s))
  const save = async (e) => {
    e.preventDefault()
    const m = asRate(mrp), n = asRate(net)
    if ([m, n].some((x) => x !== null && !(x >= 0))) return setError('Enter a rate of 0 or more, or leave it blank.')
    setBusy(true)
    setError('')
    try {
      await setRates({ id: it._id, mrp: m, net: n })
      onClose()
    } catch (err) {
      setError(String(err?.data ?? err?.message ?? err))
      setBusy(false)
    }
  }

  return (
    <div className="sheetback" ref={back} onClick={busy ? undefined : onClose}>
      <form className="sheet" role="dialog" aria-modal="true" aria-label={`Rates of ${it.product} ${it.size}`} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <span className="sheettitle">{it.product} {it.size}</span>
        <p>{[it.brand, it.grade && `Grade ${it.grade}`, it.code && `Code ${it.code}`, it.wire, it.finish].filter(Boolean).join(' · ')}</p>
        <label className="field">
          <span>{it.netLabel ?? 'Net'} (what the shop pays)</span>
          <input type="number" inputMode="decimal" step="0.01" min="0" value={net} onChange={(e) => setNet(e.target.value)} />
        </label>
        <label className="field">
          <span>MRP</span>
          <input type="number" inputMode="decimal" step="0.01" min="0" value={mrp} onChange={(e) => setMrp(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sheetbtns">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="safe" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
