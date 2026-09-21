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
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import PhotoViewer from './PhotoViewer.jsx'
import { preload } from './preload.js'

const stackName = (s) => (s ? `Stack ${s}` : 'No stack')

export default function Place({ onNavigate }) {
  const [big, setBig] = useState(false)
  const [stack, setStack] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shown, setShown] = useState(null)   // what this phone last called out

  const state = useQuery(anyApi.filing.placeState, stack === null ? {} : { stack })
  const placeNext = useMutation(anyApi.filing.placeNext)
  const unplace = useMutation(anyApi.filing.unplace)

  // Opening the app again mid-stack picks up where it was left, rather than
  // showing a blank screen to somebody holding a slip.
  useEffect(() => {
    setShown(null)
  }, [stack])
  const card = shown ?? state?.current ?? null

  // Next is pressed as fast as paper can be moved; the photograph has to be
  // there already or it is only ever seen after the fact.
  useEffect(() => {
    preload(state?.ahead)
  }, [state?.ahead])

  const next = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await placeNext(stack === null ? {} : { stack })
      setShown(res.done ? null : res.card)
      if (res.done) setError('')
    } catch (err) {
      setError(err?.message ?? String(err))
    }
    setBusy(false)
  }

  const back = async () => {
    if (!card) return
    setBusy(true)
    try {
      await unplace({ id: card.id })
      setShown(null)
    } catch (err) {
      setError(err?.message ?? String(err))
    }
    setBusy(false)
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

  const left = state?.left ?? 0

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
            {card.slotLabel ? (
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
