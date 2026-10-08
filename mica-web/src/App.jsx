import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { Capture, ReadingStrip, Shades } from './Capture'
import { difference, distance, nearest, similarity, verdict } from './color'

const api = anyApi

const FINISHES = ['HD Glossy', 'Gloss', 'Matte', 'Suede', 'Textured', 'Super Matte']

/** The last brand, catalog and finish typed, so a page of chips is only codes. */
const remembered = (key) => { try { return localStorage.getItem(`mica:${key}`) ?? '' } catch { return '' } }
const remember = (key, value) => { try { localStorage.setItem(`mica:${key}`, value) } catch { /* private window */ } }

const label = (c) => [c.brand, c.catalog, c.code].filter(Boolean).join(' · ')

/** A reading or a saved chip, as one side of a comparison. */
const fromReading = (r) => r && ({ shades: r.shades, texture: r.texture, corrected: r.corrected, img: r.thumb.toDataURL('image/jpeg', 0.8), title: 'From camera' })
const fromChip = (c) => c && ({ shades: c.shades, texture: c.texture, corrected: c.corrected, img: c.photoUrl, title: c.code, sub: [c.brand, c.catalog].filter(Boolean).join(' · '), id: c._id })

const HINTS = {
  find: 'Piece on white paper · paper inside the dashed frame',
  compare: 'Aim at a piece, then Set A or Set B',
  add: 'One chip in the square · white board in the dashed frame',
}

/**
 * One screen, never scrolled: the tabs on top, the camera filling the middle,
 * and the tab's own work — matches, the two sides, or the save box — along
 * the bottom. Only the chip list scrolls, inside its own space.
 *
 * The camera is one and the same on Find, Compare and Add: it stays where it
 * is in the page while the tabs change what is under it, so switching tabs
 * never closes the camera and waits for it to open again.
 */
export default function App() {
  const [tab, setTab] = useState('find')
  const chips = useQuery(api.mica.list, {})
  const [reading, setReading] = useState(null)
  // The two sides on Compare, kept when moving between tabs.
  const [sides, setSides] = useState({ a: null, b: null })
  const compare = (a, b) => { setSides({ a, b }); setTab('compare') }

  return (
    <div className="app">
      <header className="top">
        <img className="logo" src="/icon.svg" alt="" />
        <nav className="tabs">
          {[['find', 'Find'], ['compare', 'Compare'], ['add', 'Add'], ['chips', `Chips${chips ? ` ${chips.length}` : ''}`]].map(([key, text]) => (
            <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{text}</button>
          ))}
        </nav>
      </header>
      <main className="page">
        {tab !== 'chips' && <Capture onRead={setReading} hint={HINTS[tab]} />}
        {tab === 'find' && <Find chips={chips} reading={reading} onCompare={compare} />}
        {tab === 'compare' && <Compare chips={chips} reading={reading} sides={sides} setSides={setSides} />}
        {tab === 'add' && <Add chips={chips} reading={reading} />}
        {tab === 'chips' && <Chips chips={chips} />}
      </main>
    </div>
  )
}

/* ── Find ─────────────────────────────────────────────────────────────── */

function Find({ chips, reading, onCompare }) {
  const [finish, setFinish] = useState('')
  const [brand, setBrand] = useState('')
  const finishes = useMemo(() => [...new Set((chips ?? []).map((c) => c.finish).filter(Boolean))].sort(), [chips])
  const brands = useMemo(() => [...new Set((chips ?? []).map((c) => c.brand))].sort(), [chips])

  const pool = (chips ?? []).filter((c) => (!finish || c.finish === finish) && (!brand || c.brand === brand))
  const results = reading?.shades.length ? nearest(reading, pool, 10) : []
  const sample = useMemo(() => reading?.thumb.toDataURL('image/jpeg', 0.8), [reading])

  return (
    <>
      <ReadingStrip reading={reading} />
      <div className="filters">
        <select value={finish} onChange={(e) => setFinish(e.target.value)} aria-label="Finish">
          <option value="">Any finish</option>
          {finishes.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand">
          <option value="">Every brand</option>
          {brands.map((b) => <option key={b}>{b}</option>)}
        </select>
      </div>
      <div className="results">
        {chips === undefined && <p className="hint">Loading the chip list…</p>}
        {chips && !chips.length && <p className="hint">No chips saved yet — add catalog chips under Add.</p>}
        {chips?.length > 0 && !results.length && <p className="hint">Matches show here as you aim.</p>}
        {results.map(({ chip, d }) => {
          const v = verdict(d)
          return (
            <button
              key={chip._id}
              type="button"
              className="result"
              onClick={() => onCompare(fromReading(reading), fromChip(chip))}
              aria-label={`Compare with ${chip.code}`}
            >
              <div className="pair">
                {sample && <img src={sample} alt="Customer's piece" />}
                {chip.photoUrl ? <img src={chip.photoUrl} alt={chip.code} /> : <div className="nophoto" />}
              </div>
              <div className="code">{chip.code}</div>
              <div className="muted one">{[chip.brand, chip.catalog].filter(Boolean).join(' · ')}</div>
              {chip.finish && <div className="muted one">{chip.finish}</div>}
              <div className={`verdict ${v.tone}`}>{similarity(d)}% <span className="muted">{v.word}</span></div>
            </button>
          )
        })}
      </div>
    </>
  )
}

/* ── Compare ──────────────────────────────────────────────────────────── */

/**
 * Any two against each other: two pieces at the counter, a piece and a saved
 * chip, or two saved chips from different catalogs. Each side is set from the
 * camera (aim, then Set) or picked from the saved chips.
 */
function Compare({ chips, reading, sides, setSides }) {
  const set = (key, value) => setSides((s) => ({ ...s, [key]: value }))
  const { a, b } = sides
  const d = a && b ? distance(a, b) : null
  const v = d !== null ? verdict(d) : null
  const said = a && b ? difference(a, b) : []

  return (
    <>
      <div className="sides">
        {[['a', 'A'], ['b', 'B']].map(([key, name]) => {
          const side = sides[key]
          return (
            <div key={key} className="side">
              <div className="side-head">
                {side?.img ? <img src={side.img} alt="" /> : <div className="nophoto">{name}</div>}
                <div className="side-text">
                  <div className="code one">{side ? `${name} · ${side.title}` : `${name} — not set`}</div>
                  {side?.sub && <div className="muted one">{side.sub}</div>}
                  {side && <Shades shades={side.shades} height={8} />}
                </div>
              </div>
              <div className="side-actions">
                <button type="button" className="primary" disabled={!reading?.shades.length} onClick={() => set(key, fromReading(reading))}>
                  Set {name}
                </button>
                <select
                  value={side?.id ?? ''}
                  onChange={(e) => set(key, fromChip(chips?.find((c) => c._id === e.target.value)) ?? null)}
                  aria-label={`Saved chip as ${name}`}
                >
                  <option value="">Saved…</option>
                  {(chips ?? []).map((c) => <option key={c._id} value={c._id}>{label(c)}</option>)}
                </select>
              </div>
            </div>
          )
        })}
      </div>
      <div className="compare-result">
        {d === null ? (
          <span className="muted">Set both A and B to see how alike they are</span>
        ) : (
          <>
            <div className={`score ${v.tone}`}>{similarity(d)}%</div>
            <div className="compare-text">
              <div className={`verdict ${v.tone}`}>{v.word} <span className="muted">· colour difference {d.toFixed(1)}</span></div>
              <div className="muted">{said.length ? `B is ${said.join(', ')}` : 'No difference you would see'}</div>
              {(!a.corrected || !b.corrected) && <div className="warn">One side had no white paper beside it — less certain</div>}
            </div>
          </>
        )}
      </div>
    </>
  )
}

/* ── Add ──────────────────────────────────────────────────────────────── */

function Add({ chips, reading }) {
  const [brand, setBrand] = useState(() => remembered('brand'))
  const [catalog, setCatalog] = useState(() => remembered('catalog'))
  const [finish, setFinish] = useState(() => remembered('finish'))
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [said, setSaid] = useState(null)
  const uploadUrl = useMutation(api.mica.uploadUrl)
  const save = useMutation(api.mica.save)

  // A note after saving stays a few seconds, then gets out of the way.
  useEffect(() => {
    if (!said) return
    const t = setTimeout(() => setSaid(null), said.ok ? 2500 : 6000)
    return () => clearTimeout(t)
  }, [said])

  const brands = useMemo(() => [...new Set((chips ?? []).map((c) => c.brand))].sort(), [chips])
  const catalogs = useMemo(
    () => [...new Set((chips ?? []).filter((c) => !brand || c.brand === brand).map((c) => c.catalog).filter(Boolean))].sort(),
    [chips, brand],
  )

  async function submit(e) {
    e.preventDefault()
    if (!reading || saving) return
    // What is under the square at the moment Save was pressed.
    const at = reading
    setSaving(true)
    setSaid(null)
    try {
      const blob = await new Promise((done) => at.thumb.toBlob(done, 'image/jpeg', 0.85))
      const url = await uploadUrl({})
      const put = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
      if (!put.ok) throw new Error('The photo could not be uploaded.')
      const { storageId } = await put.json()
      const res = await save({
        brand, catalog, code, finish,
        shades: at.shades, texture: at.texture, corrected: at.corrected, photo: storageId,
      })
      remember('brand', brand); remember('catalog', catalog); remember('finish', finish)
      setSaid({ ok: true, text: `${res.replaced ? 'Updated' : 'Saved'} ${code.trim().toUpperCase()} — point at the next chip` })
      setCode('')
    } catch (err) {
      const text = typeof err?.data === 'string' ? err.data : err?.message ?? String(err)
      setSaid({ ok: false, text })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="add">
      <ReadingStrip reading={reading} />
      <div className="fields">
        <input value={brand} onChange={(e) => setBrand(e.target.value)} list="brands" placeholder="Brand" aria-label="Brand" required />
        <input value={catalog} onChange={(e) => setCatalog(e.target.value)} list="catalogs" placeholder="Catalog" aria-label="Catalog" />
        <input value={finish} onChange={(e) => setFinish(e.target.value)} list="finishes" placeholder="Finish" aria-label="Finish" />
        <datalist id="brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="catalogs">{catalogs.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="finishes">{FINISHES.map((f) => <option key={f} value={f} />)}</datalist>
      </div>
      <div className="save-row">
        <input
          value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="Code, e.g. 122-HDG" aria-label="Code" autoCapitalize="characters" required
        />
        <button type="submit" className="primary" disabled={saving || !reading || !code.trim() || !brand.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {said && <div className={`toast ${said.ok ? 'ok' : 'warn'}`} role="status">{said.text}</div>}
    </form>
  )
}

/* ── Chips ────────────────────────────────────────────────────────────── */

function Chips({ chips }) {
  const [q, setQ] = useState('')
  const remove = useMutation(api.mica.remove)
  const shown = (chips ?? []).filter((c) => label(c).toLowerCase().includes(q.trim().toLowerCase()))
  const byBrand = new Map()
  for (const c of shown) byBrand.set(c.brand, [...(byBrand.get(c.brand) ?? []), c])

  return (
    <>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand, catalog or code" aria-label="Search" />
      <div className="chip-scroll">
        {chips === undefined && <p className="hint">Loading…</p>}
        {chips && !chips.length && <p className="hint">Nothing saved yet.</p>}
        {[...byBrand].sort(([a], [b]) => a.localeCompare(b)).map(([brand, list]) => (
          <section key={brand} className="brand">
            <h2>{brand} <span className="muted">{list.length}</span></h2>
            <ul className="chip-list">
              {list.map((c) => (
                <li key={c._id}>
                  {c.photoUrl ? <img src={c.photoUrl} alt="" /> : <div className="nophoto" />}
                  <div className="chip-text">
                    <div className="code">{c.code}</div>
                    <div className="muted one">{[c.catalog, c.finish].filter(Boolean).join(' · ') || '—'}</div>
                    <Shades shades={c.shades} height={8} />
                  </div>
                  <button
                    type="button"
                    className="del"
                    aria-label={`Delete ${c.code}`}
                    onClick={() => { if (confirm(`Delete ${label(c)}?`)) void remove({ id: c._id }) }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
