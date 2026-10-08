import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { Capture, Shades } from './Capture'
import { nearest, verdict } from './color'

const api = anyApi

const FINISHES = ['HD Glossy', 'Gloss', 'Matte', 'Suede', 'Textured', 'Super Matte']

/** The last brand, catalog and finish typed, so a page of chips is only codes. */
const remembered = (key) => { try { return localStorage.getItem(`mica:${key}`) ?? '' } catch { return '' } }
const remember = (key, value) => { try { localStorage.setItem(`mica:${key}`, value) } catch { /* private window */ } }

const label = (c) => [c.brand, c.catalog, c.code].filter(Boolean).join(' · ')

export default function App() {
  const [tab, setTab] = useState('find')
  const chips = useQuery(api.mica.list, {})

  return (
    <div className="app">
      <header className="top">
        <div className="title">Mica Match</div>
        <nav className="tabs">
          {[['find', 'Find'], ['add', 'Add chip'], ['chips', `Chips${chips ? ` (${chips.length})` : ''}`]].map(([key, text]) => (
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
  const results = reading?.shades.length ? nearest(reading, pool, 8) : []
  const sample = reading?.thumb.toDataURL('image/jpeg', 0.85)

  return (
    <>
      <Capture
        onRead={setReading}
        hint="Lay the customer's piece on white paper and hold the phone straight over it under the shop light. Keep the piece in the square and white paper in the dashed frame."
      />
      {reading && (
        <>
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
          {chips === undefined && <p className="hint">Loading the chip list…</p>}
          {chips && !chips.length && <p className="hint">No chips saved yet. Add catalog chips first, under Add chip.</p>}
          <ol className="results">
            {results.map(({ chip, d }) => {
              const v = verdict(d)
              return (
                <li key={chip._id} className="result">
                  <div className="pair">
                    <img src={sample} alt="Customer's piece" />
                    {chip.photoUrl ? <img src={chip.photoUrl} alt={chip.code} /> : <div className="nophoto" />}
                  </div>
                  <div className="result-text">
                    <div className="code">{chip.code}</div>
                    <div className="muted">{[chip.brand, chip.catalog, chip.finish].filter(Boolean).join(' · ')}</div>
                    <Shades shades={chip.shades} height={10} />
                    <div className={`verdict ${v.tone}`}>{v.word} <span className="muted">· ΔE {d.toFixed(1)}</span></div>
                    {!chip.corrected && <div className="warn small">Saved without white correction</div>}
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      )}
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

  const brands = useMemo(() => [...new Set((chips ?? []).map((c) => c.brand))].sort(), [chips])
  const catalogs = useMemo(
    () => [...new Set((chips ?? []).filter((c) => !brand || c.brand === brand).map((c) => c.catalog).filter(Boolean))].sort(),
    [chips, brand],
  )

  async function submit(e) {
    e.preventDefault()
    if (!reading || saving) return
    setSaving(true)
    setSaid(null)
    try {
      const blob = await new Promise((done) => reading.thumb.toBlob(done, 'image/jpeg', 0.85))
      const url = await uploadUrl({})
      const put = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
      if (!put.ok) throw new Error('The photo could not be uploaded.')
      const { storageId } = await put.json()
      const res = await save({
        brand, catalog, code, finish,
        shades: reading.shades, texture: reading.texture, corrected: reading.corrected, photo: storageId,
      })
      remember('brand', brand); remember('catalog', catalog); remember('finish', finish)
      setSaid({ ok: true, text: `${res.replaced ? 'Updated' : 'Saved'} ${code.trim().toUpperCase()}. Point at the next chip.` })
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
        <label>Brand
          <input value={brand} onChange={(e) => setBrand(e.target.value)} list="brands" placeholder="e.g. Merino" required />
        </label>
        <label>Catalog
          <input value={catalog} onChange={(e) => setCatalog(e.target.value)} list="catalogs" placeholder="optional" />
        </label>
        <label>Finish
          <input value={finish} onChange={(e) => setFinish(e.target.value)} list="finishes" placeholder="e.g. HD Glossy" />
        </label>
        <datalist id="brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        <datalist id="catalogs">{catalogs.map((c) => <option key={c} value={c} />)}</datalist>
        <datalist id="finishes">{FINISHES.map((f) => <option key={f} value={f} />)}</datalist>
      </div>

      <Capture
        onRead={setReading}
        hint="Hold the phone straight over the catalog page under the shop light. Put one chip in the square with the white board in the dashed frame, type its code, save — then move to the next chip."
      />

      {reading && (
        <div className="save-row">
          <label className="code-field">Code
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 122-HDG" autoCapitalize="characters" required />
          </label>
          <button type="submit" className="primary" disabled={saving || !code.trim() || !brand.trim()}>
            {saving ? 'Saving…' : 'Save chip'}
          </button>
        </div>
      )}
      {said && <p className={said.ok ? 'ok' : 'warn'}>{said.text}</p>}
    </form>
  )
}

/* ── Chips ────────────────────────────────────────────────────────────── */

function Chips({ chips }) {
  const [q, setQ] = useState('')
  const remove = useMutation(api.mica.remove)
  if (chips === undefined) return <p className="hint">Loading…</p>
  const shown = chips.filter((c) => label(c).toLowerCase().includes(q.trim().toLowerCase()))
  const byBrand = new Map()
  for (const c of shown) byBrand.set(c.brand, [...(byBrand.get(c.brand) ?? []), c])

  return (
    <>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand, catalog or code" />
      {!chips.length && <p className="hint">Nothing saved yet.</p>}
      {[...byBrand].sort(([a], [b]) => a.localeCompare(b)).map(([brand, list]) => (
        <section key={brand} className="brand">
          <h2>{brand} <span className="muted">{list.length}</span></h2>
          <ul className="chip-list">
            {list.map((c) => (
              <li key={c._id}>
                {c.photoUrl ? <img src={c.photoUrl} alt="" /> : <div className="nophoto" />}
                <div className="chip-text">
                  <div className="code">{c.code}</div>
                  <div className="muted">{[c.catalog, c.finish].filter(Boolean).join(' · ') || '—'}</div>
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
    </>
  )
}
