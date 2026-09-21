/**
 * Every customer, and where their paper is.
 *
 * The third thing anybody standing at the table wants, after naming and
 * placing: whose packet is on which bookmark, and what is actually in it. A
 * count alone cannot settle "is this the last of his?" — so tapping a customer
 * opens every slip they have, oldest first, with the bookmark it is sitting on.
 *
 * Read-only. Nothing here moves paper or touches an account; placing is the
 * other tab's job and pricing is the books'.
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import PhotoViewer from './PhotoViewer.jsx'
import { clean } from './match.js'
import { TrashIcon } from './icons.jsx'

const money = (n) =>
  n === null || n === undefined ? null : `₹${Number(n).toLocaleString('en-IN')}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (ms) => {
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

const WHERE = {
  named: 'in the stack',
  slotted: 'on the table',
  waiting: 'waiting for a bookmark',
  filed: 'in the folder',
}

export default function Ledger() {
  const [photo, setPhoto] = useState(null)
  const [find, setFind] = useState('')
  const [open, setOpen] = useState(null)

  const rows = useQuery(anyApi.filing.folders, {})
  const one = useQuery(anyApi.filing.partyBills, open ? { partyLedgerId: open } : 'skip')
  const deleteBill = useMutation(anyApi.filing.deleteBill)

  // The bill being taken out of the books, and the code that has to be typed
  // before it goes. Kept per attempt rather than remembered — this is the gate
  // on an entry leaving the books, and a remembered code is no gate at all.
  const [binning, setBinning] = useState(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState('')

  const shown = useMemo(() => {
    const q = clean(find)
    const all = rows ?? []
    if (!q) return all
    return all.filter((r) => clean(r.name).includes(q))
  }, [rows, find])

  /* ---------------- one customer ---------------- */
  if (open) {
    return (
      <div className="body">
        <div className="lg-head">
          <button className="linkbtn" onClick={() => setOpen(null)}>‹ All customers</button>
        </div>

        {one === undefined ? (
          <p className="pad hint">Loading…</p>
        ) : one === null ? (
          <p className="pad hint">That customer is gone.</p>
        ) : (
          <>
            <div className="lg-who">
              <h2>{one.name}</h2>
              {one.place && <p className="hint">{one.place}</p>}
              <div className="lg-marks">
                {one.slotLabel && <span className="lg-slot">{one.slotLabel}</span>}
                {one.folder && (
                  <span className="lg-folder">
                    {one.folder.cabinet} / {one.folder.drawer} / {one.folder.no}
                  </span>
                )}
                {!one.slotLabel && !one.folder && (
                  <span className="hint">No bookmark and no folder yet</span>
                )}
              </div>
              <p className="hint">
                {one.counts.all} {one.counts.all === 1 ? 'bill' : 'bills'}
                {one.counts.filed ? ` · ${one.counts.filed} filed` : ''}
                {one.counts.unpriced ? ` · ${one.counts.unpriced} unpriced` : ''}
              </p>
            </div>

            <div className="lg-bills">
              {one.bills.map((b) => (
                <div key={b.id} className="lg-bill">
                  {b.photo ? (
                    <button className="lg-photo" aria-label={`View bill from ${day(b.date)}`} onClick={() => setPhoto(b.photo)}>
                      <img src={b.photo} alt="" loading="lazy" />
                    </button>
                  ) : (
                    <div className="lg-nophoto" />
                  )}
                  <div className="lg-bill-of">
                    <b>{day(b.date)}</b>
                    <span className="hint">
                      {b.refNo ? `${b.refNo} · ` : ''}
                      {b.unpriced ? 'unpriced' : money(b.amount)}
                    </span>
                    <span className="hint">
                      {WHERE[b.stage] ?? b.stage}
                      {b.slotLabel ? ` · ${b.slotLabel}` : ''}
                      {b.stack ? ` · stack ${b.stack}` : ''}
                    </span>
                  </div>
                  {/* Beside the picture, because the picture is what tells you
                      it is the wrong bill. */}
                  <button
                    className="lg-bin"
                    aria-label={`Delete the bill from ${day(b.date)}`}
                    onClick={() => { setBinning(b); setPin(''); setWrong('') }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              {!one.bills.length && <p className="pad hint">Nothing photographed for this customer.</p>}
            </div>
          </>
        )}
        {photo && <PhotoViewer src={photo} onClose={() => setPhoto(null)} />}

        {binning && (
          <div className="full sheet" onClick={() => !busy && setBinning(null)}>
            <div className="ask" onClick={(e) => e.stopPropagation()}>
              <h3>Take this bill out of the books?</h3>
              <p className="hint">
                {day(binning.date)} · {binning.unpriced ? 'unpriced' : money(binning.amount)} ·{' '}
                {one?.name}
              </p>
              <p className="hint">
                It goes to the trash with its photograph, so the panel can put it back. Type
                the code to confirm.
              </p>
              <input
                className="field search"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                placeholder="Code"
                aria-label="Code"
                value={pin}
                disabled={busy}
                onChange={(e) => { setPin(e.target.value); setWrong('') }}
              />
              {wrong && <p className="error">{wrong}</p>}
              <div className="ask-acts">
                <button className="btn ghost" disabled={busy} onClick={() => setBinning(null)}>
                  Keep it
                </button>
                <button
                  className="btn bin"
                  disabled={busy || !pin.trim()}
                  onClick={async () => {
                    setBusy(true)
                    setWrong('')
                    try {
                      await deleteBill({ filingId: binning.id, pin: pin.trim() })
                      setBinning(null)
                      setPin('')
                    } catch (e) {
                      // The server says "Wrong code." in words; anything else
                      // is a real fault and is shown as it came.
                      setWrong(String(e?.data ?? e?.message ?? e).split('\n')[0])
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ---------------- everybody ---------------- */
  return (
    <div className="body">
      <div className="lg-head">
        <input
          className="field search"
          placeholder="Find a customer…"
          aria-label="Find a customer"
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      </div>

      {rows === undefined ? (
        <p className="pad hint">Loading…</p>
      ) : !shown.length ? (
        <p className="pad hint">
          {find.trim() ? `Nobody matches “${find.trim()}”.` : 'No bills have been named yet.'}
        </p>
      ) : (
        <div className="lg-list">
          {shown.map((r) => (
            <button key={r.partyLedgerId} className="lg-row" onClick={() => setOpen(r.partyLedgerId)}>
              <span className="lg-row-name">
                <b>{r.name}</b>
                <span className="hint">
                  {r.bills} {r.bills === 1 ? 'bill' : 'bills'}
                  {r.unpriced ? ` · ${r.unpriced} unpriced` : ''}
                  {r.folder ? ` · ${r.folder.cabinet}/${r.folder.drawer}/${r.folder.no}` : ''}
                </span>
              </span>
              {/* The bookmark, when their packet is on the table right now. */}
              {r.slot !== null && r.slot !== undefined && (
                <span className="lg-slot">{`S${String(r.slot).padStart(2, '0')}`}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
