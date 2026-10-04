/**
 * The second walk: putting the paper where it goes.
 *
 * Pick up the stack, press Next, and the screen says whose slip is on top and
 * which bookmark it goes behind. Place it, press Next again. That is the whole
 * screen, because that is the whole job — the thinking was done on the first
 * walk and this hand is holding paper, not a phone.
 *
 * The stack is walked in the order it was photographed, which is the order it
 * is sitting in, so the slip being named on the screen is always the one on
 * top. Nothing has to be searched for.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { anyApi } from 'convex/server'
import { send, unhide, unsend, useAnswers, useCached, useOutbox } from './local.js'
import PhotoViewer from './PhotoViewer.jsx'
import { preload } from './preload.js'

const stackName = (s) => (s ? `Stack ${s}` : 'No stack')

export default function Place({ onNavigate }) {
  const [big, setBig] = useState(false)
  const [stack, setStack] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shown, setShown] = useState(null)   // what this phone last called out

  // The next few dozen slips, from this phone's copy first. Next walks this
  // list on the spot; the server is told behind it.
  const state = useCached(anyApi.filing.placeQueue, stack === null ? {} : { stack }, `placeQueue:${stack ?? '*'}`)
  const { hidden } = useOutbox()
  const queue = useMemo(() => (state?.queue ?? []).filter((c) => !hidden.has(c.id)), [state, hidden])

  // Opening the app again mid-stack picks up where it was left, rather than
  // showing a blank screen to somebody holding a slip.
  useEffect(() => {
    setShown(null)
  }, [stack])
  const card = shown ?? state?.current ?? null

  // Next is pressed as fast as paper can be moved; the photograph has to be
  // there already or it is only ever seen after the fact.
  const ahead = useMemo(() => queue.slice(0, 6).map((c) => c.url).filter(Boolean), [queue])
  useEffect(() => {
    preload(ahead)
  }, [ahead])

  // A slip named before bookmarks were decided at naming has no number yet;
  // the server gives it one and its answer fills it in.
  useAnswers(useCallback((item, result, failed) => {
    if (item.fn !== 'filing:placeRow') return
    if (failed) return setError(`Not saved — ${failed}`)
    setShown((s) => (s && s.id === item.hide && s.slot == null && result?.slot != null
      ? { ...s, slot: result.slot, slotLabel: `S${String(result.slot).padStart(2, '0')}` }
      : s))
  }, []))

  const next = () => {
    const top = queue[0]
    if (!top) return
    setError('')
    setShown(top)
    send(anyApi.filing.placeRow, { id: top.id }, top.id)
  }

  const back = () => {
    if (!card) return
    setError('')
    // Not sent yet: simply taken back. Already sent: put back on the stack.
    if (!unsend(card.id, 'filing:placeRow')) send(anyApi.filing.unplace, { id: card.id })
    unhide(card.id)
    setShown(null)
  }

  const chips = [
    { key: '*', label: 'All', left: (state?.stacks ?? []).reduce((n, s) => n + s.left, 0), stack: null },
    ...(state?.stacks ?? []).map((s) => ({
      key: s.stack || '-',
      label: stackName(s.stack),
      left: s.left,
      stack: s.stack,
    })),
  ]

  // Placed here but not yet on the server: no longer left.
  const left = Math.max(0, (state?.left ?? 0) - (state?.queue ?? []).filter((c) => hidden.has(c.id)).length)

  return (
    <>
      <nav className="chips" aria-label="Stack">
        {chips.map((c) => (
          <button
            key={c.key}
            className={`chip${c.stack === stack ? ' on' : ''}`}
            disabled={busy} aria-pressed={c.stack === stack}
            onClick={() => setStack(c.stack)}
          >
            {c.label}
            <b>{c.left}</b>
          </button>
        ))}
      </nav>

      <main className="body">
        {state === undefined && <p className="muted pad">Looking at the stack…</p>}

        {state && !card && left > 0 && (
          <div className="empty">
            <p className="big">{left} named bills in this stack.</p>
            <p className="muted">
              Pick up the stack the right way up and press Next. The app calls out the name and the
              bookmark for the slip on top.
            </p>
          </div>
        )}

        {state && !card && left === 0 && (
          <div className="empty">
            <p className="big">Every named bill in this stack is on the table.</p>
            <p className="muted">
              Name some more, or file a packet into its folder to free its slot.
            </p>
            <button className="btn go empty-action" onClick={() => onNavigate('name')}>Name bills</button>
          </div>
        )}

        {card && (
          <div className="call">
            {card.url && (
              <button className="callshot" aria-label="Enlarge bill photo" onClick={() => setBig(true)}>
                <img src={card.url} alt="" decoding="sync" fetchpriority="high" />
              </button>
            )}
            <p className="callwhere">
              {card.stack ? `${card.stack} · ` : ''}
              {card.index} of {card.total}
            </p>
            <p className="callwho">{card.party}</p>
            {card.slot == null && hidden.has(card.id) ? (
              <p className="callslot"><span>BOOKMARK</span><b>…</b></p>
            ) : card.slotLabel ? (
              <p className="callslot">
                <span>BOOKMARK</span>
                <b>{card.slot}</b>
              </p>
            ) : (
              <p className="callfull">
                Every bookmark is taken — file a packet into its folder, then press Next again.
              </p>
            )}
          </div>
        )}

        {error && <p className="error pad">{error}</p>}
      </main>

      <footer className="acts">
        <button className="btn ghost" disabled={busy || !card} onClick={back}>
          Undo
        </button>
        <button className="btn go" disabled={busy || left === 0} onClick={next}>
          {busy ? '…' : left === 0 ? 'Nothing left' : `Next · ${left} left`}
        </button>
      </footer>
      {big && card?.url && <PhotoViewer src={card.url} onClose={() => setBig(false)} />}
    </>
  )
}
