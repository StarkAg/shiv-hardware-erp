import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { Capture, ReadingStrip, Shades } from './Capture'
import { nearest, verdict } from './color'

const api = anyApi

const FINISHES = ['HD Glossy', 'Gloss', 'Matte', 'Suede', 'Textured', 'Super Matte']

/** The last brand, catalog and finish typed, so a page of chips is only codes. */
const remembered = (key) => { try { return localStorage.getItem(`mica:${key}`) ?? '' } catch { return '' } }
const remember = (key, value) => { try { localStorage.setItem(`mica:${key}`, value) } catch { /* private window */ } }

const label = (c) => [c.brand, c.catalog, c.code].filter(Boolean).join(' · ')

/**
 * One screen, never scrolled: the tabs on top, the camera filling the middle,
 * and what was read — with the matches or the save box — along the bottom.
 * Only the chip list scrolls, inside its own space.
 */
export default function App() {
  const [tab, setTab] = useState('find')
  const chips = useQuery(api.mica.list, {})

  return (
    <div className="app">
      <header className="top">
        <img className="logo" src="/icon.svg" alt="" />
        <nav className="tabs">
          {[['find', 'Find'], ['add', 'Add'], ['chips', `Chips${chips ? ` ${chips.length}` : ''}`]].map(([key, text]) => (
            <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{text}</button>
          ))}
        </nav>
      </header>
      <main className="page">
        {tab === 'find' && <Find chips={chips} />}
        {tab === 'add' && <Add chips={chips} />}
        {tab === 'chips' && <Chips chips={chips} />}
      </main>
    </div>
  )
}

/* ── Find ─────────────────────────────────────────────────────────────── */

function Find({ chips }) {
  const [reading, setReading] = useState(null)
  const [finish, setFinish] = useState('')
  const [brand, setBrand] = useState('')
  const finishes = useMemo(() => [...new Set((chips ?? []).map((c) => c.finish).filter(Boolean))].sort(), [chips])
  const brands = useMemo(() => [...new Set((chips ?? []).map((c) => c.brand))].sort(), [chips])

  const pool = (chips ?? []).filter((c) => (!finish || c.finish === finish) && (!brand || c.brand === brand))
  const results = reading?.shades.length ? nearest(reading, pool, 10) : []
  const sample = useMemo(() => reading?.thumb.toDataURL('image/jpeg', 0.8), [reading])

  return (
    <>
      <Capture onRead={setReading} hint="Piece on white paper · paper inside the dashed frame" />
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
            <div key={chip._id} className="result">
              <div className="pair">
                {sample && <img src={sample} alt="Customer's piece" />}
                {chip.photoUrl ? <img src={chip.photoUrl} alt={chip.code} /> : <div className="nophoto" />}
              </div>
              <div className="code">{chip.code}</div>
              <div className="muted one">{[chip.brand, chip.catalog].filter(Boolean).join(' · ')}</div>
              {chip.finish && <div className="muted one">{chip.finish}</div>}
              <div className={`verdict ${v.tone}`}>{v.word} <span className="muted">{d.toFixed(1)}</span></div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ── Add ──────────────────────────────────────────────────────────────── */

function Add({ chips }) {
  const [brand, setBrand] = useState(() => remembered('brand'))
  const [catalog, setCatalog] = useState(() => remembered('catalog'))
  const [finish, setFinish] = useState(() => remembered('finish'))
  const [code, setCode] = useState('')
  const [reading, setReading] = useState(null)
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
      <div className="fields">
        <input value={brand} onChange={(e) => setBrand(e.target.value)} list="brands" placeholder="Brand" aria-label="Brand" required />
        <input value={catalog} onChange={(e) => setCatalog(e.target.value)} list="catalogs" placeholder="Catalog" aria-label="Catalog" />
        <input value={finish} onChange={(e) => setFinish(e.target.value)} list="finishes" placeholder="Finish" aria-label="Finish" />
        <datalist id="brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="catalogs">{catalogs.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="finishes">{FINISHES.map((f) => <option key={f} value={f} />)}</datalist>
      </div>

      <div className="add-capture">
        <Capture onRead={setReading} hint="One chip in the square · white board in the dashed frame" />
        {said && <div className={`toast ${said.ok ? 'ok' : 'warn'}`} role="status">{said.text}</div>}
      </div>
      <ReadingStrip reading={reading} />

      <div className="save-row">
        <input
          value={code} onChange={(e) => setCode(e.target.value)}
          placeholder="Code, e.g. 122-HDG" aria-label="Code" autoCapitalize="characters" required
        />
        <button type="submit" className="primary" disabled={saving || !reading || !code.trim() || !brand.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
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
