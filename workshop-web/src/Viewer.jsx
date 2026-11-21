import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CloseIcon, ShareIcon } from './ui.jsx'
import { SendOut, photoBlob } from './sendOut.jsx'

/** A job's photos, full screen: swipe (or the arrow keys) from one to the next. */
export default function Viewer({ photos, start, title, onClose }) {
  const strip = useRef(null)
  const [at, setAt] = useState(start)
  const [note, setNote] = useState('')

  // Opens on the photo that was tapped.
  useLayoutEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = start * el.clientWidth
  }, [start])

  const turn = (by) => {
    const el = strip.current
    if (el) el.scrollTo({ left: Math.min(photos.length - 1, Math.max(0, at + by)) * el.clientWidth, behavior: 'smooth' })
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') turn(1)
      else if (e.key === 'ArrowLeft') turn(-1)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** The photo on screen, handed to the phone's share sheet (WhatsApp and the rest). */
  const share = async () => {
    setNote('')
    try {
      const res = await fetch(photos[at].url)
      const blob = await res.blob()
      const base = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Work order'
      const file = new File([blob], `${base} ${at + 1}.jpg`, { type: blob.type || 'image/jpeg' })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: base }); return }
      // No share sheet here (a computer): the photo is saved instead.
      const link = document.createElement('a')
      link.href = URL.createObjectURL(file)
      link.download = file.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
      setNote('Saved to this device.')
    } catch (err) {
      if (err?.name !== 'AbortError') setNote('Could not share. Try again.')
    }
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="vbar">
        <button type="button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <span className="count">{photos.length > 1 ? `${at + 1} of ${photos.length}` : ''}</span>
        <button type="button" className="text" onClick={share}><ShareIcon size={20} /> Share</button>
      </div>
      <div className="vstrip" ref={strip}
        onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {photos.map((p, i) => (
          <div key={p.storageId} className="vslide" onClick={onClose}>
            {/* The photo itself, for reading a figure up close; the phone keeps it once fetched (sw.js). */}
            <img src={p.url} alt={`Photo ${i + 1}`} loading={Math.abs(i - start) > 1 ? 'lazy' : undefined} onClick={(e) => e.stopPropagation()} />
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="vdots" aria-hidden="true">{photos.map((p, i) => <i key={p.storageId} className={i === at ? 'on' : ''} />)}</div>
      )}
      {note && <div className="vnote" role="status">{note}</div>}
      {/* The photo on screen: to the shop's group, or straight to the printer. */}
      {photos[at] && (
        <SendOut key={photos[at].storageId} className="onphoto" mode="auto"
          name={`${title} ${at + 1}`} caption={title} getBlob={() => photoBlob(photos[at].url)} />
      )}
    </div>
  )
}
