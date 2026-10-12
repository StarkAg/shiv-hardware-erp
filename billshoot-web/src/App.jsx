import { useCallback, useEffect, useRef, useState } from 'react'
import { canvasOf, cutPage, findIn, sheetOf, shotPage, toBlob, turnRight } from './pipeline.js'
import Fix from './Fix.jsx'

/**
 * Bill Shoot: the camera, open at once. Each tap takes one page of the bill;
 * the page is found, cut out and straightened by itself. Share sends all the
 * pages as one picture, one under another, to whichever chat is picked —
 * the shop's WhatsApp group sits at the top of the list after the first time.
 *
 * Nothing leaves the phone except through that share.
 */

const LIVE_EVERY = 300 // ms between looks for the page in the live picture

let camStream = null
async function openCamera() {
  if (camStream && camStream.getVideoTracks().some((t) => t.readyState === 'live')) return camStream
  for (let tries = 0; ; tries += 1) {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        // As sharp as the phone gives: a bill's small handwriting must survive.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      })
      return camStream
    } catch (err) {
      // A camera just let go of can refuse for a moment; a refused permission is final.
      if (err?.name === 'NotAllowedError' || tries >= 3) throw err
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}
function letGoOfCamera() {
  camStream?.getTracks().forEach((t) => t.stop())
  camStream = null
}

/** Where the video's picture sits inside its box (object-fit: contain). */
function shownRect(video, box) {
  const vw = video?.videoWidth || 3, vh = video?.videoHeight || 4
  const s = Math.min(box.w / vw, box.h / vh)
  return { x: (box.w - vw * s) / 2, y: (box.h - vh * s) / 2, w: vw * s, h: vh * s }
}

function useBox(ref) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return box
}

const newId = () => Math.random().toString(36).slice(2, 9)

export default function App() {
  const view = useRef(null)
  const video = useRef(null)
  const box = useBox(view)
  const [camera, setCamera] = useState('opening') // opening | on | off
  const [outline, setOutline] = useState(null)
  const [pages, setPages] = useState([]) // { id, photo (canvas), corners, page (canvas), blob, url, busy }
  const [sheet, setSheet] = useState(null) // { blob, key }
  const [fixing, setFixing] = useState(null)
  const [flash, setFlash] = useState(false)
  const [torch, setTorch] = useState(null) // null: none on this phone
  const [toast, setToast] = useState(null)
  const shooting = useRef(false)
  const gallery = useRef(null)

  /* ── the camera ── */
  useEffect(() => {
    let stopped = false
    const attach = async () => {
      try {
        const stream = await openCamera()
        if (stopped || !video.current) return
        if (video.current.srcObject !== stream) video.current.srcObject = stream
        const track = stream.getVideoTracks()[0]
        track.onended = () => { if (!stopped) void attach() }
        // Keep it sharp on paper held close.
        track.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] }).catch(() => undefined)
        setTorch(track.getCapabilities?.().torch ? false : null)
        await video.current.play().catch(() => undefined)
        setCamera('on')
      } catch (err) {
        console.warn('[billshoot] camera', err?.name)
        if (!stopped) setCamera('off')
      }
    }
    void attach()
    // A phone's camera should not stay on in a pocket.
    const onVis = () => {
      if (document.visibilityState === 'hidden') { letGoOfCamera(); setCamera('opening') } else void attach()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { stopped = true; document.removeEventListener('visibilitychange', onVis) }
  }, [])

  /* ── the page, outlined live ── */
  useEffect(() => {
    if (camera !== 'on' || fixing) return undefined
    let stop = false
    const look = async () => {
      const v = video.current
      if (!stop && v?.videoWidth && !shooting.current) {
        try { setOutline((await findIn(v, v.videoWidth, v.videoHeight)).corners) } catch { /* next look */ }
      }
      if (!stop) setTimeout(look, LIVE_EVERY)
    }
    void look()
    return () => { stop = true }
  }, [camera, fixing])

  /* ── the shared picture, made as pages come in, so Share is instant ── */
  useEffect(() => {
    const ready = pages.filter((p) => p.blob)
    if (!ready.length || ready.length !== pages.length) { setSheet(null); return undefined }
    let gone = false
    const key = ready.map((p) => p.id + p.v).join()
    void sheetOf(ready).then((blob) => { if (!gone) setSheet({ blob, key }) })
    return () => { gone = true }
  }, [pages])

  const addPhoto = useCallback(async (photo) => {
    const id = newId()
    setPages((ps) => [...ps, { id, v: 0, busy: true, url: photo.toDataURL('image/jpeg', 0.5) }])
    try {
      const { corners, page } = await shotPage(photo)
      const blob = await toBlob(page)
      setPages((ps) => ps.map((p) => (p.id === id ? { id, v: 1, photo, corners, page, blob, url: URL.createObjectURL(blob) } : p)))
    } catch (err) {
      console.warn('[billshoot] page', err)
      setPages((ps) => ps.filter((p) => p.id !== id))
      setToast({ text: 'That page did not work — take it again' })
    }
  }, [])

  const shoot = () => {
    const v = video.current
    if (!v?.videoWidth || shooting.current) return
    shooting.current = true
    const photo = canvasOf(v.videoWidth, v.videoHeight)
    photo.getContext('2d').drawImage(v, 0, 0)
    shooting.current = false
    setFlash(true)
    setTimeout(() => setFlash(false), 140)
    navigator.vibrate?.(15)
    void addPhoto(photo)
  }

  const fromGallery = async (files) => {
    for (const file of files) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
        const s = Math.min(1, 4000 / Math.max(bmp.width, bmp.height))
        const photo = canvasOf(Math.round(bmp.width * s), Math.round(bmp.height * s))
        photo.getContext('2d').drawImage(bmp, 0, 0, photo.width, photo.height)
        bmp.close?.()
        await addPhoto(photo)
      } catch { setToast({ text: `${file.name} could not be opened` }) }
    }
  }

  const switchTorch = async () => {
    const track = camStream?.getVideoTracks()[0]
    if (!track || torch === null) return
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch) } catch { setTorch(null) }
  }

  const share = async () => {
    if (!sheet) return
    const d = new Date()
    const name = `bill-${d.getDate()}-${d.getMonth() + 1}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.jpg`
    const file = new File([sheet.blob], name, { type: 'image/jpeg' })
    const kept = pages
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
      } catch (err) {
        if (err?.name === 'AbortError') return // closed without sending: keep the pages
        setToast({ text: 'Could not share — try again' })
        return
      }
    } else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(sheet.blob)
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    }
    // Sent: ready for the next bill, with a moment to bring these back.
    setPages([])
    setToast({ text: 'Shared', undo: () => setPages(kept) })
  }

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3000)
    return () => clearTimeout(t)
  }, [toast])

  const rect = shownRect(video.current, box)
  const fixPage = pages.find((p) => p.id === fixing)
  const ready = pages.length > 0 && pages.every((p) => p.blob)

  return (
    <div className="app">
      <div className="viewer" ref={view} onClick={camera === 'on' ? shoot : undefined}>
        <video ref={video} playsInline muted />
        {outline && camera === 'on' && box.w > 0 && (
          <svg className="outline" width={box.w} height={box.h}>
            <polygon points={outline.map((p) => `${rect.x + p.x * rect.w},${rect.y + p.y * rect.h}`).join(' ')} />
          </svg>
        )}
        {flash && <div className="flash" />}
        <header className="top">
          <img className="logo" src="/icon.svg" alt="" />
          <span className="title">Bill Shoot</span>
          {torch !== null && (
            <button type="button" className={`glass icon${torch ? ' on' : ''}`} aria-label="Light" onClick={(e) => { e.stopPropagation(); void switchTorch() }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-12h-7z" /></svg></button>
          )}
        </header>
        {camera === 'off' && (
          <div className="nocam" onClick={(e) => e.stopPropagation()}>
            <p>Camera is not allowed</p>
            <button type="button" className="primary" onClick={() => gallery.current?.click()}>Take photos instead</button>
          </div>
        )}
        {camera === 'on' && pages.length === 0 && !toast && <div className="hint">Tap anywhere to shoot each page</div>}
      </div>

      {pages.length > 0 && (
        <div className="strip">
          {pages.map((p, i) => (
            <button type="button" key={p.id} className={`thumb${p.busy ? ' busy' : ''}`} disabled={p.busy} onClick={() => setFixing(p.id)} aria-label={`Page ${i + 1}: fix`}>
              <img src={p.url} alt="" />
              <span>{i + 1}</span>
            </button>
          ))}
        </div>
      )}

      <footer className="bar">
        <button type="button" className="glass side" onClick={() => gallery.current?.click()} aria-label="Add from photos"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></button>
        <button type="button" className="shutter" onClick={shoot} disabled={camera !== 'on'} aria-label="Shoot a page" />
        <button type="button" className="primary side share" disabled={!ready || !sheet} onClick={share}>
          {pages.length ? (ready && sheet ? `Share ${pages.length}` : '…') : 'Share'}
        </button>
      </footer>

      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { void fromGallery([...e.target.files]); e.target.value = '' }} />

      {fixPage && (
        <Fix
          page={fixPage}
          index={pages.indexOf(fixPage)}
          count={pages.length}
          onClose={() => setFixing(null)}
          onDelete={() => { setPages((ps) => ps.filter((p) => p.id !== fixPage.id)); setFixing(null) }}
          onMove={(by) => setPages((ps) => {
            const i = ps.indexOf(fixPage), j = i + by
            if (j < 0 || j >= ps.length) return ps
            const next = [...ps]; [next[i], next[j]] = [next[j], next[i]]; return next
          })}
          onTurn={async () => {
            const page = turnRight(fixPage.page)
            const blob = await toBlob(page)
            setPages((ps) => ps.map((p) => (p.id === fixPage.id ? { ...p, v: p.v + 1, page, blob, url: URL.createObjectURL(blob) } : p)))
          }}
          onRecut={async (corners) => {
            const page = await cutPage(fixPage.photo, corners)
            const blob = await toBlob(page)
            setPages((ps) => ps.map((p) => (p.id === fixPage.id ? { ...p, v: p.v + 1, corners, page, blob, url: URL.createObjectURL(blob) } : p)))
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast.text}
          {toast.undo && <button type="button" onClick={() => { toast.undo(); setToast(null) }}>Undo</button>}
        </div>
      )}
    </div>
  )
}
