import { useEffect, useRef, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { detectMode } from './colour'
import { notificationsState, pushAddress, showLocal, turnOnNotifications } from './notify'
import { putForWorker } from './workerStore'
import { deviceToken } from './deviceTrust/deviceTrust'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'

const remembered = (key, fallback) => { try { return localStorage.getItem(`shiv-print:${key}`) ?? fallback } catch { return fallback } }
const remember = (key, value) => { try { localStorage.setItem(`shiv-print:${key}`, value) } catch { /* private window */ } }

/**
 * Shiv Print: any paper, from anywhere, printed at the shop.
 *
 * Share a photo or a PDF from any app to "Shiv Print", pick black and white or
 * colour, press Print. The files go to the shop's online print queue
 * (convex/printJobs.ts sendFiles) and the print server on the shop PC prints
 * them: black and white on the HP, colour on the Epson.
 */

const PRINTABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
const SHARED = 'shiv-print-shared'

/** Files shared from another app, left by the worker (public/sw.js). */
async function takeShared() {
  if (!('caches' in window)) return []
  const cache = await caches.open(SHARED)
  const files = []
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    if (!response) continue
    const blob = await response.blob()
    const name = decodeURIComponent(response.headers.get('X-File-Name') || 'file')
    files.push(new File([blob], name, { type: blob.type || response.headers.get('Content-Type') || '' }))
    await cache.delete(request)
  }
  return files
}

const isImage = (f) => f.type.startsWith('image/')

// A4 at about 250 dots per inch along its long side: sharper than the printers
// show, a tenth of a camera photo's size.
const PRINT_LONG_SIDE = 3000

/**
 * A photo as big as a printed page needs and no bigger, as a JPEG. A photo
 * already that small, a PDF or a GIF goes as it is; so does anything the
 * browser cannot redraw — better a slow upload than none.
 */
async function forPrint(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_200_000) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, PRINT_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff' // a transparent PNG prints on white paper
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.88))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}
let nextId = 0

export default function App() {
  const convex = useConvex()
  const sendFiles = useMutation(anyApi.printJobs.sendFiles)
  const [items, setItems] = useState([])
  const [mode, setMode] = useState('bw')
  const [modeChosen, setModeChosen] = useState(false)
  const [copies, setCopies] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState([])
  const [detecting, setDetecting] = useState(false)
  // Shared files print the moment they arrive, unless switched off here.
  const [autoPrint, setAutoPrint] = useState(() => remembered('auto', '1') === '1')
  const [notifications, setNotifications] = useState(notificationsState)
  const [justSent, setJustSent] = useState(null)
  const picker = useRef(null)

  // The background worker sends shared files by itself, without this screen;
  // it is handed what it needs each time the app is opened (src/workerStore.js).
  useEffect(() => {
    void putForWorker({ token: deviceToken(), convexUrl: CONVEX_URL, auto: autoPrint })
  }, [autoPrint])

  const add = (files) => {
    const ok = files.filter((f) => PRINTABLE.includes(f.type))
    if (ok.length < files.length) setError('Only PDFs and photos print.')
    setItems((cur) => [...cur, ...ok.map((file) => ({
      id: ++nextId, file, preview: isImage(file) ? URL.createObjectURL(file) : null,
    }))])
    return ok
  }

  /**
   * Sends files to the shop's print queue; returns the job's id. Photos are
   * brought down to print size first and all go up together: a phone photo is
   * 4–12 MB, and its upload over mobile data was most of the wait.
   */
  const send = async (list, chosenMode, chosenCopies) => {
    const [files, notify] = await Promise.all([
      Promise.all(list.map(async (original) => {
        const file = await forPrint(original)
        const url = await convex.mutation(anyApi.files.generateUploadUrl, {})
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
        if (!res.ok) throw new Error(`${original.name} did not upload.`)
        const { storageId } = await res.json()
        return { storageId, name: file.name, mediaType: file.type }
      })),
      pushAddress(),
    ])
    const id = await sendFiles({ files, mode: chosenMode, copies: chosenCopies, ...(notify ? { notify } : {}) })
    const label = list.length === 1 ? list[0].name : `${list.length} files`
    setSent((cur) => [{ id, label, mode: chosenMode, copies: chosenCopies }, ...cur].slice(0, 8))
    return { id, label }
  }

  const failed = (err) => {
    const data = err?.data
    setError(typeof data === 'string' ? data : data?.message || (err instanceof Error ? err.message : String(err)))
  }

  // Shared in from another app: straight to the printer, colour decided from
  // what is on it, then out of the way — the phone says when it has printed.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('shared')) return
    history.replaceState(null, '', '/')
    void takeShared().then(async (shared) => {
      const files = add(shared)
      if (!files.length || remembered('auto', '1') !== '1') return
      setBusy(true)
      try {
        const chosen = await detectMode(files)
        const { label } = await send(files, chosen, 1)
        setItems([])
        const how = chosen === 'color' ? 'Colour' : 'Black & white'
        setJustSent({ label, how })
        void showLocal('Sent to the shop', `${label} — ${how.toLowerCase()}`, 'sent')
        // Back to wherever the share came from. A window the phone will not
        // let close shows the "Sent" screen instead.
        setTimeout(() => window.close(), 800)
      } catch (err) {
        failed(err)
      } finally {
        setBusy(false)
      }
    })
  }, [])

  // Colour or black and white, from what is on the files — until chosen by hand.
  useEffect(() => {
    if (modeChosen || !items.length) return
    let current = true
    setDetecting(true)
    void detectMode(items.map((i) => i.file)).then((chosen) => { if (current) setMode(chosen) }).finally(() => { if (current) setDetecting(false) })
    return () => { current = false }
  }, [items, modeChosen])

  const remove = (id) => setItems((cur) => cur.filter((i) => i.id !== id))

  const print = async () => {
    if (!items.length || busy) return
    setBusy(true)
    setError('')
    try {
      await send(items.map((i) => i.file), mode, copies)
      items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview))
      setItems([])
      setCopies(1)
      setModeChosen(false)
    } catch (err) {
      failed(err)
    } finally {
      setBusy(false)
    }
  }

  if (justSent) {
    return (
      <main className="page sent-screen">
        <div className="sent-mark"><CheckIcon /></div>
        <h1>Sent to the shop</h1>
        <p>{justSent.label} · {justSent.how}</p>
        <p className="muted">{notifications === 'granted' ? 'Your phone will say when it has printed.' : 'Turn on notifications to hear when it has printed.'}</p>
        <button className="print" onClick={() => setJustSent(null)}>Done</button>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="top">
        <PrinterIcon />
        <h1>Shiv Print</h1>
      </header>

      <section className="files">
        {items.map((i) => (
          <div key={i.id} className="file">
            {i.preview ? <img src={i.preview} alt="" /> : <div className="pdf"><DocIcon /><span>PDF</span></div>}
            <div className="name">{i.file.name}</div>
            <button className="x" aria-label={`Remove ${i.file.name}`} onClick={() => remove(i.id)}><XIcon /></button>
          </div>
        ))}
        <button className="add" onClick={() => picker.current?.click()}>
          <PlusIcon /><span>{items.length ? 'Add more' : 'Choose files'}</span>
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = '' }}
        />
      </section>

      <section className="controls">
        <div className="seg" role="radiogroup" aria-label="Colour">
          {[['bw', 'Black & White'], ['color', 'Colour']].map(([value, label]) => (
            <button
              key={value}
              role="radio"
              aria-checked={mode === value}
              className={mode === value ? 'on' : ''}
              onClick={() => { setMode(value); setModeChosen(true) }}
            >{label}</button>
          ))}
        </div>
        <div className="copies">
          <button aria-label="Fewer copies" onClick={() => setCopies((n) => Math.max(1, n - 1))}><MinusIcon /></button>
          <span>{copies} {copies === 1 ? 'copy' : 'copies'}</span>
          <button aria-label="More copies" onClick={() => setCopies((n) => Math.min(20, n + 1))}><PlusIcon /></button>
        </div>
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      <button className="print" disabled={!items.length || busy} onClick={print}>
        {busy ? 'Sending' : 'Print'}
      </button>
      {detecting && <p className="muted center">Checking for colour…</p>}

      <section className="settings">
        <label className="setting">
          <span>Print as soon as shared</span>
          <input
            type="checkbox"
            checked={autoPrint}
            onChange={(e) => { setAutoPrint(e.target.checked); remember('auto', e.target.checked ? '1' : '0') }}
          />
        </label>
        {notifications === 'install-first' && (
          <p className="muted center">On iPhone: tap Share → Add to Home Screen, open Shiv Print from there, then turn on notifications.</p>
        )}
        {notifications !== 'granted' && notifications !== 'unsupported' && notifications !== 'install-first' && (
          <button
            className="setting-button"
            disabled={notifications === 'denied'}
            onClick={async () => { await turnOnNotifications(); setNotifications(notificationsState()) }}
          >
            {notifications === 'denied' ? 'Notifications are blocked in phone settings' : 'Notify me when it has printed'}
          </button>
        )}
      </section>

      {sent.length > 0 && (
        <section className="sent">
          {sent.map((job) => <SentJob key={job.id} job={job} />)}
        </section>
      )}
    </main>
  )
}

/** One sent job, followed live until it prints or fails. */
function SentJob({ job }) {
  const live = useQuery(anyApi.printJobs.getById, { id: job.id })
  const status = live?.status
  const [text, tone] =
    status === 'printed' ? ['Printed', 'ok']
    : status === 'failed' ? [`Not printed: ${live.error || 'the printer refused it'}`, 'bad']
    : status === 'claimed' || status === 'printing' ? ['Printing', 'busy']
    : ['Waiting for the shop PC', 'wait']
  return (
    <div className={`job ${tone}`}>
      <div className="label">{job.label}</div>
      <div className="meta">{job.mode === 'color' ? 'Colour' : 'B/W'} · {job.copies} {job.copies === 1 ? 'copy' : 'copies'}</div>
      <div className="state">{tone === 'ok' && <CheckIcon />}{text}</div>
    </div>
  )
}

const Svg = ({ children, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const PrinterIcon = () => <Svg size={24}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></Svg>
const DocIcon = () => <Svg size={28}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></Svg>
const PlusIcon = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>
const MinusIcon = () => <Svg><path d="M5 12h14" /></Svg>
const XIcon = () => <Svg size={16}><path d="M18 6 6 18M6 6l12 12" /></Svg>
const CheckIcon = () => <Svg size={16}><path d="M20 6 9 17l-5-5" /></Svg>
