import { useEffect, useRef, useState } from 'react'
import { RevertIcon } from './icons.jsx'

/**
 * One photographed bill, big.
 *
 * It takes either a single `src` — the Name and Place tabs, where there is
 * exactly one slip in front of you and nothing to turn to — or a `shots` list
 * with the one to open. The list is what the Ledger hands it: every sheet of
 * every bill that customer has, so the question "is this the last of his?" is
 * answered by turning pages rather than by closing the picture, finding the
 * next row and opening it again.
 *
 * `onRevert` puts the send-back button in here as well as on the row. This is
 * the screen where the mistake is actually seen — the photograph filling the
 * phone is what tells you it is the wrong man's bill — so asking the eye to
 * close the picture, find the row again and only then act is asking it to
 * carry the mistake across two screens.
 *
 * Native modal keeps focus inside the viewer and restores it to the opener.
 */
export default function PhotoViewer({ src, shots, start = 0, onClose, onRevert, reverting = false }) {
  const list = shots ?? (src ? [{ url: src }] : [])
  const dialog = useRef(null)
  const scroll = useRef(null)
  const [at, setAt] = useState(() => Math.min(Math.max(start, 0), list.length - 1))
  const [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = dialog.current
    el.showModal()
    return () => el.close()
  }, [])

  const index = Math.min(Math.max(at, 0), Math.max(0, list.length - 1))
  const shot = list[index]
  const many = list.length > 1

  // A new sheet is a new thing to read: it starts fitted and at the top,
  // rather than inheriting the last one's magnified corner.
  const go = (step) => {
    const next = index + step
    if (next < 0 || next >= list.length) return
    setAt(next)
    setZoom(1)
    setFailed(false)
    scroll.current?.scrollTo(0, 0)
  }

  useEffect(() => {
    setZoom(1)
    setFailed(false)
    scroll.current?.scrollTo(0, 0)
  }, [shot?.url])

  // The arrow keys, because on the laptop that is what the hand reaches for
  // and the buttons are for the phone.
  useEffect(() => {
    if (!many) return
    const key = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [many, index, list.length])

  return (
    <dialog ref={dialog} className="photo-viewer" aria-label="Bill photo" onCancel={e => { e.preventDefault(); onClose() }}>
      <div className="photo-toolbar">
        <button onClick={onClose} autoFocus aria-label="Close photo">‹ Close</button>
        {many && <span className="photo-which">{shot?.label ? `${shot?.label} · ` : ''}{index + 1} of {list.length}</span>}
        <div className="photo-zoom">
          <button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - 0.5))}>−</button>
          <button aria-label="Fit photo to screen" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom(z => Math.min(4, z + 0.5))}>+</button>
        </div>
      </div>
      {!shot || failed ? <p className="photo-error" role="alert">This photo could not load. Close it and try again when connected.</p> : (
        <div className="photo-scroll" ref={scroll}>
          <div className="photo-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
            <img key={shot.url} src={shot.url} alt="Photographed bill" onError={() => setFailed(true)} draggable="false" />
          </div>
        </div>
      )}
      {many && (
        <>
          <button className="photo-turn back" aria-label="Previous bill" disabled={index === 0} onClick={() => go(-1)}>
            <Chevron dir="left" />
          </button>
          <button className="photo-turn on" aria-label="Next bill" disabled={index === list.length - 1} onClick={() => go(1)}>
            <Chevron dir="right" />
          </button>
        </>
      )}
      {shot?.billId && onRevert && (
        <div className="photo-foot">
          {onRevert && (
            <button className="photo-undo" disabled={reverting} onClick={() => onRevert(shot)}>
              <RevertIcon />
              <span>Send back to Name</span>
            </button>
          )}
        </div>
      )}
      <p className="photo-help">
        Use + to read the details. Drag to move around.
        {many ? ' Arrows turn to the next bill.' : ''}
      </p>
    </dialog>
  )
}

function Chevron({ dir }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 5 8 12l7 7' : 'm9 5 7 7-7 7'} />
    </svg>
  )
}
