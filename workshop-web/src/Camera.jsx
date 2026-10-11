import { useEffect, useRef, useState } from 'react'

/**
 * The camera, live, inside the app.
 *
 * The phone's own camera (a file input with `capture`) leaves the app for
 * every single photograph: out to the camera, shoot, confirm, back. This
 * holds the camera open on the screen instead, so a photograph is one press
 * of the shutter and three pages are three presses. What is shot waits in a
 * row at the foot until "Use" hands it on; nothing is sent from here.
 *
 * Where a live camera cannot be had (permission refused, a browser without
 * one) it says so and offers the phone's own camera through `onFallback`,
 * which the caller wires to its file input. `onGallery`, when given, adds a
 * button for a picture already on the phone.
 *
 * The phone's Back closes it, like every other thing the app opens over itself.
 */
const MAX_EDGE = 1600
const QUALITY = 0.86

export default function Camera({ title, onUse, onClose, onFallback, onGallery }) {
  const video = useRef(null)
  const stream = useRef(null)
  const stage = useRef(null)
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState('')
  const [torch, setTorch] = useState(null)   // null: this camera has no lamp
  const [shots, setShots] = useState([])     // { file, url }
  const closing = useRef(onClose)
  closing.current = onClose

  // Back closes the camera: it sits on a history entry of its own, which
  // keeps whatever the entry under it said (the open job).
  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), cam: true }, '')
    const onPop = (e) => { if (!e.state?.cam) closing.current() }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const leave = () => window.history.back()

  useEffect(() => {
    let stopped = false
    void (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setProblem('This browser will not open a live camera here.')
        return
      }
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2400 }, height: { ideal: 1800 } },
          audio: false,
        })
        if (stopped) { media.getTracks().forEach((t) => t.stop()); return }
        stream.current = media
        if (video.current) {
          video.current.srcObject = media
          await video.current.play().catch(() => {})
        }
        setTorch(media.getVideoTracks()[0]?.getCapabilities?.().torch ? false : null)
        setReady(true)
      } catch (err) {
        setProblem(err?.name === 'NotAllowedError'
          ? 'The camera was not allowed. Allow it for this app in the phone\'s settings, or use the phone\'s own camera below.'
          : 'No camera could be opened here.')
      }
    })()
    return () => {
      stopped = true
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
    }
  }, [])

  // The previews are let go when the camera closes; the files themselves go on.
  const made = useRef([])
  useEffect(() => () => { for (const url of made.current) URL.revokeObjectURL(url) }, [])

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] })
      setTorch(!torch)
    } catch {
      setTorch(null)   // the lamp said no; stop offering it
    }
  }

  /** One frame of what is on screen, as a JPEG small enough to send without a wait. */
  const shoot = () => {
    const el = video.current
    if (!el?.videoWidth) return
    // A blink, so a press is seen to have landed.
    stage.current?.classList.remove('snap')
    void stage.current?.offsetWidth
    stage.current?.classList.add('snap')
    navigator.vibrate?.(10)

    const scale = Math.min(1, MAX_EDGE / Math.max(el.videoWidth, el.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(el.videoWidth * scale)
    canvas.height = Math.round(el.videoHeight * scale)
    canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height)
    const at = Date.now()
    canvas.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `photo-${at}.jpg`, { type: 'image/jpeg', lastModified: at })
      const url = URL.createObjectURL(file)
      made.current.push(url)
      setShots((cur) => [...cur, { file, url }].slice(0, 10))
    }, 'image/jpeg', QUALITY)
  }

  const use = () => {
    const files = shots.map((s) => s.file)
    leave()
    if (files.length) onUse(files)
  }
  /** Out to the phone's own camera or gallery: this one closes first. */
  const instead = (go) => { leave(); go() }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label={title || 'Camera'}>
      <div className="cambar">
        <button type="button" onClick={leave} aria-label="Close the camera">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <b>{title}</b>
        {torch !== null ? (
          <button type="button" className={torch ? 'on' : ''} onClick={toggleTorch} aria-label="Torch" aria-pressed={torch}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>
          </button>
        ) : <span className="gap" />}
      </div>

      <div className="camstage" ref={stage}>
        <video ref={video} playsInline muted autoPlay />
        {!ready && !problem && <p className="camnote">Starting the camera</p>}
        {problem && (
          <div className="camnote">
            <p>{problem}</p>
            {onFallback && <button type="button" onClick={() => instead(onFallback)}>Use the phone's camera</button>}
          </div>
        )}
      </div>

      {shots.length > 0 && (
        <div className="camshots">
          {shots.map((s) => (
            <span key={s.url}>
              <img src={s.url} alt="" />
              <button type="button" onClick={() => setShots((cur) => cur.filter((x) => x.url !== s.url))} aria-label="Remove this photo">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="camfoot">
        <span className="slot">
          {onGallery && <button type="button" className="aside" onClick={() => instead(onGallery)}>From phone</button>}
        </span>
        <button type="button" className="shutter" onClick={shoot} disabled={!ready} aria-label="Take the photo"><i /></button>
        <span className="slot">
          <button type="button" className="use" onClick={use} disabled={!shots.length}>Use{shots.length ? ` ${shots.length}` : ''}</button>
        </span>
      </div>
    </div>
  )
}
