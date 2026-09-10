import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  RATE_CATS, HARDWARE_CATS, LABEL, NO_SIZES, GUARANTEE_YEARS, uid, codeSets,
} from './catalog.js'
import { fetchSnapshot, commit } from './sync.js'

const EMPTY = { hardwareCatalog: {}, customCatalog: [], sets: [] }
const rupee = (n) => (Number.isFinite(n) ? `₹${n}` : '—')

/* ── Chips: the sizes and brands of one hardware item ────────────────────── */

function Chips({ label, items, onAdd, onRemove, onDropGroup, placeholder }) {
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')

  function confirm(keepOpen) {
    const v = val.trim()
    if (v && !items.includes(v)) onAdd(v)
    setVal('')
    // Adding sizes is a run of six or eight in a row, so the field stays open
    // on Enter and only closes on Escape or a click away.
    if (!keepOpen) setAdding(false)
  }

  return (
    <div className="chiprow">
      <div className="chiplabel">
        <span>{label}</span>
        {onDropGroup && <button className="x" onClick={onDropGroup} title="Remove this field">×</button>}
      </div>
      <div className="chips">
        {items.map((v) => (
          <span key={v} className="chip">
            {v}
            <button className="x" onClick={() => onRemove(v)} title="Remove">×</button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            className="chipinput"
            placeholder={placeholder}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => confirm(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); confirm(true) }
              if (e.key === 'Escape') { setVal(''); setAdding(false) }
            }}
          />
        ) : (
          <button className="chipadd" onClick={() => setAdding(true)}>+</button>
        )}
      </div>
    </div>
  )
}

/* ── One editable number cell ────────────────────────────────────────────── */

function RateCell({ value, onChange }) {
  const [draft, setDraft] = useState(null)
  const shown = draft ?? (Number.isFinite(value) ? String(value) : '')
  return (
    <input
      className="ratecell"
      inputMode="decimal"
      value={shown}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
      onBlur={() => {
        if (draft !== null) {
          const n = parseFloat(draft)
          if (Number.isFinite(n) && n !== value) onChange(n)
          setDraft(null)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
      }}
    />
  )
}

/* ── The priced-brand table for one sqft category ────────────────────────── */

function RateTable({ cat, brands, onPatch, onDelete, onAdd, query }) {
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [years, setYears] = useState(0)
  const [coverage, setCoverage] = useState('guarantee')
  const nameRef = useRef(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? brands.filter((b) => b.name.toLowerCase().includes(q)) : brands
  }, [brands, query])

  function add() {
    const n = name.trim()
    const r = parseFloat(rate)
    if (!n || !Number.isFinite(r)) return
    onAdd({ name: n, rate: r, guaranteeYears: Number(years), coverage })
    setName(''); setRate(''); setYears(0); setCoverage('guarantee')
    nameRef.current?.focus()
  }

  return (
    <table className="grid">
      <thead>
        <tr>
          <th className="wide">Item</th>
          <th className="num">₹ / sqft</th>
          <th>Cover</th>
          <th className="num">Years</th>
          <th className="act" />
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id}>
            <td>
              <input
                className="namecell"
                key={b.name}
                defaultValue={b.name}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== b.name) onPatch(b.id, { name: v })
                  else e.target.value = b.name
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              />
            </td>
            <td className="num"><RateCell value={b.rate} onChange={(v) => onPatch(b.id, { rate: v })} /></td>
            <td>
              <select
                className="pick"
                value={b.coverage || 'guarantee'}
                onChange={(e) => onPatch(b.id, { coverage: e.target.value })}
              >
                <option value="guarantee">Guarantee</option>
                <option value="warranty">Warranty</option>
              </select>
            </td>
            <td className="num">
              <select
                className="pick"
                value={b.guaranteeYears ?? 0}
                onChange={(e) => onPatch(b.id, { guaranteeYears: Number(e.target.value) })}
              >
                {GUARANTEE_YEARS.map((y) => <option key={y} value={y}>{y || '—'}</option>)}
              </select>
            </td>
            <td className="act">
              <button className="del" title="Remove item" onClick={() => onDelete(b)}>×</button>
            </td>
          </tr>
        ))}

        <tr className="addrow">
          <td>
            <input
              ref={nameRef}
              className="namecell"
              placeholder={`New item in ${LABEL[cat]}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
          </td>
          <td className="num">
            <input
              className="ratecell"
              inputMode="decimal"
              placeholder="rate"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
          </td>
          <td>
            <select className="pick" value={coverage} onChange={(e) => setCoverage(e.target.value)}>
              <option value="guarantee">Guarantee</option>
              <option value="warranty">Warranty</option>
            </select>
          </td>
          <td className="num">
            <select className="pick" value={years} onChange={(e) => setYears(e.target.value)}>
              {GUARANTEE_YEARS.map((y) => <option key={y} value={y}>{y || '—'}</option>)}
            </select>
          </td>
          <td className="act">
            <button className="addbtn" disabled={!name.trim() || !rate} onClick={add}>Add</button>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/* ── The sizes/brands card for one hardware or custom item ───────────────── */

function ItemCard({ entry, onPatch, onRename, onDelete, noSizes }) {
  const [field, setField] = useState('')
  const fields = entry.fields || []

  const setList = (key, list) => onPatch({ [key]: list })
  const patchField = (id, values) =>
    onPatch({ fields: fields.map((f) => (f.id === id ? { ...f, values } : f)) })

  function addField() {
    const label = field.trim()
    if (!label) return
    onPatch({ fields: [...fields, { id: uid('f'), label, values: [] }] })
    setField('')
  }

  return (
    <div className="itemcard">
      <div className="itemhead">
        {onRename ? (
          <input
            className="itemname"
            key={entry.name}
            defaultValue={entry.name}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== entry.name) onRename(v)
              else e.target.value = entry.name
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
        ) : (
          <span className="itemname static">{entry.name}</span>
        )}
        <div className="itemrate">
          <span>₹</span>
          <RateCell value={entry.rate} onChange={(v) => onPatch({ rate: v })} />
        </div>
        {onDelete && <button className="del" title="Remove item" onClick={onDelete}>×</button>}
      </div>

      {!noSizes && (
        <Chips
          label="Sizes"
          placeholder='6"'
          items={entry.sizes || []}
          onAdd={(v) => setList('sizes', [...(entry.sizes || []), v])}
          onRemove={(v) => setList('sizes', (entry.sizes || []).filter((s) => s !== v))}
        />
      )}
      <Chips
        label="Brands"
        placeholder="Brand"
        items={entry.brands || []}
        onAdd={(v) => setList('brands', [...(entry.brands || []), v])}
        onRemove={(v) => setList('brands', (entry.brands || []).filter((s) => s !== v))}
      />
      {fields.map((f) => (
        <Chips
          key={f.id}
          label={f.label}
          placeholder={f.label}
          items={f.values || []}
          onAdd={(v) => patchField(f.id, [...(f.values || []), v])}
          onRemove={(v) => patchField(f.id, (f.values || []).filter((s) => s !== v))}
          onDropGroup={() => onPatch({ fields: fields.filter((x) => x.id !== f.id) })}
        />
      ))}

      <div className="fieldadd">
        <input
          placeholder="New field — Colour, Finish…"
          value={field}
          onChange={(e) => setField(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addField() }}
        />
        <button disabled={!field.trim()} onClick={addField}>Add field</button>
      </div>
    </div>
  )
}

/* ── Panel ───────────────────────────────────────────────────────────────── */

export default function App() {
  const [snap, setSnap] = useState(EMPTY)
  const [state, setState] = useState('loading')   // loading | ready | error
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(0)
  const [view, setView] = useState({ kind: 'rate', cat: RATE_CATS[0] })
  const [setIdx, setSetIdx] = useState(0)
  const [query, setQuery] = useState('')
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const searchRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const fresh = await fetchSnapshot()
      setSnap(fresh)
      setState('ready')
      setError('')
    } catch (err) {
      setState('error')
      setError(String(err?.message || err))
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Another laptop, or the panel itself, may be editing the same row. Nothing
  // here is authoritative for long, so the view is refreshed on a timer and
  // whenever the window is looked at again — but never mid-save, which would
  // show the pre-write snapshot back to the person who just typed.
  const savingRef = useRef(0)
  useEffect(() => { savingRef.current = saving }, [saving])
  useEffect(() => {
    const tick = () => { if (!savingRef.current && document.visibilityState === 'visible') load() }
    const id = setInterval(tick, 20000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  /** Apply a pure snapshot change locally, then replay it onto the live row. */
  const write = useCallback((mutate) => {
    setSnap((s) => mutate(structuredClone(s)))
    setSaving((n) => n + 1)
    commit(mutate)
      .then((server) => { setSnap(server); setError('') })
      .catch((err) => {
        // The change never landed, so the screen must stop showing it.
        setError(String(err?.message || err))
        load()
      })
      .finally(() => setSaving((n) => n - 1))
  }, [load])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('shiv-panel:theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }

  const sets = snap.sets.length ? snap.sets : []
  const activeSet = sets[Math.min(setIdx, Math.max(sets.length - 1, 0))]
  const brandsOf = (cat) => (activeSet?.brands || []).filter((b) => b.category === cat)

  // A category that only exists in the data (added by the panel) still has to
  // be reachable, or its items would be invisible and un-editable here.
  const rateCats = useMemo(() => {
    const seen = new Set(RATE_CATS)
    for (const b of activeSet?.brands || []) seen.add(b.category)
    return [...seen].filter((c) => !HARDWARE_CATS.includes(c))
  }, [activeSet])

  const total = (activeSet?.brands || []).length
    + HARDWARE_CATS.reduce((n, c) => {
      const e = snap.hardwareCatalog[c]
      return n + (e?.brands?.length || 0) + (e?.sizes?.length || 0)
    }, 0)
    + snap.customCatalog.length

  /* ── mutators (pure: same input snapshot ⇒ same output) ─────────────── */

  const patchSetBrands = (fn) => (s) => {
    // A shop with no rate set yet would otherwise map over nothing and drop
    // the item without a word.
    const base = s.sets.length ? s.sets : [{ id: 'c1', name: 'C1', brands: [] }]
    const i0 = Math.min(setIdx, base.length - 1)
    return {
      ...s,
      sets: base.map((set, i) => (i === i0 ? { ...set, brands: fn(set.brands || []) } : set)),
    }
  }

  const addBrand = (cat, draft) => {
    const id = uid('b')            // generated outside the mutator: it runs twice
    write(patchSetBrands((bs) => [...bs, { id, category: cat, ...draft }]))
  }
  const patchBrand = (id, patch) =>
    write(patchSetBrands((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b))))
  const deleteBrand = (b) => {
    if (!confirm(`Remove ${b.name} from ${LABEL[b.category]}?`)) return
    write(patchSetBrands((bs) => bs.filter((x) => x.id !== b.id)))
  }

  const patchHardware = (cat, patch) =>
    write((s) => ({
      ...s,
      hardwareCatalog: {
        ...s.hardwareCatalog,
        [cat]: { sizes: [], brands: [], ...(s.hardwareCatalog[cat] || {}), ...patch },
      },
    }))

  const addCustom = () => {
    const name = prompt('New item name')?.trim()
    if (!name) return
    const id = uid('c')
    write((s) => ({ ...s, customCatalog: [...s.customCatalog, { id, name, sizes: [], brands: [] }] }))
    setView({ kind: 'custom', id })
  }
  const patchCustom = (id, patch) =>
    write((s) => ({
      ...s,
      customCatalog: s.customCatalog.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  const deleteCustom = (entry) => {
    if (!confirm(`Remove ${entry.name}?`)) return
    write((s) => ({ ...s, customCatalog: s.customCatalog.filter((e) => e.id !== entry.id) }))
    setView({ kind: 'rate', cat: RATE_CATS[0] })
  }

  const addSet = () => {
    const src = activeSet
    const id = uid('s')
    write((s) => ({
      ...s,
      sets: codeSets([...s.sets, { id, name: '', brands: (src?.brands || []).map((b) => ({ ...b })) }]),
    }))
    setSetIdx(sets.length)
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  if (state === 'loading') return <div className="boot">Loading…</div>
  if (state === 'error') {
    return (
      <div className="boot">
        <div>Cannot reach the catalog.</div>
        <div className="booterr">{error}</div>
        <button className="addbtn" onClick={load}>Retry</button>
      </div>
    )
  }

  const custom = snap.customCatalog.find((e) => e.id === view.id)

  return (
    <div className="app">
      <header className="top">
        <img className="logo" src="/logo.png" alt="" />
        <div className="brand">
          <div className="shop">Shiv Hardware</div>
          <div className="sub">Stock · {total} entries</div>
        </div>

        <input
          ref={searchRef}
          className="search"
          placeholder="Search items    /"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
        />

        {sets.length > 0 && (
          <div className="setpick">
            <select value={setIdx} onChange={(e) => setSetIdx(Number(e.target.value))}>
              {sets.map((s, i) => <option key={s.id || i} value={i}>{s.name || `C${i + 1}`}</option>)}
            </select>
            <button title="Copy this rate set" onClick={addSet}>+</button>
          </div>
        )}

        <span className={`state ${error ? 'bad' : saving ? 'busy' : 'ok'}`}>
          {error ? 'Not saved' : saving ? 'Saving…' : 'Saved'}
        </span>
        <button className="theme" onClick={toggleTheme} title="Light / dark">{dark ? '☀' : '☾'}</button>
      </header>

      {error && <div className="errbar">{error}</div>}

      <div className="body">
        <nav className="side">
          <div className="sechead">Priced · ₹/sqft</div>
          {rateCats.map((c) => (
            <button
              key={c}
              className={`navrow ${view.kind === 'rate' && view.cat === c ? 'on' : ''}`}
              onClick={() => setView({ kind: 'rate', cat: c })}
            >
              <span>{LABEL[c] || c}</span>
              <span className="count">{brandsOf(c).length}</span>
            </button>
          ))}

          <div className="sechead">Hardware</div>
          {HARDWARE_CATS.map((c) => {
            const e = snap.hardwareCatalog[c]
            return (
              <button
                key={c}
                className={`navrow ${view.kind === 'hw' && view.cat === c ? 'on' : ''}`}
                onClick={() => setView({ kind: 'hw', cat: c })}
              >
                <span>{LABEL[c]}</span>
                <span className="count">{(e?.brands?.length || 0) + (e?.sizes?.length || 0)}</span>
              </button>
            )
          })}

          <div className="sechead">
            Custom
            <button className="secadd" onClick={addCustom} title="New item">+</button>
          </div>
          {snap.customCatalog.map((e) => (
            <button
              key={e.id}
              className={`navrow ${view.kind === 'custom' && view.id === e.id ? 'on' : ''}`}
              onClick={() => setView({ kind: 'custom', id: e.id })}
            >
              <span>{e.name}</span>
              <span className="count">{(e.brands?.length || 0) + (e.sizes?.length || 0)}</span>
            </button>
          ))}
        </nav>

        <main className="main">
          {view.kind === 'rate' && (
            <>
              <h1 className="title">{LABEL[view.cat] || view.cat}</h1>
              <RateTable
                key={view.cat}
                cat={view.cat}
                brands={brandsOf(view.cat)}
                query={query}
                onAdd={(draft) => addBrand(view.cat, draft)}
                onPatch={patchBrand}
                onDelete={deleteBrand}
              />
            </>
          )}

          {view.kind === 'hw' && (
            <>
              <h1 className="title">{LABEL[view.cat]}</h1>
              <ItemCard
                key={view.cat}
                entry={{ name: LABEL[view.cat], ...(snap.hardwareCatalog[view.cat] || { sizes: [], brands: [] }) }}
                noSizes={!!NO_SIZES[view.cat]}
                onPatch={(patch) => patchHardware(view.cat, patch)}
              />
            </>
          )}

          {view.kind === 'custom' && custom && (
            <>
              <h1 className="title">{custom.name}</h1>
              <ItemCard
                key={custom.id}
                entry={custom}
                onPatch={(patch) => patchCustom(custom.id, patch)}
                onRename={(name) => patchCustom(custom.id, { name })}
                onDelete={() => deleteCustom(custom)}
              />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
