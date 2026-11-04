import { useEffect, useMemo, useRef, useState } from 'react'
import { anyApi } from 'convex/server'
import { convex } from './sync.js'
import { cashierLines, checkPage, fromReading, newLine } from './pageCheck.js'
import './page-check.css'

/**
 * A page of the paper register, photographed, checked and added to the Cashier.
 *
 * Every line is shown beside the photo to be put right, and every sum is worked
 * out here and set against the one the shop wrote. Nothing reaches the book until
 * Add is pressed, and adding the same page again changes nothing. Kept on this
 * phone while it is worked on, so a dropped signal or a closed app loses no work.
 */
const DRAFT_KEY = 'shiv-cash:page-draft'
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`
const plain = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'))

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
}
function keepDraft(page) {
  try {
    if (page) localStorage.setItem(DRAFT_KEY, JSON.stringify(page))
    else localStorage.removeItem(DRAFT_KEY)
  } catch { /* not kept; still works */ }
}

/** A photo as big as the handwriting needs, as a JPEG, as base64. */
async function shrink(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const url = canvas.toDataURL('image/jpeg', 0.88)
  return { url, data: url.replace(/^data:[^,]*,/, '') }
}

function Line({ line, repeat, onChange, onRemove }) {
  return (
    <div className={`pc-line${line.struck ? ' struck' : ''}${line.unsure ? ' unsure' : ''}${line.amount == null && !line.struck ? ' missing' : ''}`}>
      <input
        className="pc-amount"
        aria-label="Amount"
        inputMode="numeric"
        value={line.amount ?? ''}
        onChange={(e) => {
          const text = e.target.value.replace(/[^\d.]/g, '')
          onChange({ amount: text === '' ? null : Number(text), unsure: false })
        }}
      />
      <input className="pc-note" aria-label="What for" value={line.note} onChange={(e) => onChange({ note: e.target.value })} />
      <button type="button" className={`pc-tag${line.online ? ' on' : ''}`} aria-pressed={line.online} onClick={() => onChange({ online: !line.online })}>Online</button>
      <button type="button" className={`pc-tag${line.struck ? ' on' : ''}`} aria-pressed={line.struck} aria-label="Crossed out" onClick={() => onChange({ struck: !line.struck })}>Cut</button>
      <button type="button" className="pc-x" aria-label={`Remove ${line.amount ?? 'line'}`} onClick={onRemove}>×</button>
      {repeat && <p className="pc-repeat">Repeat of the left side: not added again</p>}
    </div>
  )
}

export default function PageCheck({ todayKey, store, closes, guard, cashAtStart, onAddPage, onBack }) {
  const [page, setPage] = useState(loadDraft)
  const [photo, setPhoto] = useState(null)
  const [big, setBig] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [setOpening, setSetOpening] = useState(true)
  const [closeIt, setCloseIt] = useState(true)
  const [sure, setSure] = useState(false)
  const camera = useRef(null)
  const gallery = useRef(null)
  const lastPhoto = useRef(null)

  useEffect(() => { keepDraft(page); setSure(false) }, [page])

  const read = async (file) => {
    setError('')
    setReading(true)
    try {
      const shot = lastPhoto.current && !file ? lastPhoto.current : await shrink(file)
      lastPhoto.current = shot
      setPhoto(shot.url)
      const client = convex()
      if (!client) throw new Error('This phone is not connected to the shop.')
      const res = await client.action(anyApi.ai.readCashPage, { data: shot.data })
      if (!res?.ok) throw new Error(res?.error || 'The page could not be read.')
      const next = fromReading(res.page)
      setPage({ ...next, date: next.date || todayKey })
    } catch (err) {
      setError(err?.message?.includes('fetch') ? 'No connection. Check the signal and try again.' : (err?.message || 'The page could not be read.'))
    } finally {
      setReading(false)
    }
  }

  const check = useMemo(() => (page ? checkPage(page) : null), [page])

  if (!page) {
    return (
      <div className="pc-scroll">
        <div className="pc-start">
          <div className="pc-head">
            <button type="button" className="pc-quiet" onClick={onBack}>Back</button>
            <h2>Check a page</h2>
          </div>
          <p>Photograph a page of the register. Every line is read and every total is checked, then it can all go in the Cashier.</p>
          {photo && <img className="pc-photo" src={photo} alt="The page" />}
          <button type="button" className="pc-go" disabled={reading} onClick={() => camera.current?.click()}>{reading ? 'Reading the page…' : 'Take a photo'}</button>
          <button type="button" className="pc-quiet" disabled={reading} onClick={() => gallery.current?.click()}>Choose a photo</button>
          {error && (
            <div className="pc-error" role="alert">
              <p>{error}</p>
              {lastPhoto.current && <button type="button" className="pc-quiet" onClick={() => void read()}>Try again</button>}
            </div>
          )}
          {reading && <p className="pc-wait">This takes about half a minute.</p>}
        </div>
        <input ref={camera} hidden type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />
        <input ref={gallery} hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />
      </div>
    )
  }

  const change = (side, id, patch) => setPage((p) => ({ ...p, [side]: p[side].map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const remove = (side, id) => setPage((p) => ({ ...p, [side]: p[side].filter((l) => l.id !== id) }))
  const add = (side) => setPage((p) => ({ ...p, [side]: [...p[side], newLine()] }))
  const setWritten = (key, text) => {
    const clean = text.replace(/[^\d]/g, '')
    setPage((p) => ({ ...p, written: { ...p.written, [key]: clean === '' ? null : Number(clean) } }))
  }
  const fix = (hint) => change(hint.side, hint.line, { struck: hint.struck })

  const date = page.date
  const lines = date ? cashierLines(page, date) : []
  const dayLines = (store[date?.slice(0, 7)] || []).filter((e) => e.date === date)
  const known = new Set(dayLines.map((e) => e.id))
  const fresh = lines.filter((l) => !known.has(l.id))
  const others = dayLines.filter((e) => !String(e.id).startsWith('page-'))
  const carried = date ? cashAtStart(date) : 0
  const openingDiffers = page.opening != null && page.opening !== carried
  const closed = date ? closes[date] : null
  const drawer = page.written.drawer
  const willSetOpening = openingDiffers && setOpening
  const willClose = drawer != null && closeIt
  const inFuture = date > todayKey
  const blocked = !date || inFuture || check.unread > 0 || (!fresh.length && !willSetOpening && !willClose)
  const warned = !check.agrees || others.length > 0

  const addAll = () => {
    if (blocked) return
    if (warned && !sure) { setSure(true); return }
    const run = () => {
      onAddPage({
        date,
        entries: fresh,
        opening: willSetOpening ? page.opening : null,
        counted: willClose ? drawer : null,
        expected: (willSetOpening ? page.opening : carried) + check.cashIn - check.cashOut,
      })
      // Here, not left to the effect: adding closes this screen before an effect would run.
      keepDraft(null)
      setPage(null)
      setPhoto(null)
      lastPhoto.current = null
    }
    // Changing an opening or a day already counted takes the cash password, as it does anywhere else.
    if (willSetOpening || (willClose && closed)) guard(run)
    else run()
  }

  return (
    <div className="pc-scroll pc-has-foot">
      <div className="pc-head">
        <button type="button" className="pc-quiet" onClick={onBack}>Back</button>
        <h2>Check a page</h2>
        <button type="button" className="pc-quiet" onClick={() => { setPage(null); setPhoto(null); lastPhoto.current = null }}>Start again</button>
      </div>

      {photo && (
        <button type="button" className={`pc-photo-key${big ? ' big' : ''}`} onClick={() => setBig((b) => !b)} aria-label={big ? 'Make the photo smaller' : 'Make the photo bigger'}>
          <img src={photo} alt="The page" />
        </button>
      )}

      <div className={`pc-verdict ${check.agrees ? 'good' : 'look'}`} role="status">
        {check.agrees ? 'Every sum on this page agrees' : 'Something needs a look'}
      </div>

      <table className="pc-sums">
        <thead><tr><th /><th>Page</th><th>Worked out</th><th /></tr></thead>
        <tbody>
          {check.rows.map((r) => (
            <tr key={r.key} className={r.ok === false ? 'off' : ''}>
              <th scope="row">{r.label}</th>
              <td>
                {r.key === 'in' || r.key === 'out' || r.key === 'balance'
                  ? <input aria-label={`${r.label} on the page`} inputMode="numeric" value={r.written ?? ''} onChange={(e) => setWritten({ in: 'inTotal', out: 'outTotal', balance: 'balance' }[r.key], e.target.value)} />
                  : plain(r.written)}
              </td>
              <td>{plain(r.worked)}</td>
              <td className="pc-mark">{r.ok === null ? '—' : r.ok ? '✓' : `${r.off > 0 ? '+' : '−'}${plain(Math.abs(r.off))}`}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Online, left and right</th>
            <td colSpan={2}>{check.pairs} pairs, {plain(check.onlineIn)}</td>
            <td className="pc-mark">{check.onlineIn - check.onlineOutPaid >= 0 && !check.problems.some((p) => p.startsWith('Online')) ? '✓' : '!'}</td>
          </tr>
        </tbody>
      </table>

      {check.rows.flatMap((r) => r.hints).map((h, i) => (
        <div className="pc-hint" key={i}>
          <p>{h.text}</p>
          {h.key && <button type="button" className="pc-quiet" onClick={() => fix(h)}>{h.key}</button>}
        </div>
      ))}
      {check.problems.map((p) => <p className="pc-problem" key={p}>{p}</p>)}

      <div className="pc-fields">
        <label><span>Date on the page</span><input type="date" max={todayKey} value={date} onChange={(e) => setPage((p) => ({ ...p, date: e.target.value }))} /></label>
        <label><span>O/B</span><input inputMode="numeric" value={page.opening ?? ''} onChange={(e) => { const c = e.target.value.replace(/[^\d]/g, ''); setPage((p) => ({ ...p, opening: c === '' ? null : Number(c) })) }} /></label>
        <label><span>Drawer</span><input inputMode="numeric" value={drawer ?? ''} onChange={(e) => setWritten('drawer', e.target.value)} /></label>
        <label><span>Short / over</span><input inputMode="numeric" value={page.written.difference ?? ''} onChange={(e) => setWritten('difference', e.target.value)} /></label>
      </div>

      <h3>Left side: in <span>{page.in.length} lines</span></h3>
      {page.in.map((l) => <Line key={l.id} line={l} onChange={(patch) => change('in', l.id, patch)} onRemove={() => remove('in', l.id)} />)}
      <button type="button" className="pc-add" onClick={() => add('in')}>+ Add a line</button>

      <h3>Right side: out <span>{page.out.length} lines</span></h3>
      {page.out.map((l) => <Line key={l.id} line={l} repeat={check.repeats.has(l.id)} onChange={(patch) => change('out', l.id, patch)} onRemove={() => remove('out', l.id)} />)}
      <button type="button" className="pc-add" onClick={() => add('out')}>+ Add a line</button>

      <h3>What goes in the Cashier</h3>
      <dl className="pc-goes">
        <div><dt>Cash in</dt><dd>{inr(check.cashIn)}</dd></div>
        <div><dt>Cash out</dt><dd>{inr(check.cashOut)}</dd></div>
        <div><dt>Online in</dt><dd>{inr(check.onlineIn)}</dd></div>
        {check.onlineOutPaid > 0 && <div><dt>Paid from bank</dt><dd>{inr(check.onlineOutPaid)}</dd></div>}
        <div><dt>New lines</dt><dd>{fresh.length}</dd></div>
      </dl>

      {openingDiffers && (
        <label className="pc-choice">
          <input type="checkbox" checked={setOpening} onChange={(e) => setSetOpening(e.target.checked)} />
          <span>Set the Cashier's opening to the page's O/B, {inr(page.opening)}. It has {inr(carried)} carried to this day. Takes the cash password.</span>
        </label>
      )}
      {drawer != null && (
        <label className="pc-choice">
          <input type="checkbox" checked={closeIt} onChange={(e) => setCloseIt(e.target.checked)} />
          <span>Count the drawer at {inr(drawer)} and close this day{closed ? `, replacing the ${inr(closed.counted)} already counted` : ''}.</span>
        </label>
      )}
      {others.length > 0 && <p className="pc-problem">This day already has {others.length} other {others.length === 1 ? 'line' : 'lines'} in the Cashier, such as {inr(others[0].amount)} {others[0].name}. Adding this page may count that money twice.</p>}
      {inFuture && <p className="pc-problem">The date is after today. Check it against the page.</p>}

      <div className="pc-foot">
        {sure && <p className="pc-sure">{others.length ? 'This day already has lines. ' : ''}{!check.agrees ? 'Not every sum agrees. ' : ''}Add it anyway?</p>}
        <button type="button" className="pc-go" disabled={blocked} onClick={addAll}>
          {sure ? 'Yes, add to Cashier' : fresh.length ? `Add all ${fresh.length} to Cashier` : 'Add to Cashier'}
        </button>
      </div>
    </div>
  )
}
