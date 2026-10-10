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

async function compress(drawable, width, height) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext('2d').drawImage(drawable, 0, 0, canvas.width, canvas.height)
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

const newGroup = () => `voucher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const queueLabel = (number) => String(number).padStart(4, '0')
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
    return () => {
      ended = true
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

  const take = useCallback(() => {
    const source = video.current
    if (!source?.videoWidth) return
    const groupId = group.current
    setPages((count) => count + 1)
    compress(source, source.videoWidth, source.videoHeight).then((blob) => {
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

  return (
    <main className="site">
      <div className="scanner">
        <header className="top">
          <span className="mark" aria-hidden="true">SH</span>
          <div className="top-copy"><h1>Voucher Bill Shooter</h1><small>Shiv Hardware</small></div>
          <span className={`status${failed ? ' error' : ''}`} role="status" aria-live="polite">{failed ? `${failed} failed` : pending ? `${pending} sending` : 'Ready'}</span>
        </header>

        <section className="camera" aria-label="Voucher bill camera">
          <video ref={video} playsInline muted autoPlay />
          {cameraReady && <span className="camera-corners" aria-hidden="true" />}
          {cameraError && <div className="camera-message">{cameraError}</div>}
          {!cameraReady && !cameraError && <div className="camera-message">Opening camera…</div>}
        </section>

        <section className="controls">
          <p className="eyebrow" aria-live="polite">Current bill · {pages} {pages === 1 ? 'page' : 'pages'}</p>
          <div className="buttons">
            <button type="button" className="secondary" onClick={() => { group.current = newGroup(); setPages(0) }}>
              New bill
            </button>
            <button type="button" className="shutter" aria-label="Take bill photo" disabled={!cameraReady} onClick={take} />
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
          {rows.map((row) => <div className="tile" key={row._id}>
            <a href={row.url} target="_blank" rel="noreferrer"><img src={row.url} alt="Bill photo waiting to be attached" /></a>
            <span>{row.queueNo == null ? '' : `#${queueLabel(row.queueNo)} · `}{ago(row.at)}</span>
            <button onClick={() => {
              if (window.confirm('Discard this bill photo?')) discard({ id: row._id })
            }}>Discard</button>
          </div>)}
        </div>}
      </section>
    </main>
  )
}
