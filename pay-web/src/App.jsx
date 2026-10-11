import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { frameReader, readQr } from './readQr.js'
import { takeShared } from './shared.js'
import { cleanAmount, findPayee, payLinks } from './upi.js'

const Icon = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const PHOTO = 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
const PASTE = 'M9 4h6v3H9zM9 5H6v16h12V5h-3'
const COPY = 'M9 9h11v11H9zM5 15H4V4h11v1'
const DONE = 'M5 12l5 5 9-10'
const QR = 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 17v3h-3M20 14v.01'
const UPLOAD = 'M12 16V4M7 9l5-5 5 5M4 20h16'

/** The camera, looking for a payment QR; any other QR in view is passed over. */
function Camera({ onPayee }) {
  const video = useRef(null)
  const [problem, setProblem] = useState(false)

  useEffect(() => {
    let stream = null, timer = 0, closed = false
    const read = frameReader()
    async function look() {
      if (closed) return
      const texts = video.current ? await read(video.current) : []
      const text = texts.find((t) => findPayee([t]))
      if (closed) return
      if (text) return onPayee(text)
      timer = setTimeout(look, 120)
    }
    const asked = navigator.mediaDevices?.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }) ?? Promise.reject(new Error('no camera'))
    asked.then((got) => {
      if (closed) return got.getTracks().forEach((track) => track.stop())
      stream = got
      video.current.srcObject = got
      video.current.play().catch(() => {})
      look()
    }).catch(() => setProblem(true))
    return () => {
      closed = true
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onPayee])

  return problem
    ? <div className="panel bad"><h1>The camera could not be opened</h1><p>Allow the camera for QR Pay in the phone's settings, or go back and use Upload QR.</p></div>
    : <div className="finder"><video ref={video} playsInline muted /><span>Hold the QR inside the square</span></div>
}

export default function App() {
  // 'start' | 'camera' | 'reading' | 'payee' | 'miss'
  const [stage, setStage] = useState('start')
  const [payee, setPayee] = useState(null)
  const [amount, setAmount] = useState('')
  const [picture, setPicture] = useState('')
  const [miss, setMiss] = useState(null)
  const [copied, setCopied] = useState('')
  // The UPI ID was copied by the app itself, on the way to the UPI app.
  const [held, setHeld] = useState(false)
  const fileInput = useRef(null)
  const sharedTaken = useRef(false)

  const take = useCallback(async ({ photo, text }, direct = false) => {
    setStage('reading')
    setHeld(false)
    setPicture((old) => {
      if (old) URL.revokeObjectURL(old)
      return photo ? URL.createObjectURL(photo) : ''
    })
    let texts = text ? [text] : []
    if (photo) {
      try {
        texts = [...(await readQr(photo)), ...texts]
      } catch {
        setMiss({ title: 'This photo could not be opened', hint: 'Take a screenshot of the QR and share that.' })
        return setStage('miss')
      }
    }
    const found = findPayee(texts)
    if (found) {
      setPayee(found)
      setAmount(found.am)
      setStage('payee')
      // Shared from another app: straight on to the phone's UPI apps, with no
      // tap here. It is the plain UPI link, not one app's by name: sent to
      // PhonePe by name, Chrome first asks whether this site may open it. The
      // UPI ID is copied on the way, ready to paste if the app refuses the
      // link. Where the phone does not let a page open an app by itself,
      // nothing happens and this screen is the way on.
      if (direct) {
        setHeld(await navigator.clipboard?.writeText(found.pa).then(() => true, () => false) ?? false)
        location.href = payLinks(found, found.am).any
      }
      return
    }
    setMiss(texts.length
      ? { title: 'This is not a payment QR', hint: 'It says:', said: texts[0] }
      : { title: 'No QR found in this photo', hint: 'Crop the photo close to the QR and share it again.' })
    setStage('miss')
  }, [])

  // Opened by the phone's Share menu: take what the service worker put aside.
  useEffect(() => {
    if (sharedTaken.current || !new URLSearchParams(location.search).has('shared')) return
    sharedTaken.current = true
    history.replaceState(null, '', '/')
    setStage('reading')
    takeShared().catch(() => null).then((shared) => {
      if (shared) return take(shared, true)
      setMiss({ title: 'Nothing came through', hint: 'Share the QR photo to QR Pay again.' })
      setStage('miss')
    })
  }, [take])

  // A QR photo or a UPI link pasted anywhere on the screen.
  useEffect(() => {
    const onPaste = (event) => {
      if (event.target instanceof HTMLInputElement) return
      const photo = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      const text = event.clipboardData?.getData('text') ?? ''
      if (photo || text) take({ photo, text })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [take])

  async function paste() {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) return take({ photo: await item.getType(type) })
      }
    } catch { /* no picture to read; there may still be text */ }
    try {
      const text = await navigator.clipboard.readText()
      if (text) return take({ text })
    } catch { /* not allowed */ }
    setMiss({ title: 'Nothing to paste', hint: 'Copy the QR photo first, then tap Paste.' })
    setStage('miss')
  }

  async function copy(what, text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const box = document.createElement('textarea')
      box.value = text
      document.body.appendChild(box)
      box.select()
      document.execCommand('copy')
      box.remove()
    }
    setCopied(what)
    setTimeout(() => setCopied((now) => (now === what ? '' : now)), 1800)
  }

  const clean = cleanAmount(amount)
  const links = useMemo(() => (payee && clean !== null ? payLinks(payee, clean) : null), [payee, clean])

  const fromCamera = useCallback((text) => take({ text }), [take])

  // The other two ways in besides the camera, which is the button at the foot.
  const choose = (
    <div className="choose">
      <button className="key ghost" onClick={() => fileInput.current?.click()}><Icon d={UPLOAD} /> Upload QR</button>
      {navigator.clipboard?.read && <button className="key ghost" onClick={paste}><Icon d={PASTE} /> Paste</button>}
    </div>
  )
  const scan = <button className="key must" onClick={() => setStage('camera')}><Icon d={PHOTO} size={26} /> Scan with camera</button>
  /** The one button at the foot of the screen, for where things stand. */
  const dock = {
    start: scan,
    miss: scan,
    camera: <button className="key ghost" onClick={() => setStage('start')}>Cancel</button>,
    payee: links
      ? <a className="key safe" href={links.any}>Pay with UPI app</a>
      : <a className="key safe" aria-disabled="true">Pay with UPI app</a>,
  }[stage]

  return (
    <div className="app">
      <header className="top">
        <img src="/icon-192.png" alt="" />
        <div className="brand">QR Pay</div>
      </header>

      <main className="body">
        {stage === 'start' && (
          <>
            <div className="panel">
              <Icon d={QR} size={44} />
              <h1>Pay a QR</h1>
              <p>Scan it, or upload its photo.</p>
            </div>
            {choose}
            <div className="rows">
              <div className="rowline"><span className="label">From a photo</span><p>In WhatsApp or Gallery, open the QR photo, tap Share and pick QR Pay. Your UPI app opens on that payee by itself.</p></div>
              <div className="rowline"><span className="label">First time</span><p>Open this page in Chrome, tap the menu and Add to Home screen. After that QR Pay shows in the Share menu.</p></div>
            </div>
          </>
        )}

        {stage === 'camera' && <Camera onPayee={fromCamera} />}

        {stage === 'reading' && <div className="panel wait"><div className="spin" /><h1>Reading the QR</h1></div>}

        {stage === 'miss' && miss && (
          <>
            <div className="panel bad">
              {picture && <img className="shot" src={picture} alt="" />}
              <h1>{miss.title}</h1>
              <p>{miss.hint}</p>
              {miss.said && <p className="said">{miss.said}</p>}
            </div>
            {choose}
          </>
        )}

        {stage === 'payee' && payee && (
          <>
            <section className="payee">
              <div className="who">
                <span className="label">Paying to</span>
                <div className="name">{payee.pn || payee.pa}</div>
                <div className="upi">{payee.pa}</div>
              </div>
              {picture && <img className="shot" src={picture} alt="" />}
            </section>

            <label className="amount">
              <span className="label">Amount</span>
              <span className="field">
                <span className="rupee">₹</span>
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="type it in the UPI app"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </span>
            </label>
            {clean === null && <p className="warn">Type the amount in figures, such as 12500 or 12500.50</p>}

            <div className="choose">
              <button className="key ghost" onClick={() => copy('upi', payee.pa)}>
                <Icon d={copied === 'upi' ? DONE : COPY} /> {copied === 'upi' ? 'Copied' : 'Copy UPI ID'}
              </button>
              {links && (
                <button className="key ghost" onClick={() => copy('link', links.any)}>
                  <Icon d={copied === 'link' ? DONE : COPY} /> {copied === 'link' ? 'Copied' : 'Copy link'}
                </button>
              )}
            </div>

            <p className="small">Check the name the UPI app shows before you pay.</p>
            {held
              ? <p className="small">The UPI ID is already copied. If the UPI app refuses the link, or stops at ₹2,000, send money to a UPI ID there and paste it: that way takes any amount.</p>
              : <p className="small">The UPI app may refuse the link, or stop at ₹2,000, for a personal or small-shop QR. Then tap Copy UPI ID, open the app, send money to a UPI ID and paste it there: that way takes any amount.</p>}

            {links && <a className="other" href={links.phonepe}>Open in PhonePe only</a>}
            <button className="key ghost" onClick={() => { setPayee(null); setStage('start') }}>Another QR</button>
          </>
        )}
      </main>

      {dock && <div className="dock">{dock}</div>}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const photo = e.target.files?.[0]
          e.target.value = ''
          if (photo) take({ photo })
        }}
      />
    </div>
  )
}
