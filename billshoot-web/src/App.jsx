import { useCallback, useEffect, useRef, useState } from 'react'
import { canvasOf, cutPage, findIn, sheetOf, shotPage, toBlob, turnRight } from './pipeline.js'
import Fix from './Fix.jsx'
import { sendToGroup } from './send.js'
import { removeBill, saveBill, savedBills } from './outbox.js'

/**
 * Bill Shoot, on one screen: the live camera, the cropped bill under it, the
 * shutter and Send. The shutter takes a page and never stops: its crop appears
 * in the bill box as soon as it is ready, so one page is two taps and three pages
 * are four. The finder is right on about three camera photos in four,
 * so a tap on a page opens its corners; nothing else is ever in the way.
 *
 * Send puts the bill in the shop's WhatsApp group from the Shop number, through
 * Railway (./send.js), several pages as one picture. It is written to this phone
 * first (./outbox.js) and goes from there, so the camera is free at once and no
 * failure loses it: it stays, and is tried again by itself, until it has gone.
 * Nothing leaves the phone until Send or Share from phone is pressed.
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

const RETRY_EVERY = 30_000 // ms between tries while a bill is waiting to go

export default function App() {
  const view = useRef(null)
  const video = useRef(null)
  const pane = useRef(null)
  const box = useBox(view)
  const [camera, setCamera] = useState('opening') // opening | on | off
  const [outline, setOutline] = useState(null)
  const [pages, setPages] = useState([]) // { id, photo (canvas), corners, page (canvas), blob, url, busy, turns }
  const [sheet, setSheet] = useState(null) // { blob, key }
  const [fixing, setFixing] = useState(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [outbox, setOutbox] = useState([]) // bills saved on this phone, still to go
  const [outboxError, setOutboxError] = useState('')
  const [discarding, setDiscarding] = useState(false)
  const flushing = useRef(false)
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

  /* ── the picture to send, made as pages come in, so Send is instant ── */
  useEffect(() => {
    const ready = pages.filter((p) => p.blob)
    if (!ready.length || ready.length !== pages.length) { setSheet(null); return undefined }
    let gone = false
    const key = ready.map((p) => p.id + p.v).join()
    void sheetOf(ready).then((blob) => { if (!gone) setSheet({ blob, key }) })
    return () => { gone = true }
  }, [pages])

  // The newest page in view in the bill box.
  const count = pages.length
  useEffect(() => {
    pane.current?.scrollTo({ left: pane.current.scrollWidth, behavior: 'smooth' })
  }, [count])

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
    setSendError('')
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

  const sheetName = () => {
    const d = new Date()
    return `bill-${d.getDate()}-${d.getMonth() + 1}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.jpg`
  }

  /** The saved bills, oldest first, each sent and only then let go of; stops at the first failure. */
  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    try {
      let bills = await savedBills()
      setOutbox(bills)
      while (bills.length) {
        setOutboxError('')
        await sendToGroup(bills[0].blob, bills[0].name)
        await removeBill(bills[0].id)
        setToast({ text: 'Sent to the group' })
        bills = await savedBills()
        setOutbox(bills)
      }
    } catch (err) {
      setOutboxError(err?.message || 'It did not send.')
    } finally {
      flushing.current = false
    }
  }, [])

  // Waiting bills go when the app opens, when it comes back, when the signal does, and every so often.
  useEffect(() => {
    const go = () => { if (document.visibilityState === 'visible') void flush() }
    go()
    const every = setInterval(go, RETRY_EVERY)
    document.addEventListener('visibilitychange', go)
    addEventListener('online', go)
    return () => {
      clearInterval(every)
      document.removeEventListener('visibilitychange', go)
      removeEventListener('online', go)
    }
  }, [flush])

  /** Safe on this phone first, then on its way; the camera is free for the next bill at once. */
  const send = async () => {
    if (!sheet || sending) return
    setSendError('')
    try {
      await saveBill(sheet.blob, sheetName())
    } catch {
      // This phone would not keep it: send it here and now, with the pages held until it has gone.
      setSending(true)
      try {
        await sendToGroup(sheet.blob, sheetName())
        setPages([])
        setToast({ text: 'Sent to the group' })
      } catch (err) {
        setSendError(err?.message || 'It did not send.')
      } finally {
        setSending(false)
      }
      return
    }
    setPages([])
    setDiscarding(false)
    if (flushing.current) setOutbox(await savedBills())
    else void flush()
  }

  /** A waiting bill sent by the phone's own share instead; it has gone, so it is let go of. */
  const shareSaved = async () => {
    const bill = outbox[0]
    if (!bill) return
    const file = new File([bill.blob], bill.name, { type: 'image/jpeg' })
    if (!navigator.canShare?.({ files: [file] })) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(bill.blob)
      a.download = bill.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    } else {
      try {
        await navigator.share({ files: [file] })
      } catch (err) {
        if (err?.name !== 'AbortError') setToast({ text: 'Could not share — try again' })
        return
      }
    }
    await removeBill(bill.id)
    setOutbox(await savedBills())
  }

  const discardSaved = async () => {
    const bill = outbox[0]
    if (!bill) return
    if (!discarding) { setDiscarding(true); return }
    setDiscarding(false)
    await removeBill(bill.id)
    setOutbox(await savedBills())
  }

  const share = async () => {
    if (!sheet) return
    const name = sheetName()
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
    setSendError('')
    setToast({ text: 'Shared', undo: () => setPages(kept) })
  }

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3000)
    return () => clearTimeout(t)
  }, [toast])

  // The first waiting bill's picture, let go of when it has gone.
  const [waitingUrl, setWaitingUrl] = useState(null)
  const waitingBlob = outbox[0]?.blob
  useEffect(() => {
    if (!waitingBlob) { setWaitingUrl(null); return undefined }
    const url = URL.createObjectURL(waitingBlob)
    setWaitingUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [waitingBlob])

  const rect = shownRect(video.current, box)
  const fixPage = pages.find((p) => p.id === fixing)
  const ready = count > 0 && pages.every((p) => p.blob) && !!sheet

  return (
    <div className="app">
      <div className="viewer" ref={view}>
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
            <button type="button" className={`glass icon${torch ? ' on' : ''}`} aria-label="Light" onClick={() => void switchTorch()}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-12h-7z" /></svg></button>
          )}
        </header>
        {camera === 'off' && (
          <div className="nocam">
            <p>Camera is not allowed</p>
            <button type="button" className="primary" onClick={() => gallery.current?.click()}>Take photos instead</button>
          </div>
        )}
      </div>

      {/* The bill, as it will go. A tap on a page opens its corners. */}
      <div className="pane" ref={pane}>
        {count === 0 && <p className="pane-empty">The cropped bill shows here</p>}
        {pages.map((p, i) => (
          <button type="button" key={p.id} className={`thumb${p.busy ? ' busy' : ''}`} disabled={p.busy || sending} onClick={() => setFixing(p.id)} aria-label={`Page ${i + 1}: adjust`}>
            <img src={p.url} alt="" />
            <span>{i + 1}</span>
            {!p.busy && !p.corners && <em>Whole photo</em>}
          </button>
        ))}
      </div>

      {outbox.length > 0 && (
        <div className={`outbox${outboxError ? ' stuck' : ''}`} role="status">
          {waitingUrl && <img src={waitingUrl} alt="" />}
          <p>
            {outboxError
              ? <><b>{outbox.length} {outbox.length === 1 ? 'bill' : 'bills'} safe on this phone, not sent.</b> Trying again by itself. {outboxError}</>
              : <b>Sending{outbox.length > 1 ? ` ${outbox.length} bills` : ''}…</b>}
          </p>
          {outboxError && (
            <div className="outbox-keys">
              <button type="button" className="glass" onClick={() => void flush()}>Retry</button>
              <button type="button" className="glass" onClick={() => void shareSaved()}>Share</button>
              <button type="button" className={`glass${discarding ? ' danger' : ''}`} onClick={() => void discardSaved()}>{discarding ? 'Sure?' : 'Delete'}</button>
            </div>
          )}
        </div>
      )}

      {sendError && (
        <div className="send-error" role="alert">
          <p>Not sent: {sendError}</p>
          <button type="button" className="glass" onClick={share}>Share from phone</button>
        </div>
      )}

      <footer className="bar">
        <button type="button" className="glass side" onClick={() => gallery.current?.click()} aria-label="Add from photos"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></button>
        <button type="button" className="shutter" onClick={shoot} disabled={camera !== 'on' || sending} aria-label="Shoot a page" />
        <button type="button" className="primary side share" disabled={!ready || sending} onClick={send}>
          {sending || (count > 0 && !ready) ? '…' : sendError ? 'Retry' : count > 1 ? `Send ${count}` : 'Send'}
        </button>
      </footer>

      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { void fromGallery([...e.target.files]); e.target.value = '' }} />

      {fixPage && (
        <Fix
          page={fixPage}
          index={pages.indexOf(fixPage)}
          count={count}
          onClose={() => setFixing(null)}
          onDelete={() => {
            setPages((ps) => ps.filter((p) => p.id !== fixPage.id))
            setFixing(null)
          }}
          onMove={(by) => setPages((ps) => {
            const i = ps.indexOf(fixPage), j = i + by
            if (j < 0 || j >= ps.length) return ps
            const next = [...ps]; [next[i], next[j]] = [next[j], next[i]]; return next
          })}
          onTurn={async () => {
            const page = turnRight(fixPage.page)
            const blob = await toBlob(page)
            const turns = ((fixPage.turns ?? 0) + 1) % 4
            setPages((ps) => ps.map((p) => (p.id === fixPage.id ? { ...p, v: p.v + 1, turns, page, blob, url: URL.createObjectURL(blob) } : p)))
          }}
          onRecut={async (corners) => {
            // A new crop starts from the photo, so a turn already given is given again.
            let page = await cutPage(fixPage.photo, corners)
            for (let t = 0; t < (fixPage.turns ?? 0); t += 1) page = turnRight(page)
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
