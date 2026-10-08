import { useEffect, useRef, useState } from 'react'
import { labToHex, readSquare } from './color'

/**
 * A photo, and the square on it that is read.
 *
 * The photo is taken with the phone's own camera (or picked from the gallery)
 * and drawn here at a working size. Tap where the square should go, or drag
 * it; the slider sets its size. The dashed frame around it is where the white
 * paper should be — that is what the colours are corrected by. The square is
 * read again whenever it moves, and kept until a new photo is taken, so a
 * whole catalog page is read from one photo, chip after chip.
 */

const WORK = 1600 // longest side the photo is worked at, in pixels

async function loadPhoto(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, WORK / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function Shades({ shades, height = 14 }) {
  return (
    <div className="shades" style={{ height }} aria-label="Shades">
      {shades.map((s, i) => (
        <span key={i} style={{ flex: s.w, background: labToHex(s) }} title={`${Math.round(s.w * 100)}%`} />
      ))}
    </div>
  )
}

export function Capture({ onRead, hint }) {
  const [photo, setPhoto] = useState(null)
  const [box, setBox] = useState(null)
  const [reading, setReading] = useState(null)
  const [busy, setBusy] = useState(false)
  const view = useRef(null)
  const shown = useRef(null)
  const drag = useRef(null)
  const camera = useRef(null)
  const gallery = useRef(null)

  async function take(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const canvas = await loadPhoto(file)
      const size = Math.round(Math.min(canvas.width, canvas.height) * 0.3)
      setPhoto(canvas)
      setBox({ x: Math.round((canvas.width - size) / 2), y: Math.round((canvas.height - size) / 2), size })
    } finally {
      setBusy(false)
    }
  }

  // The photo itself is drawn once into the visible canvas.
  useEffect(() => {
    if (!photo || !shown.current) return
    shown.current.width = photo.width
    shown.current.height = photo.height
    shown.current.getContext('2d').drawImage(photo, 0, 0)
  }, [photo])

  // Read the square a moment after it stops moving.
  useEffect(() => {
    if (!photo || !box) return
    const t = setTimeout(() => {
      const r = readSquare(photo, box)
      setReading(r)
      onRead?.(r)
    }, 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, box])

  /** A point on screen, in the photo's own pixels. */
  function at(e) {
    const r = view.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * photo.width, y: ((e.clientY - r.top) / r.height) * photo.height }
  }
  const clamp = (b) => ({
    size: b.size,
    x: Math.round(Math.min(Math.max(0, b.x), photo.width - b.size)),
    y: Math.round(Math.min(Math.max(0, b.y), photo.height - b.size)),
  })

  function down(e) {
    if (!photo) return
    const p = at(e)
    const inside = p.x >= box.x && p.x <= box.x + box.size && p.y >= box.y && p.y <= box.y + box.size
    // Tap outside the square: it goes there. Inside: it is picked up.
    const start = inside ? box : clamp({ ...box, x: p.x - box.size / 2, y: p.y - box.size / 2 })
    if (!inside) setBox(start)
    drag.current = { from: p, box: start }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function move(e) {
    if (!drag.current) return
    const p = at(e)
    const { from, box: b } = drag.current
    setBox(clamp({ ...b, x: b.x + p.x - from.x, y: b.y + p.y - from.y }))
  }
  const up = () => { drag.current = null }

  function resize(e) {
    const size = Math.round((Number(e.target.value) / 100) * Math.min(photo.width, photo.height))
    const cx = box.x + box.size / 2, cy = box.y + box.size / 2
    setBox(clamp({ size, x: cx - size / 2, y: cy - size / 2 }))
  }

  const pct = (n, of) => `${(n / of) * 100}%`
  const ring = box && photo ? box.size * 0.78 : 0

  return (
    <div className="capture">
      <div className="capture-buttons">
        <button type="button" className="primary" onClick={() => camera.current?.click()} disabled={busy}>
          {photo ? 'New photo' : 'Take photo'}
        </button>
        <button type="button" onClick={() => gallery.current?.click()} disabled={busy}>From gallery</button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={take} />
        <input ref={gallery} type="file" accept="image/*" hidden onChange={take} />
      </div>

      {!photo && <p className="hint">{hint}</p>}

      {photo && box && (
        <>
          <div
            ref={view}
            className="viewer"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            <canvas ref={shown} />
            <div
              className="ring"
              style={{
                left: pct(box.x + box.size / 2 - ring, photo.width),
                top: pct(box.y + box.size / 2 - ring, photo.height),
                width: pct(ring * 2, photo.width),
                height: pct(ring * 2, photo.height),
              }}
            />
            <div
              className="square"
              style={{
                left: pct(box.x, photo.width),
                top: pct(box.y, photo.height),
                width: pct(box.size, photo.width),
                height: pct(box.size, photo.height),
              }}
            />
          </div>
          <label className="size">
            <span>Square</span>
            <input
              type="range"
              min="6"
              max="60"
              value={Math.round((box.size / Math.min(photo.width, photo.height)) * 100)}
              onChange={resize}
            />
          </label>
        </>
      )}

      {reading && (
        <div className="reading">
          <img src={reading.thumb.toDataURL('image/jpeg', 0.85)} alt="The square, colour-corrected" />
          <div className="reading-text">
            <Shades shades={reading.shades} />
            <div className={reading.corrected ? 'ok' : 'warn'}>
              {reading.corrected
                ? 'Corrected by the white paper around it'
                : 'No white paper found around the square — colours are the camera’s own. Lay the piece on white paper, or keep paper inside the dashed frame.'}
            </div>
            <div className="muted">
              {reading.shades.length} shade{reading.shades.length === 1 ? '' : 's'} · pattern {reading.texture < 2 ? 'plain' : reading.texture < 4 ? 'light' : 'busy'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
