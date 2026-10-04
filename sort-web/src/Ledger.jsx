/**
 * Every customer, and where their paper is.
 *
 * The third thing anybody standing at the table wants, after naming and
 * placing: whose packet is on which bookmark, and what is actually in it. A
 * count alone cannot settle "is this the last of his?" — so tapping a customer
 * opens every slip they have, oldest first, with the bookmark it is sitting on.
 *
 * Nearly read-only. The one thing it can do is take a bill back off a customer
 * — because this screen, with the photographs side by side under one name, is
 * where a bill filed to the wrong man is actually spotted.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import PhotoViewer from './PhotoViewer.jsx'
import { clean } from './match.js'
import { RevertIcon } from './icons.jsx'

const money = (n) =>
  n === null || n === undefined ? null : `₹${Number(n).toLocaleString('en-IN')}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (ms) => {
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

/**
 * Search that forgives how a name was typed: case, spaces, dots and dashes do not
 * matter ("rajkumar" finds "Raj Kumar", "rk traders" finds "R. K. Traders"), and
 * the words can come in any order ("kumar raj").
 */
const squash = (s) => clean(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
const words = (s) => clean(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const matches = (name, q) => {
  const n = squash(name)
  const sq = squash(q)
  return !sq || n.includes(sq) || words(q).every((w) => n.includes(w))
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
  const revertBill = useMutation(anyApi.filing.revertBill)
  // Every customer account, so a search finds people with no paper yet too, and
  // "Add" never opens a second account for a name the books already have.
  const parties = useQuery(anyApi.filing.parties, {})
  const addCustomer = useMutation(anyApi.filing.addCustomer)
  const freeHold = useMutation(anyApi.filing.freeHold)
  const searchBox = useRef(null)
  const doneBtn = useRef(null)
  const [adding, setAdding] = useState(false)
  // The bookmark just given, shown large until Done.
  const [added, setAdded] = useState(null)

  const giveBack = async () => {
    if (!open) return
    setError('')
    try {
      const res = await freeHold({ partyLedgerId: open })
      if (res.freed) setSaid(`Bookmark ${one?.slotLabel ?? ''} given back`)
    } catch (e) {
      setError(String(e?.data ?? e?.message ?? e).split('\n')[0])
    }
  }
  const [sending, setSending] = useState(null)
  const [said, setSaid] = useState('')
  const [error, setError] = useState('')

  const sendBack = async (b) => {
    if (!b || sending) return
    setSending(b.id)
    setSaid('')
    setError('')
    try {
      const result = await revertBill({ filingId: b.id })
      setSaid(result.reverted ? `${day(b.date)} sent back to Name` : 'This entry has already been removed')
    } catch (e) {
      setError(String(e?.data ?? e?.message ?? e).split('\n')[0])
    } finally {
      setSending(null)
    }
  }

  // Same 1.6 seconds as the naming flash, so the two screens feel like one app.
  useEffect(() => {
    if (!said) return undefined
    const t = setTimeout(() => setSaid(''), 1600)
    return () => clearTimeout(t)
  }, [said])

  const typed = find.trim()

  // Customers with paper or a bookmark, plus (while searching) every other account.
  const shown = useMemo(() => {
    const all = rows ?? []
    if (!typed) return all
    const listed = new Set(all.map((r) => r.partyLedgerId))
    const others = (parties ?? [])
      .filter((p) => !listed.has(p._id))
      .map((p) => ({ partyLedgerId: p._id, name: p.name, folder: null, bills: 0, unpriced: 0, slotLabel: null, noPaper: true }))
    const sq = squash(typed)
    const rank = (r) => (squash(r.name) === sq ? 0 : squash(r.name).startsWith(sq) ? 1 : 2)
    return [...all, ...others]
      .filter((r) => matches(r.name, typed))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }, [rows, parties, typed])

  // The account this exact name already is (spacing and case aside), if any.
  const exact = typed ? shown.find((r) => squash(r.name) === squash(typed)) : null
  // Add is offered unless this exact name is already on the list with paper or a bookmark.
  const canAdd = Boolean(typed) && (!exact || (exact.noPaper && !exact.slotLabel))

  const add = async () => {
    if (!canAdd || adding) return
    setAdding(true)
    setError('')
    try {
      setAdded(await addCustomer(exact ? { partyLedgerId: exact.partyLedgerId } : { name: typed }))
    } catch (e) {
      setError(String(e?.data ?? e?.message ?? e).split('\n')[0])
    } finally {
      setAdding(false)
    }
  }

  // Done: clear the search and put the cursor back for the next name. Focusing inside
  // the tap keeps the phone's keyboard coming up.
  const nextName = () => {
    setAdded(null)
    setFind('')
    searchBox.current?.focus()
  }

  useEffect(() => {
    if (added) doneBtn.current?.focus()
  }, [added])

  /**
   * Every sheet this customer has, in one flat run, oldest first — and where
   * each bill's first sheet lands in it.
   *
   * The viewer turns pages through this, so opening any bill and pressing on
   * walks the whole packet: sheet two of a bill, then the next bill, in the
   * order the list on screen is already in.
   */
  const shots = useMemo(() => {
    const flat = []
    const opensAt = new Map()
    for (const b of one?.bills ?? []) {
      const pages = b.photos?.length ? b.photos : b.photo ? [b.photo] : []
      if (!pages.length) continue
      opensAt.set(b.id, flat.length)
      pages.forEach((url, i) => {
        flat.push({
          url,
          label: pages.length > 1 ? `${day(b.date)} · sheet ${i + 1}` : day(b.date),
          // Which bill this sheet is of, so the viewer's send-back knows what
          // it is sending back without the row being on screen.
          billId: b.id,
          bill: b,
        })
      })
    }
    return { flat, opensAt }
  }, [one])

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
                {one.heldOnly && (
                  <button className="linkbtn" onClick={giveBack}>Free bookmark</button>
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
                    <button
                      className="lg-photo"
                      aria-label={`View bill from ${day(b.date)}`}
                      onClick={() => setPhoto(shots.opensAt.get(b.id) ?? 0)}
                    >
                      <img src={b.photo} alt="" loading="lazy" />
                      {b.photos?.length > 1 && <span className="lg-sheets">{b.photos.length}</span>}
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
                      it is the wrong man's bill. */}
                  <button
                    className="lg-undo"
                    aria-label={`Send the bill from ${day(b.date)} back to be named again`}
                    disabled={sending !== null}
                    onClick={() => sendBack(b)}
                  >
                    <RevertIcon />
                  </button>
                </div>
              ))}
              {!one.bills.length && <p className="pad hint">Nothing photographed for this customer.</p>}
            </div>
          </>
        )}
        {photo !== null && shots.flat.length > 0 && (
          <PhotoViewer
            shots={shots.flat}
            start={photo}
            onClose={() => setPhoto(null)}
            onRevert={(shot) => { setPhoto(null); sendBack(shot.bill) }}
            reverting={sending !== null}
          />
        )}

        {error && <p className="error pad" role="alert">{error}</p>}
        {said && <div className="flash" role="status">{said}</div>}
      </div>
    )
  }

  /* ---------------- everybody ---------------- */
  return (
    <div className="body">
      <div className="lg-head">
        <input
          ref={searchBox}
          className="field search"
          placeholder="Find or add a customer…"
          aria-label="Find or add a customer"
          type="search"
          enterKeyHint="go"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck="false"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds only when nothing matches, so it never adds over a name on the list.
            if (e.key === 'Enter' && canAdd && !shown.length) { e.preventDefault(); add() }
          }}
        />
      </div>

      {canAdd && (
        <button className="lg-addrow" disabled={adding} onClick={add}>
          <b>+</b>
          <span>
            {exact ? <>Give <b>{exact.name}</b> a bookmark</> : <>Add <b>“{typed}”</b> and give a bookmark</>}
          </span>
        </button>
      )}

      {rows === undefined ? (
        <p className="pad hint">Loading…</p>
      ) : !shown.length ? (
        <p className="pad hint">
          {typed ? `Nobody matches “${typed}”.` : 'No customers yet. Type a name to add one.'}
        </p>
      ) : (
        <div className="lg-list">
          {shown.map((r) => (
            <button key={r.partyLedgerId} className="lg-row" onClick={() => setOpen(r.partyLedgerId)}>
              <span className="lg-row-name">
                <b>{r.name}</b>
                <span className="hint">
                  {r.noPaper ? 'no bills yet' : `${r.bills} ${r.bills === 1 ? 'bill' : 'bills'}`}
                  {r.unpriced ? ` · ${r.unpriced} unpriced` : ''}
                  {r.folder ? ` · ${r.folder.cabinet}/${r.folder.drawer}/${r.folder.no}` : ''}
                </span>
              </span>
              {/* The bookmark they are holding — from the moment they were
                  named, not from when the paper reaches the table. Written by
                  the server so this and the customer's own page cannot
                  disagree about how a number is spelt. */}
              {r.slotLabel && <span className="lg-slot">{r.slotLabel}</span>}
            </button>
          ))}
        </div>
      )}

      {added && (
        <div className="full sheet" onClick={nextName}>
          <div className="ask lg-added" role="dialog" aria-label="Bookmark given" onClick={(e) => e.stopPropagation()}>
            <p className="hint">{added.already ? 'Already holds bookmark' : 'Bookmark'}</p>
            <div className="lg-added-slot">{added.slotLabel}</div>
            <h3>{added.name}</h3>
            <div className="ask-acts">
              <button
                ref={doneBtn}
                className="btn go"
                onClick={nextName}
                onKeyDown={(e) => { if (e.key === 'Escape') nextName() }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="error pad" role="alert">{error}</p>}
      {said && <div className="flash" role="status">{said}</div>}
    </div>
  )
}
