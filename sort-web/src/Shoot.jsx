/**
 * The walk before the other two: getting the paper onto a screen.
 *
 * One shutter, one press, one bill. Two people photograph a backlog far faster
 * than one, each building their own pile of shot slips — and which pile a slip
 * went onto cannot be worked out from the picture afterwards, because it is
 * decided by whose hand is holding the phone. So the letter is asked once, on
 * this device, before the first shutter, and stamped on every photograph after.
 *
 * Nothing here waits on anything. The frame is grabbed on the button's own
 * turn, the count moves on that same turn, and the upload happens behind all of
 * it — the answer to a press is never owed to the network.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/** WebP at 0.8, the same picture at under half a JPEG's weight; JPEG where the browser cannot write WebP. */
const smallBlob = async (canvas, jpegQuality) => {
  const webp = await new Promise((done) => canvas.toBlob(done, 'image/webp', 0.8))
  if (webp?.type === 'image/webp') return webp
  return new Promise((done) => canvas.toBlob(done, 'image/jpeg', jpegQuality))
}

const KEY = 'shiv-sort:stack'
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const MAX_EDGE = 1800
const QUALITY = 0.82
const LANES = 3

const held = () => {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export default function Shoot({ onWorking }) {
  const [stack, setStack] = useState(held)
  const [asking, setAsking] = useState(() => !held())
  const [ready, setReady] = useState(false)
  const [trouble, setTrouble] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(0)

  const video = useRef(null)
  const stream = useRef(null)
  const frame = useRef(null)
  const counter = useRef(null)
  const state = useRef(null)
  const shot = useRef(0)
  const flying = useRef(0)

  const uploadUrl = useMutation(anyApi.files.generateUploadUrl)
  const addToInbox = useMutation(anyApi.inbox.add)
  const waiting = useQuery(anyApi.filing.waiting, {})

  /* ---------------- the camera ---------------- */
  useEffect(() => {
    if (asking) return
    setReady(false)
    setTrouble('')
    let stop = false
    ;(async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setTrouble('A camera needs a secure connection — open the https address.')
        return
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2400 }, height: { ideal: 1800 } },
          audio: false,
        })
        if (stop) return media.getTracks().forEach((t) => t.stop())
        stream.current = media
        if (video.current) {
          video.current.srcObject = media
          await video.current.play().catch(() => {})
        }
        setReady(true)
      } catch (err) {
        setTrouble(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was refused — allow it in the browser settings, then tap Try camera again.'
            : 'No camera could be opened here.',
        )
      }
    })()
    return () => {
      stop = true
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [asking, attempt])

  useEffect(() => {
    onWorking(pending > 0)
  }, [pending, onWorking])
  useEffect(() => {
    const warn = (event) => { if (flying.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  /* ---------------- the wire ---------------- */
  const say = useCallback(() => {
    if (state.current) {
      state.current.textContent = flying.current ? `${flying.current} sending` : 'all sent'
    }
  }, [])

  const send = useCallback(
    async (file) => {
      try {
        const url = await uploadUrl()
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        })
        if (!res.ok) throw new Error(`Upload failed (${res.status})`)
        const { storageId } = await res.json()
        await addToInbox({ storageId, ...(stack ? { stack } : {}) })
      } catch {
        // Said rather than swallowed: a slip that never arrived is a bill the
        // shop will never see again, and the paper is still in your hand.
        setTrouble('A photograph did not send. Check the connection and shoot it again.')
      } finally {
        flying.current -= 1
        setPending(flying.current)
        say()
      }
    },
    [uploadUrl, addToInbox, stack, say],
  )

  /**
   * Freeze the frame now, encode it later.
   *
   * The only work done on the button's own turn is a drawImage into a canvas
   * that already exists. Encoding is handed to the next frame, so pressing
   * again immediately is never blocked by the shot before it.
   */
  const press = useCallback(() => {
    const el = video.current
    if (!el?.videoWidth || flying.current >= LANES) return
    flying.current += 1
    setPending(flying.current)
    say()

    const stage = frame.current
    if (stage) {
      stage.classList.remove('snap')
      void stage.offsetWidth
      stage.classList.add('snap')
    }

    shot.current += 1
    if (counter.current) counter.current.textContent = String(shot.current)
    try {
      navigator.vibrate?.(15)
    } catch {
      /* a phone with no motor still has the flash and the count */
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(el.videoWidth, el.videoHeight))
    const w = Math.round(el.videoWidth * scale)
    const h = Math.round(el.videoHeight * scale)

    // A separate canvas freezes this exact press, even during a rapid burst.
    const out = Object.assign(document.createElement('canvas'), { width: w, height: h })
    out.getContext('2d').drawImage(el, 0, 0, w, h)
    void smallBlob(out, QUALITY).then((blob) => {
      if (!blob) {
        flying.current -= 1
        setPending(flying.current)
        say()
        setTrouble('The photo could not be captured. Please shoot this bill again.')
        return
      }
      const at = Date.now()
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
      void send(new File([blob], `bill-${at}.${ext}`, { type: blob.type, lastModified: at }))
    })
  }, [send, say])

  const choose = (letter) => {
    try {
      if (letter) localStorage.setItem(KEY, letter)
      else localStorage.removeItem(KEY)
    } catch {
      /* a remembered letter is a convenience, not a requirement */
    }
    setStack(letter)
    setAsking(false)
  }

  const mine = (waiting ?? []).find((w) => (w.stack || '') === stack)

  if (asking) {
    return (
      <div className="pick">
        <h2>Which stack?</h2>
        <p>
          Put a card with this letter on the pile you photograph onto. Everything this phone
          shoots joins that stack.
        </p>
        <div className="pick-grid">
          {LETTERS.map((letter) => (
            <button key={letter} className="pick-letter" onClick={() => choose(letter)}>
              {letter}
            </button>
          ))}
        </div>
        <button className="pick-alone" onClick={() => choose('')}>
          Only one person is photographing
        </button>
      </div>
    )
  }

  return (
    <div className="shoot">
      <button className="shoot-stack" disabled={pending > 0} onClick={() => setAsking(true)}>
        {stack ? `Stack ${stack}` : 'No stack'}
        {mine ? ` · ${mine.bills} to name` : ''}
      </button>

      {trouble && (
        <div className="shoot-trouble">
          <p>{trouble}</p>
          <button className="btn" onClick={() => { setTrouble(''); if (!ready) setAttempt(n => n + 1) }}>{ready ? 'Shoot it again' : 'Try camera again'}</button>
        </div>
      )}

      <div className="shoot-stage" ref={frame}>
        <video ref={video} playsInline muted autoPlay />
      </div>

      <div className="shoot-bar">
        <span className="shoot-count" ref={counter}>0</span>
        <button
          className="shoot-btn"
          aria-label="Photograph this bill"
          disabled={!ready || pending >= LANES}
          onClick={() => ready && press()}
        />
        <span className="shoot-status" role="status" ref={state}>{pending ? `${pending} sending` : ready ? 'ready' : 'starting…'}</span>
      </div>
    </div>
  )
}
