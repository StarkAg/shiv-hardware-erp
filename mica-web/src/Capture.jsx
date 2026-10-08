import { useCallback, useEffect, useRef, useState } from 'react'
import { labToHex, readSquare } from './color'

/**
 * The camera, and the square in it that is read.
 *
 * Live by default: the camera stays open with a square fixed in the middle,
 * and whatever is under the square is read several times a second — point
 * the phone at a chip and the reading (and, on Find, the matches) follow.
 * Freeze holds the reading still. Where the camera cannot be opened — no
 * permission, an old phone, a desktop with none — it falls back to a photo,
 * on which the square is placed by hand.
 *
 * Below: the photo way.
 *
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

function PhotoCapture({ onRead, hint }) {
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

      {!photo && hint && <p className="hint">{hint}</p>}

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

      {reading && <ReadingCard reading={reading} />}
    </div>
  )
}

/** The square, colour-corrected, its shades, and whether white paper was found. */
function ReadingCard({ reading }) {
  return (
    <div className="reading">
      <img src={reading.thumb.toDataURL('image/jpeg', 0.85)} alt="The square, colour-corrected" />
      <div className="reading-text">
        <Shades shades={reading.shades} />
        <div className={reading.corrected ? 'ok' : 'warn'}>
          {reading.corrected
            ? 'Corrected by the white paper around it'
            : 'No white paper inside the dashed frame — colours are the camera’s own. Lay the piece on white paper.'}
        </div>
        <div className="muted">
          {reading.shades.length} shade{reading.shades.length === 1 ? '' : 's'} · pattern {reading.texture < 2 ? 'plain' : reading.texture < 4 ? 'light' : 'busy'}
        </div>
      </div>
    </div>
  )
}

const EVERY = 300 // ms between live readings
const LIVE = 960 // longest side a live frame is read at

/**
 * The live way: the camera's picture with the square in its middle, read
 * every few hundred milliseconds. The square is a share of the picture's
 * shorter side, set by the slider; aim the phone, not the square.
 */
function LiveCapture({ onRead, onFail }) {
  const video = useRef(null)
  const frame = useRef(null)
  const [ready, setReady] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [reading, setReading] = useState(null)
  const [share, setShare] = useState(28) // % of the shorter side
  const shareRef = useRef(share)
  shareRef.current = share
  const frozenRef = useRef(frozen)
  frozenRef.current = frozen

  useEffect(() => {
    let stream = null
    let stopped = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        video.current.srcObject = stream
        await video.current.play()
        setReady(true)
      } catch {
        onFail?.()
      }
    })()
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const readNow = useCallback(() => {
    const v = video.current
    if (!v || !v.videoWidth) return
    const scale = Math.min(1, LIVE / Math.max(v.videoWidth, v.videoHeight))
    const c = frame.current ?? (frame.current = document.createElement('canvas'))
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, c.width, c.height)
    const size = Math.round((shareRef.current / 100) * Math.min(c.width, c.height))
    const r = readSquare(c, { x: Math.round((c.width - size) / 2), y: Math.round((c.height - size) / 2), size })
    setReading(r)
    onRead?.(r)
  }, [onRead])

  useEffect(() => {
    if (!ready) return
    const t = setInterval(() => { if (!frozenRef.current && document.visibilityState === 'visible') readNow() }, EVERY)
    return () => clearInterval(t)
  }, [ready, readNow])

  // Frozen, the picture holds still too, so what is read is what is seen.
  useEffect(() => {
    const v = video.current
    if (!v || !ready) return
    if (frozen) v.pause()
    else void v.play().catch(() => undefined)
  }, [frozen, ready])

  // The square and its frame, as shares of the picture.
  const w = video.current?.videoWidth || 16
  const h = video.current?.videoHeight || 9
  const side = (share / 100) * Math.min(w, h)
  const ring = side * 1.56
  const box = (s) => ({ left: `${((w - s) / 2 / w) * 100}%`, top: `${((h - s) / 2 / h) * 100}%`, width: `${(s / w) * 100}%`, height: `${(s / h) * 100}%` })

  return (
    <div className="capture">
      <div className="viewer live">
        <video ref={video} playsInline muted autoPlay />
        {ready && <div className="ring" style={box(ring)} />}
        {ready && <div className={`square${frozen ? ' frozen' : ''}`} style={box(side)} />}
        {!ready && <div className="starting">Opening the camera…</div>}
      </div>
      <div className="live-controls">
        <label className="size">
          <span>Square</span>
          <input type="range" min="8" max="45" value={share} onChange={(e) => setShare(Number(e.target.value))} />
        </label>
        <button type="button" className={frozen ? 'primary' : ''} onClick={() => setFrozen((f) => !f)} disabled={!ready}>
          {frozen ? 'Go live' : 'Freeze'}
        </button>
      </div>
      {reading && <ReadingCard reading={reading} />}
    </div>
  )
}

/** Live camera, or a photo where the camera cannot be had or is not wanted. */
export function Capture({ onRead, hint }) {
  const canLive = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const [mode, setMode] = useState(canLive ? 'live' : 'photo')
  const [failed, setFailed] = useState(false)
  return (
    <>
      <p className="hint">{hint}</p>
      {failed && <p className="warn">The camera could not be opened here, so take a photo instead.</p>}
      {mode === 'live'
        ? <LiveCapture onRead={onRead} onFail={() => { setFailed(true); setMode('photo') }} />
        : <PhotoCapture onRead={onRead} hint="" />}
      {canLive && !failed && (
        <button type="button" className="link" onClick={() => setMode(mode === 'live' ? 'photo' : 'live')}>
          {mode === 'live' ? 'Use a photo instead' : 'Use the live camera'}
        </button>
      )}
    </>
  )
}
