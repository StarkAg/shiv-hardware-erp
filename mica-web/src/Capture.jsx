import { useCallback, useEffect, useRef, useState } from 'react'
import { labToHex, readSquare } from './color'

/**
 * The camera, and the square in it that is read.
 *
 * Live by default: the camera fills the space it is given, with a square fixed
 * in its middle, and whatever is under the square is read several times a
 * second — point the phone at a chip and the reading (and, on Find, the
 * matches) follow. Freeze holds it still. The dashed frame around the square
 * is where white paper should be: that is what the colours are corrected by.
 *
 * Where the camera cannot be opened — no permission, an old phone — it falls
 * back to a photo, on which the square is tapped or dragged into place. One
 * photo can then be read chip after chip.
 */

const EVERY = 300 // ms between live readings
const LIVE = 960 // longest side a live frame is read at
const WORK = 1600 // longest side a photo is worked at
const RING = 1.56 // the dashed frame, as a multiple of the square — where white paper is looked for

/** The size of an element, kept up to date. */
function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

export function Shades({ shades, height = 12 }) {
  return (
    <div className="shades" style={{ height }} aria-label="Shades">
      {shades.map((s, i) => (
        <span key={i} style={{ flex: s.w, background: labToHex(s) }} title={`${Math.round(s.w * 100)}%`} />
      ))}
    </div>
  )
}

/** The square as read: its corrected picture, its shades, and whether white paper was found. */
export function ReadingStrip({ reading }) {
  if (!reading) return <div className="reading empty">Point the square at a chip</div>
  return (
    <div className="reading">
      <img src={reading.thumb.toDataURL('image/jpeg', 0.8)} alt="The square, colour-corrected" />
      <div className="reading-text">
        <Shades shades={reading.shades} />
        <div className={reading.corrected ? 'ok' : 'warn'}>
          {reading.corrected ? '✓ White-corrected' : '⚠ No white paper in the dashed frame'}
          <span className="muted"> · {reading.shades.length} shade{reading.shades.length === 1 ? '' : 's'} · {reading.texture < 2 ? 'plain' : reading.texture < 4 ? 'light pattern' : 'busy pattern'}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * The camera, opened once and shared by Find and Add, so switching tabs does
 * not close it and wait for it to open again. It is let go of whenever the
 * app goes to the background — a phone's camera should not stay on in a
 * pocket — and taken again on the way back.
 */
let shared = null

async function camera() {
  const live = shared && (await shared.catch(() => null))
  if (live && live.getVideoTracks().some((t) => t.readyState === 'live')) return live
  shared = (async () => {
    // A camera just let go of — by another app, or this one a moment ago —
    // can refuse for a moment, so it is asked again before giving up. A
    // refused permission is final at once.
    for (let tries = 0; ; tries++) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
      } catch (err) {
        if (err?.name === 'NotAllowedError' || tries >= 3) throw err
        await new Promise((r) => setTimeout(r, 400))
      }
    }
  })()
  shared.catch(() => { shared = null })
  return shared
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden' || !shared) return
    const going = shared
    shared = null
    void going.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined)
  })
}

const centred = (side) => ({ width: side, height: side, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' })

/* ── live ─────────────────────────────────────────────────────────────── */

function LiveCapture({ onRead, onFail, hint, extra }) {
  const view = useRef(null)
  const video = useRef(null)
  const frame = useRef(null)
  const { w: cw, h: ch } = useSize(view)
  const [ready, setReady] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [share, setShare] = useState(34) // % of the view's shorter side
  const live = useRef({ frozen, share, cw, ch })
  live.current = { frozen, share, cw, ch }

  useEffect(() => {
    let stopped = false
    const attach = async () => {
      try {
        const stream = await camera()
        if (stopped || !video.current) return
        if (video.current.srcObject !== stream) video.current.srcObject = stream
        await video.current.play().catch(() => undefined)
        setReady(true)
      } catch (err) {
        console.warn('[mica] camera', err?.name, err?.message)
        if (!stopped) onFail?.()
      }
    }
    void attach()
    // Back from the background, the camera was let go of; take it again.
    const back = () => { if (document.visibilityState === 'visible') { setReady(false); void attach() } }
    document.addEventListener('visibilitychange', back)
    return () => { stopped = true; document.removeEventListener('visibilitychange', back) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * The picture fills the view and is cropped to it, so the square on screen
   * is found in the camera's frame by undoing that crop: the centres agree,
   * and the frame is scaled by whichever side had to fill.
   */
  const readNow = useCallback(() => {
    const v = video.current
    const { share: sh, cw: w, ch: h } = live.current
    if (!v?.videoWidth || !w || !h) return
    const scale = Math.min(1, LIVE / Math.max(v.videoWidth, v.videoHeight))
    const c = frame.current ?? (frame.current = document.createElement('canvas'))
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, c.width, c.height)
    const cover = Math.max(w / v.videoWidth, h / v.videoHeight)
    const size = Math.round(((sh / 100) * Math.min(w, h) / cover) * scale)
    onRead?.(readSquare(c, { x: Math.round((c.width - size) / 2), y: Math.round((c.height - size) / 2), size }))
  }, [onRead])

  useEffect(() => {
    if (!ready) return
    const t = setInterval(() => {
      if (!live.current.frozen && document.visibilityState === 'visible') readNow()
    }, EVERY)
    return () => clearInterval(t)
  }, [ready, readNow])

  useEffect(() => {
    const v = video.current
    if (!v || !ready) return
    if (frozen) v.pause()
    else void v.play().catch(() => undefined)
  }, [frozen, ready])

  const side = (share / 100) * Math.min(cw, ch)

  return (
    <div ref={view} className="viewer">
      <video ref={video} playsInline muted autoPlay />
      {ready && <div className="ring" style={centred(side * RING)} />}
      {ready && <div className={`square${frozen ? ' frozen' : ''}`} style={centred(side)} />}
      {!ready && <div className="starting">Opening the camera…</div>}
      {hint && <div className="viewer-hint">{hint}</div>}
      <div className="viewer-bar">
        <input
          type="range" min="10" max="60" value={share} aria-label="Square size"
          onChange={(e) => setShare(Number(e.target.value))}
        />
        <button type="button" className={frozen ? 'primary' : 'glass'} onClick={() => setFrozen((f) => !f)} disabled={!ready}>
          {frozen ? 'Live' : 'Freeze'}
        </button>
        {extra}
      </div>
    </div>
  )
}

/* ── photo ────────────────────────────────────────────────────────────── */

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

function PhotoCapture({ onRead, hint, extra }) {
  const view = useRef(null)
  const { w: cw, h: ch } = useSize(view)
  const [photo, setPhoto] = useState(null)
  const [box, setBox] = useState(null)
  const shown = useRef(null)
  const stage = useRef(null)
  const drag = useRef(null)
  const camera = useRef(null)
  const gallery = useRef(null)

  async function take(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const canvas = await loadPhoto(file)
    const size = Math.round(Math.min(canvas.width, canvas.height) * 0.3)
    setPhoto(canvas)
    setBox({ x: Math.round((canvas.width - size) / 2), y: Math.round((canvas.height - size) / 2), size })
  }

  useEffect(() => {
    if (!photo || !shown.current) return
    shown.current.width = photo.width
    shown.current.height = photo.height
    shown.current.getContext('2d').drawImage(photo, 0, 0)
  }, [photo, cw, ch])

  useEffect(() => {
    if (!photo || !box) return
    const t = setTimeout(() => onRead?.(readSquare(photo, box)), 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, box])

  // The whole photo, as large as the view allows.
  const fit = photo && cw && ch ? Math.min(cw / photo.width, ch / photo.height) : 0
  const at = (e) => {
    const r = stage.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * photo.width, y: ((e.clientY - r.top) / r.height) * photo.height }
  }
  const clamp = (b) => ({
    size: b.size,
    x: Math.round(Math.min(Math.max(0, b.x), photo.width - b.size)),
    y: Math.round(Math.min(Math.max(0, b.y), photo.height - b.size)),
  })
  function down(e) {
    const p = at(e)
    const inside = p.x >= box.x && p.x <= box.x + box.size && p.y >= box.y && p.y <= box.y + box.size
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
    setBox(clamp({ size, x: box.x + box.size / 2 - size / 2, y: box.y + box.size / 2 - size / 2 }))
  }
  const pct = (n, of) => `${(n / of) * 100}%`
  const ring = box ? (box.size * RING) / 2 : 0

  return (
    <div ref={view} className="viewer photo">
      {photo && box && fit > 0 && (
        <div
          ref={stage}
          className="stage"
          style={{ width: photo.width * fit, height: photo.height * fit }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        >
          <canvas ref={shown} />
          <div className="ring" style={{
            left: pct(box.x + box.size / 2 - ring, photo.width), top: pct(box.y + box.size / 2 - ring, photo.height),
            width: pct(ring * 2, photo.width), height: pct(ring * 2, photo.height),
          }} />
          <div className="square" style={{
            left: pct(box.x, photo.width), top: pct(box.y, photo.height),
            width: pct(box.size, photo.width), height: pct(box.size, photo.height),
          }} />
        </div>
      )}
      {!photo && <div className="starting">Take a photo, then tap the square onto a chip</div>}
      {hint && !photo && <div className="viewer-hint">{hint}</div>}
      <div className="viewer-bar">
        {photo && box && (
          <input
            type="range" min="6" max="60" aria-label="Square size"
            value={Math.round((box.size / Math.min(photo.width, photo.height)) * 100)}
            onChange={resize}
          />
        )}
        <button type="button" className="primary" onClick={() => camera.current?.click()}>{photo ? 'New photo' : 'Photo'}</button>
        <button type="button" className="glass" onClick={() => gallery.current?.click()}>Gallery</button>
        {extra}
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={take} />
        <input ref={gallery} type="file" accept="image/*" hidden onChange={take} />
      </div>
    </div>
  )
}

/* ── either ───────────────────────────────────────────────────────────── */

/** Live camera, or a photo where the camera cannot be had or is not wanted. */
export function Capture({ onRead, hint }) {
  const canLive = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const [mode, setMode] = useState(canLive ? 'live' : 'photo')
  const [failed, setFailed] = useState(false)
  const swap = canLive && (
    <button
      type="button"
      className="glass icon"
      onClick={() => { setFailed(false); setMode(mode === 'live' ? 'photo' : 'live') }}
      aria-label={mode === 'live' ? 'Use a photo instead' : 'Use the live camera'}
      title={mode === 'live' ? 'Use a photo instead' : 'Use the live camera'}
    >
      {mode === 'live' ? '🖼' : '🎥'}
    </button>
  )
  return mode === 'live'
    ? <LiveCapture onRead={onRead} hint={hint} extra={swap} onFail={() => { setFailed(true); setMode('photo') }} />
    : <PhotoCapture onRead={onRead} hint={failed ? 'The camera could not be opened here — take a photo instead.' : hint} extra={swap} />
}
