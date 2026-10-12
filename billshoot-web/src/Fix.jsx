import { useEffect, useMemo, useRef, useState } from 'react'
import { WHOLE } from './crop.js'

/**
 * One page, put right: the photo it came from with the four corners the
 * finder chose, each dragged to where the paper really ends. A magnifier
 * shows what is under the finger, which hides the very corner being placed.
 * Also: turn the page, move it earlier or later, or take it out.
 */
export default function Fix({ page, index, count, onClose, onDelete, onMove, onTurn, onRecut }) {
  const box = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [corners, setCorners] = useState(page.corners ?? WHOLE)
  const [held, setHeld] = useState(-1)
  const [busy, setBusy] = useState(false)
  const photoUrl = useMemo(() => page.photo.toDataURL('image/jpeg', 0.85), [page.photo])

  useEffect(() => {
    const el = box.current
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pw = page.photo.width, ph = page.photo.height
  const s = Math.min(size.w / pw, size.h / ph) || 0
  const r = { x: (size.w - pw * s) / 2, y: (size.h - ph * s) / 2, w: pw * s, h: ph * s }
  const at = (p) => ({ x: r.x + p.x * r.w, y: r.y + p.y * r.h })

  const move = (e) => {
    if (held < 0) return
    const b = box.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - b.left - r.x) / r.w))
    const y = Math.min(1, Math.max(0, (e.clientY - b.top - r.y) / r.h))
    setCorners((q) => q.map((p, i) => (i === held ? { x, y } : p)))
  }

  const changed = corners.some((p, i) => {
    const o = (page.corners ?? WHOLE)[i]
    return Math.abs(p.x - o.x) > 0.002 || Math.abs(p.y - o.y) > 0.002
  })

  const done = async () => {
    if (changed) {
      setBusy(true)
      try { await onRecut(corners) } finally { setBusy(false) }
    }
    onClose()
  }

  const lens = held >= 0 ? at(corners[held]) : null
  const ZOOM = 2.5, LENS = 110

  return (
    <div className="fix">
      <header className="fix-top">
        <button type="button" className="glass" onClick={onClose} aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        <span className="title">Page {index + 1} of {count}</span>
        <button type="button" className="primary" disabled={busy} onClick={done}>{busy ? '…' : 'Done'}</button>
      </header>
      <div
        className="fix-photo"
        ref={box}
        onPointerMove={move}
        onPointerUp={() => setHeld(-1)}
        onPointerCancel={() => setHeld(-1)}
      >
        <img src={photoUrl} alt="" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
        <svg width={size.w} height={size.h}>
          <polygon points={corners.map((p) => { const q = at(p); return `${q.x},${q.y}` }).join(' ')} />
        </svg>
        {corners.map((p, i) => {
          const q = at(p)
          return (
            <span
              key={i}
              className={`handle${held === i ? ' held' : ''}`}
              style={{ left: q.x, top: q.y }}
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.parentElement.setPointerCapture(e.pointerId); setHeld(i) }}
            />
          )
        })}
        {lens && (
          <div
            className="lens"
            style={{
              left: Math.min(size.w - LENS - 8, Math.max(8, lens.x - LENS / 2)),
              top: lens.y > LENS * 1.6 ? lens.y - LENS * 1.4 : lens.y + LENS * 0.5,
              width: LENS, height: LENS,
              backgroundImage: `url(${photoUrl})`,
              backgroundSize: `${r.w * ZOOM}px ${r.h * ZOOM}px`,
              backgroundPosition: `${LENS / 2 - (lens.x - r.x) * ZOOM}px ${LENS / 2 - (lens.y - r.y) * ZOOM}px`,
            }}
          />
        )}
      </div>
      <footer className="fix-bar">
        <button type="button" className="glass" onClick={() => setCorners(WHOLE)}>Whole</button>
        <button type="button" className="glass" disabled={busy} onClick={() => void onTurn()} aria-label="Turn the page"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg></button>
        <button type="button" className="glass" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move page earlier"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>
        <button type="button" className="glass" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move page later"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
        <button type="button" className="glass danger" onClick={onDelete}>Delete</button>
      </footer>
    </div>
  )
}
