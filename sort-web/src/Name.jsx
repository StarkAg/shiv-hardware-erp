/**
 * The first walk: giving every slip a name.
 *
 * Photograph, name, back on the stack in the same order it came off. No paper
 * moves and no slot is spent — that is the second walk's job. Keeping them
 * apart is what lets forty slots sort two thousand bills: a slot is held from
 * the moment it is given until that customer's packet is filed, so handing one
 * out here would hold the table for paper still sitting in the stack.
 */
import { useEffect, useRef, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { bestMatch, clean, isOwnShop } from './match.js'
import Picker from './Picker.jsx'
import PhotoViewer from './PhotoViewer.jsx'
import { preload } from './preload.js'
import { TrashIcon } from './icons.jsx'

const stackName = (s) => (s ? `Stack ${s}` : 'No stack')

export default function Name({ onNavigate }) {
  const [stack, setStack] = useState(null)
  const [pick, setPick] = useState({ id: '', name: '' })
  const [touched, setTouched] = useState(false)
  const [picking, setPicking] = useState(false)
  const [page, setPage] = useState(0)
  const [big, setBig] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState('')
  // Asked before a photograph is destroyed: there is no undo and the slip in
  // your hand may be the only record that it was ever shot.
  const [binning, setBinning] = useState(false)
  /**
   * Enter walks the whole loop, without a key handler of its own.
   *
   * Naming a stack is the same three beats a few hundred times over: open the
   * list, take a name off it, save. Whichever of those comes next is given the
   * focus, so Enter — which presses whatever is focused — always does the next
   * thing. Picking hands focus to Save; saving hands it back to the field for
   * the slip that follows, so the key can be leant on without a mis-typed
   * guess ever being filed by a second press that arrived too early.
   */
  const [focusWant, setFocusWant] = useState(null)
  const fieldRef = useRef(null)
  const saveRef = useRef(null)

  const stacks = useQuery(anyApi.filing.waiting, {})
  const parties = useQuery(anyApi.filing.parties, {})
  const next = useQuery(anyApi.filing.toName, {
    ...(stack === null ? {} : { stack }),
  })
  const nameIt = useMutation(anyApi.filing.nameIt)
  const discardShot = useMutation(anyApi.filing.discardShot)
  const readAhead = useAction(anyApi.ai.readNamesAhead)

  const photo = next?.photo ?? null
  const guess = clean(photo?.guess)

  // Fetch the next few slips while this one is being answered, so the card is
  // never blank when it arrives.
  useEffect(() => {
    preload(next?.ahead)
    // Both sheets of a two-sheet bill: the second is one tap away.
    preload((photo?.pages ?? []).map((p) => p.url))
  }, [next?.ahead, photo?.pages])

  // Keeps the reader four slips ahead, so the name is usually already filled in.
  const asked = useRef('')
  useEffect(() => {
    if (!photo?.id || asked.current === photo.id) return
    asked.current = photo.id
    readAhead({ ...(stack === null ? {} : { stack }), limit: 4 }).catch(() => {})
  }, [photo?.id, stack, readAhead])

  useEffect(() => {
    setTouched(false)
    setPicking(false)
    setPage(0)
    setError('')
  }, [photo?.id])

  useEffect(() => {
    if (touched || !photo || !parties) return
    const want =
      !guess || isOwnShop(guess)
        ? { id: '', name: '' }
        : (() => {
            const m = bestMatch(guess, parties)
            return m ? { id: m.ledger._id, name: m.ledger.name } : { id: '', name: guess }
          })()
    setPick((was) => (was.id === want.id && was.name === want.name ? was : want))
  }, [touched, photo, guess, parties])

  useEffect(() => {
    if (!said) return undefined
    const t = setTimeout(() => setSaid(''), 1600)
    return () => clearTimeout(t)
  }, [said])

  // Runs again as the next slip arrives: the button asked for may not have
  // been on screen yet at the moment it was asked for.
  useEffect(() => {
    if (!focusWant) return undefined
    const el = focusWant === 'save' ? saveRef.current : fieldRef.current
    if (!el || el.disabled) return undefined
    el.focus()
    setFocusWant(null)
    return undefined
  }, [focusWant, photo?.id, busy, picking])

  const chips = [
    { key: '*', label: 'All', bills: (stacks ?? []).reduce((n, s) => n + s.bills, 0), stack: null },
    ...(stacks ?? []).map((s) => ({
      key: s.stack || '-',
      label: stackName(s.stack),
      bills: s.bills,
      stack: s.stack,
    })),
  ]

  const save = async () => {
    if (!photo || (!pick.id && !pick.name.trim())) return setError('Say whose bill this is')
    setBusy(true)
    setError('')
    try {
      const res = await nameIt({
        inboxId: photo.id,
        ...(pick.id ? { partyLedgerId: pick.id } : { partyName: pick.name.trim() }),
      })
      setSaid(`${res.party} — back on the stack`)
      setFocusWant('field')
    } catch (err) {
      setError(err?.message ?? String(err))
    }
    setBusy(false)
    return undefined
  }

  const pages = photo?.pages ?? []
  const sheet = pages[Math.min(page, Math.max(0, pages.length - 1))]

  return (
    <>
      <nav className="chips" aria-label="Stack">
        {chips.map((c) => (
          <button
            key={c.key}
            className={`chip${c.stack === stack ? ' on' : ''}`}
            disabled={busy}
            aria-pressed={c.stack === stack}
            onClick={() => {
              setStack(c.stack)
            }}
          >
            {c.label}
            <b>{c.bills}</b>
          </button>
        ))}
      </nav>

      <main className={`body${picking ? ' is-picking' : ''}`}>
        {next === undefined && <p className="muted pad">Opening the tray…</p>}

        {next && !photo && (
          <div className="empty">
            <p className="big">
              Nothing left to name{stack === null ? '' : ` in ${stackName(stack)}`}.
            </p>
            <p className="muted">Photograph more bills, or take your named stack to Place.</p>
            <div className="empty-actions"><button className="btn go" onClick={() => onNavigate('shoot')}>Shoot bills</button><button className="btn" onClick={() => onNavigate('place')}>Place a stack</button></div>
          </div>
        )}

        {photo && (
          <>
            {/* While the names are open the photo shrinks to its top edge rather
                than disappearing — that is where the customer's name is written,
                and it is being copied off it as it is typed. */}
            <div className={`slip${picking ? ' peek' : ''}`}>
              <button className="shot" onClick={() => setBig(true)} aria-label="Enlarge bill photo" disabled={!sheet?.url}>
                {sheet?.url ? (
                  <img src={sheet.url} alt="" decoding="sync" fetchpriority="high" />
                ) : (
                  <span className="muted">photo gone</span>
                )}
              </button>
              <div className="place">
                <span className="where">
                  {photo.stack ? `${photo.stack} · ` : ''}
                  {next.index} of {next.total}
                </span>
                {pages.length > 1 && (
                  <span className="pages">
                    <button aria-label="Previous sheet" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
                    {Math.min(page, pages.length - 1) + 1}/{pages.length}
                    <button aria-label="Next sheet" disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)}>›</button>
                  </span>
                )}
              </div>
            </div>

            <div className="who">
              <span className="label">
                Customer
                {photo.reading === 'reading' && <em> · reading it…</em>}
                {guess && !isOwnShop(guess) && <em> · read as “{guess}”</em>}
                {guess && isOwnShop(guess) && <em> · that is our own name</em>}
                {!guess && photo.reading === 'ready' && <em> · nothing readable</em>}
              </span>

              {picking ? (
                <Picker
                  parties={parties}
                  value={pick.id}
                  guess={guess}
                  onPick={(p) => {
                    setPick(p)
                    setTouched(true)
                    setPicking(false)
                    setFocusWant('save')
                  }}
                  onClose={() => setPicking(false)}
                />
              ) : (
                <>
                  <button
                    ref={fieldRef}
                    className={`field${pick.id || pick.name ? '' : ' blank'}`}
                    onClick={() => setPicking(true)}
                  >
                    <span>{pick.name || 'Pick the customer'}</span>
                    <b>▾</b>
                  </button>
                  {!pick.id && pick.name.trim() && (
                    <p className="hint">Filing this opens a new account for “{pick.name.trim()}”.</p>
                  )}
                </>
              )}

              {error && <p className="error" role="alert">{error}</p>}
            </div>
          </>
        )}
      </main>

      {photo && !picking && (
        <footer className="acts">
          {/* Narrow on purpose. Saving is what happens a thousand times in an
              afternoon and keeps the width a thumb expects; the one that
              destroys a photograph sits off to the side, out of its path. */}
          <button
            className="btn slim"
            disabled={busy}
            aria-label="Throw this photograph away"
            onClick={() => setBinning(true)}
          >
            <TrashIcon />
          </button>
          <button ref={saveRef} className="btn go" disabled={busy || (!pick.id && !pick.name.trim())} onClick={save}>
            {busy ? 'Saving…' : 'Save name'}
          </button>
        </footer>
      )}

      {binning && photo && (
        <div className="full sheet" onClick={() => setBinning(false)}>
          <div className="ask" onClick={(e) => e.stopPropagation()}>
            <h3>Throw this photograph away?</h3>
            <p className="hint">
              Every sheet of this bill goes with it, and it cannot be brought back. The paper
              is still in your hand — shoot it again if it was only a bad picture.
            </p>
            <div className="ask-acts">
              <button className="btn ghost" disabled={busy} onClick={() => setBinning(false)}>
                Keep it
              </button>
              <button
                className="btn bin"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    await discardShot({ inboxId: photo.id })
                    setBinning(false)
                    setSaid('Thrown away.')
                  } catch (e) {
                    setError(String(e?.message || e))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {busy ? 'Throwing…' : 'Throw it away'}
              </button>
            </div>
          </div>
        </div>
      )}

      {said && <div className="flash" role="status">{said}</div>}

      {big && sheet?.url && <PhotoViewer src={sheet.url} onClose={() => setBig(false)} />}
    </>
  )
}
