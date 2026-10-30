import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/**
 * A bill page made small before it leaves the phone, every figure still
 * readable: at most 1800px on its long side, WebP where the phone can write it
 * (about half the size of a JPEG that looks the same), JPEG where it cannot —
 * iPhone Safari answers a WebP request with a PNG, which would be bigger.
 * Camera shots and photos chosen from the gallery go through the same door;
 * a chosen photo used to go up as it was, often several MB.
 */
const MAX_SIDE = 1800
const QUALITY = 0.72
const canvasBlob = (canvas, type) => new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY))

/** `area`, when given, is the part of the picture to keep: { x, y, w, h } in its own pixels. */
async function compress(drawable, width, height, area) {
  const { x, y, w, h } = area ?? { x: 0, y: 0, w: width, h: height }
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  canvas.getContext('2d').drawImage(drawable, x, y, w, h, 0, 0, canvas.width, canvas.height)
  const webp = await canvasBlob(canvas, 'image/webp')
  return webp?.type === 'image/webp' ? webp : canvasBlob(canvas, 'image/jpeg')
}

const asFile = (blob) => new File([blob], `voucher-${Date.now()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type })

/** A gallery photo, compressed; the original when it cannot be read or would not shrink. */
async function shrink(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const blob = await compress(bitmap, bitmap.width, bitmap.height)
    bitmap.close?.()
    return blob && blob.size < file.size ? asFile(blob) : file
  } catch {
    return file
  }
}

/**
 * The live crop: a box over the camera, in fractions of the camera's frame on
 * screen, that the shutter keeps and the rest it leaves out — the table, the
 * hand holding the bill. Dragged by its corners to size it and by its middle
 * to move it. The box and whether it is on are remembered on this phone.
 */
const CROP_KEY = 'voucher-crop'
const START_BOX = { l: 0.09, t: 0.12, r: 0.91, b: 0.94 }
const MIN_SIDE = 0.15
function loadCrop() {
  try {
    const kept = JSON.parse(localStorage.getItem(CROP_KEY) ?? 'null')
    if (kept && ['l', 't', 'r', 'b'].every((k) => Number.isFinite(kept.box?.[k]))) return kept
  } catch { /* private window, or nothing kept */ }
  return { on: true, box: START_BOX }
}
function keepCrop(crop) {
  try { localStorage.setItem(CROP_KEY, JSON.stringify(crop)) } catch { /* not kept; still works */ }
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

/**
 * Where the box falls on the camera's own picture. The video fills its frame
 * with `object-fit: cover`, so part of the picture runs off two edges; the box
 * is worked back through that scale and offset into the picture's pixels.
 */
function cropArea(video, box) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const cw = video.clientWidth
  const ch = video.clientHeight
  if (!vw || !vh || !cw || !ch) return undefined
  const scale = Math.max(cw / vw, ch / vh)
  const ox = (cw - vw * scale) / 2
  const oy = (ch - vh * scale) / 2
  const x = clamp((box.l * cw - ox) / scale, 0, vw)
  const y = clamp((box.t * ch - oy) / scale, 0, vh)
  const r = clamp((box.r * cw - ox) / scale, 0, vw)
  const b = clamp((box.b * ch - oy) / scale, 0, vh)
  return r - x > 8 && b - y > 8 ? { x, y, w: r - x, h: b - y } : undefined
}

/** The crop box, with a handle at each corner. */
function CropBox({ box, onChange, onDone }) {
  const drag = useRef(null)
  const start = (part) => (event) => {
    event.preventDefault()
    event.stopPropagation()
    const frame = event.currentTarget.closest('.camera').getBoundingClientRect()
    drag.current = { part, frame, x: event.clientX, y: event.clientY, box }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const move = (event) => {
    const d = drag.current
    if (!d) return
    const dx = (event.clientX - d.x) / d.frame.width
    const dy = (event.clientY - d.y) / d.frame.height
    const was = d.box
    let next
    if (d.part === 'move') {
      const w = was.r - was.l
      const h = was.b - was.t
      const l = clamp(was.l + dx, 0, 1 - w)
      const t = clamp(was.t + dy, 0, 1 - h)
      next = { l, t, r: l + w, b: t + h }
    } else {
      next = { ...was }
      if (d.part.includes('l')) next.l = clamp(was.l + dx, 0, was.r - MIN_SIDE)
      if (d.part.includes('r')) next.r = clamp(was.r + dx, was.l + MIN_SIDE, 1)
      if (d.part.includes('t')) next.t = clamp(was.t + dy, 0, was.b - MIN_SIDE)
      if (d.part.includes('b')) next.b = clamp(was.b + dy, was.t + MIN_SIDE, 1)
    }
    onChange(next)
  }
  const end = () => {
    if (!drag.current) return
    drag.current = null
    onDone()
  }
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }
  return (
    <div
      className="crop-box"
      style={{ left: `${box.l * 100}%`, top: `${box.t * 100}%`, width: `${(box.r - box.l) * 100}%`, height: `${(box.b - box.t) * 100}%` }}
      onPointerDown={start('move')}
      {...handlers}
    >
      {['tl', 'tr', 'bl', 'br'].map((corner) => (
        <span key={corner} className={`crop-handle ${corner}`} onPointerDown={start(corner)} {...handlers} />
      ))}
    </div>
  )
}

const newGroup = () => `voucher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const queueLabel = (number) => String(number).padStart(4, '0')
// Pages of one bill sit together, first page first; the bills stay newest first.
const bundled = (rows) => {
  const bundles = new Map()
  for (const row of rows) {
    if (!bundles.has(row.groupId)) bundles.set(row.groupId, [])
    bundles.get(row.groupId).unshift(row)
  }
  return [...bundles.entries()].map(([groupId, pages]) => ({ groupId, pages }))
}
const ago = (at) => {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`
}

/** A phone camera for voucher paperwork only. Nothing is filed to an account here. */
export default function App() {
  const rows = useQuery(anyApi.voucherInbox.list, {}) ?? []
  const uploadUrl = useMutation(anyApi.files.generateUploadUrl)
  const addPhoto = useMutation(anyApi.voucherInbox.add)
  const discard = useMutation(anyApi.voucherInbox.discard)
  const video = useRef(null)
  const fileInput = useRef(null)
  const group = useRef(newGroup())
  const queue = useRef([])
  const savedJobs = useRef(new Map())
  const running = useRef(0)
  const pumpRef = useRef(null)
  const [cameraAttempt, setCameraAttempt] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [pages, setPages] = useState(0)
  const [outgoing, setOutgoing] = useState([])
  const [crop, setCrop] = useState(loadCrop)
  // Counts shots; each new value replays the white flash over the screen.
  const [shot, setShot] = useState(0)
  // The last shot was Page: the screen stays green while the bill in hand
  // takes its 2nd, 3rd, 4th page, until the shutter starts a new bill.
  const [adding, setAdding] = useState(false)
  const cropRef = useRef(crop)
  cropRef.current = crop
  // The photo whose Discard was tapped once; a second tap throws it away.
  const [discarding, setDiscarding] = useState(null)
  useEffect(() => {
    if (!discarding) return
    const t = setTimeout(() => setDiscarding(null), 4000)
    return () => clearTimeout(t)
  }, [discarding])

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('The live camera needs an HTTPS address. You can still choose photos below.')
      return
    }
    let ended = false
    let stream
    setCameraError('')
    setCameraReady(false)
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2400 }, height: { ideal: 1800 } },
      audio: false,
    }).then(async (opened) => {
      if (ended) return opened.getTracks().forEach((track) => track.stop())
      stream = opened
      // The phone can end the stream with the page still showing (another
      // app took the camera); `stop()` below does not fire this, so it is only that.
      opened.getVideoTracks().forEach((track) => track.addEventListener('ended', wake))
      if (video.current) {
        video.current.srcObject = opened
        await video.current.play()
      }
      setCameraReady(true)
    }).catch((error) => {
      if (!ended) setCameraError(error?.name === 'NotAllowedError'
        ? 'Allow camera access in your browser, then tap Retry camera.'
        : 'The camera could not open. You can choose photos below.')
    })
    /*
     * A phone pauses the live picture whenever something covers the page — a
     * browser dialog, the app switcher, a call — and does not always start it
     * again, which left the camera frozen on its last frame. When the page is
     * back in front: play a paused video, and open the camera afresh if the
     * phone has ended its stream.
     */
    const wake = () => {
      if (ended || document.hidden || !stream) return
      if (stream.getVideoTracks().some((track) => track.readyState === 'ended')) {
        setCameraAttempt((n) => n + 1)
        return
      }
      if (video.current?.paused) video.current.play().catch(() => {})
    }
    const el = video.current
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', wake)
    el?.addEventListener('pause', wake)
    return () => {
      ended = true
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pageshow', wake)
      el?.removeEventListener('pause', wake)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [cameraAttempt])

  const patch = useCallback((id, changes) => {
    setOutgoing((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item))
  }, [])

  const send = useCallback(async (job) => {
    patch(job.id, { status: 'sending' })
    if (!job.storageId) {
      const url = await uploadUrl()
      const result = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': job.file.type || 'image/jpeg' },
        body: job.file,
      })
      if (!result.ok) throw new Error(`Upload failed (${result.status})`)
      job.storageId = (await result.json()).storageId
      if (!job.storageId) throw new Error('The photo upload did not return a file ID.')
    }
    await addPhoto({ storageId: job.storageId, groupId: job.groupId })
    patch(job.id, { status: 'sent' })
    savedJobs.current.delete(job.id)
    URL.revokeObjectURL(job.thumb)
  }, [addPhoto, patch, uploadUrl])

  const pump = useCallback(() => {
    while (running.current < 2 && queue.current.length) {
      const job = queue.current.shift()
      running.current += 1
      send(job).catch((error) => {
        patch(job.id, { status: 'failed', error: error?.message ?? String(error) })
      }).finally(() => {
        running.current -= 1
        pumpRef.current?.()
      })
    }
  }, [patch, send])
  pumpRef.current = pump

  const enqueue = useCallback((file, groupId = group.current) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const thumb = URL.createObjectURL(file)
    const job = { id, file, groupId, thumb }
    savedJobs.current.set(id, job)
    setOutgoing((items) => [{ id, thumb, groupId, status: 'queued' }, ...items])
    queue.current.push(job)
    pumpRef.current?.()
  }, [])

  /**
   * One photo. `fresh` starts a new bill with it as page 1 (the shutter: most
   * bills are one page); otherwise it is the next page of the bill in hand.
   * A flash and a buzz say it was taken; a new bill buzzes once, a page twice,
   * so the two can be told apart without looking.
   */
  const take = useCallback((fresh) => {
    const source = video.current
    if (!source?.videoWidth) return
    if (fresh) group.current = newGroup()
    const groupId = group.current
    setPages((count) => (fresh ? 1 : count + 1))
    setShot((n) => n + 1)
    setAdding(!fresh)
    navigator.vibrate?.(fresh ? 20 : [12, 40, 12])
    const { on, box } = cropRef.current
    const area = on ? cropArea(source, box) : undefined
    compress(source, source.videoWidth, source.videoHeight, area).then((blob) => {
      if (blob) enqueue(asFile(blob), groupId)
      else setCameraError('The photo could not be prepared. Please try again.')
    })
  }, [enqueue])

  const choose = async (files) => {
    const groupId = group.current
    const images = [...files].filter((file) => file.type.startsWith('image/'))
    setPages((count) => count + images.length)
    // One at a time, in the order chosen, so the pages of a bill keep their order.
    for (const file of images) enqueue(await shrink(file), groupId)
  }

  const retry = (id) => {
    const item = outgoing.find((entry) => entry.id === id)
    if (!item || item.status !== 'failed') return
    const stored = savedJobs.current.get(id)
    if (!stored) return
    patch(id, { status: 'queued', error: '' })
    queue.current.push(stored)
    pumpRef.current?.()
  }
  const pending = outgoing.filter((item) => item.status === 'queued' || item.status === 'sending').length
  const failed = outgoing.filter((item) => item.status === 'failed').length

  const waitingTile = (row, page) => (
    <div className="tile" key={row._id}>
      <a href={row.url} target="_blank" rel="noreferrer"><img src={row.url} alt="Bill photo waiting to be attached" /></a>
      {page && <b className="page-no">{page}</b>}
      <span>{row.queueNo == null ? '' : `#${queueLabel(row.queueNo)} · `}{ago(row.at)}</span>
      {/* Asked on the page, not with the browser's confirm box: that
          box paused the live camera and it stayed frozen after. */}
      <button className={discarding === row._id ? 'sure' : ''} onClick={() => {
        if (discarding !== row._id) { setDiscarding(row._id); return }
        setDiscarding(null)
        discard({ id: row._id })
        // A page of the bill in hand, thrown away: it is no longer one of its pages.
        if (row.groupId === group.current) setPages((count) => Math.max(0, count - 1))
      }}>{discarding === row._id ? 'Sure? Discard' : 'Discard'}</button>
    </div>
  )

  return (
    <main className="site">
      <div className="scanner">
        <header className="top">
          <span className="mark" aria-hidden="true">SH</span>
          <div className="top-copy"><h1>Voucher Bill Shooter</h1><small>Shiv Hardware</small></div>
          <span className={`status${failed ? ' error' : pending ? ' busy' : ''}`} role="status" aria-live="polite">{failed ? `${failed} failed` : pending ? `${pending} sending` : 'Ready'}</span>
        </header>

        <section className="camera" aria-label="Voucher bill camera">
          <video ref={video} playsInline muted autoPlay />
          {cameraReady && crop.on && (
            <CropBox
              box={crop.box}
              onChange={(box) => setCrop((c) => ({ ...c, box }))}
              onDone={() => keepCrop(cropRef.current)}
            />
          )}
          {cameraReady && (
            <div className="crop-keys">
              <button
                type="button"
                className={crop.on ? 'on' : ''}
                aria-pressed={crop.on}
                onClick={() => setCrop((c) => { const next = { ...c, on: !c.on }; keepCrop(next); return next })}
              >
                {crop.on ? 'Crop on' : 'Crop off'}
              </button>
              {crop.on && (
                <button
                  type="button"
                  onClick={() => setCrop((c) => { const next = { ...c, box: START_BOX }; keepCrop(next); return next })}
                >
                  Reset
                </button>
              )}
            </div>
          )}
          {cameraError && <div className="camera-message">{cameraError}</div>}
          {!cameraReady && !cameraError && <div className="camera-message">Opening camera…</div>}
        </section>

        <section className="controls">
          <p className="eyebrow" aria-live="polite">Current bill · {pages} {pages === 1 ? 'page' : 'pages'}</p>
          <div className="buttons">
            <button type="button" className="secondary page" aria-label="Add a page to this bill" disabled={!cameraReady} onClick={() => take(false)}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="M9 15h6" /></svg>
              Page
            </button>
            <button type="button" className="shutter" aria-label="Take a new bill" disabled={!cameraReady} onClick={() => take(true)} />
            <button type="button" className="secondary" onClick={() => fileInput.current?.click()}>Choose photo</button>
            <input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={(event) => {
              choose(event.target.files ?? [])
              event.target.value = ''
            }} />
          </div>
          {cameraError && <button type="button" className="retry-camera" onClick={() => setCameraAttempt((n) => n + 1)}>Retry camera</button>}
        </section>
      </div>

      {outgoing.some((item) => item.status !== 'sent') && (
        <section className="uploads" aria-label="Uploads">
          <h2>Sending</h2>
          <div className="tiles">
            {outgoing.filter((item) => item.status !== 'sent').map((item) => (
              <div className="tile" key={item.id}>
                <img src={item.thumb} alt="Bill being uploaded" />
                <span>{item.status === 'failed' ? item.error : item.status}</span>
                {item.status === 'failed' && <button onClick={() => retry(item.id)}>Retry</button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="waiting">
        <h2>Waiting for a voucher <span>{rows.length}</span></h2>
        {rows.length > 0 && <div className="tiles">
          {bundled(rows).map(({ groupId, pages }) => pages.length === 1 ? waitingTile(pages[0]) : (
            <div className="bundle" key={groupId}>
              <h3>Same bill <span>{pages.length} pages</span></h3>
              <div className="tiles">{pages.map((row, index) => waitingTile(row, index + 1))}</div>
            </div>
          ))}
        </div>}
      </section>

      {/* Over the whole screen, letting taps through: green while pages are being added to one bill, a flash at each shot. */}
      <div className={`adding-tint${adding && pages > 0 ? ' on' : ''}`} aria-hidden="true" />
      {shot > 0 && <div key={shot} className="flash" aria-hidden="true" />}
    </main>
  )
}
