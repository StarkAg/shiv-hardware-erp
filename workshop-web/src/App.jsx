import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { APP_NAME, ICON, OTHER, SIDE, SIDE_NAME } from './side.js'

/**
 * Shiv Workshop and Shiv Workshop Counter: a work order as a chat, in photos.
 *
 * Two apps from this one build (src/side.js says which). At the counter the
 * shop photographs a work order and sends it; on the workshop's phone, Gopal
 * and Bandhu's, it arrives as a new chat. They visit the site and answer with
 * a photograph of the measurements, which the counter sees at once. No item
 * list and no money: the paper says it all.
 *
 * Read like a chat app on both sides: a list of jobs with what is new on
 * each, and a thread per job, one's own photos on the right. Everything is a
 * live read (convex/workshop.ts), so nothing needs refreshing.
 */
const api = anyApi

// The last list is kept on the phone, so the app opens on it at once.
const KEY = `workshop:${SIDE}:jobs`
const kept = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') ?? undefined } catch { return undefined } }
const keep = (jobs) => { try { localStorage.setItem(KEY, JSON.stringify(jobs)) } catch { /* storage full: it just opens cold */ } }

const titleOf = (job) => job.title || `Work order ${job.number}`
/** What the other side has sent since this side last had the thread open. */
const newIn = (job) => job.messages.filter((m) => m.from === OTHER && m.at > (job[`${SIDE}SeenAt`] ?? 0)).length
/** Measured once the workshop has sent a photo back. */
const stageOf = (job) => (job.status === 'done' ? 'Done' : job.messages.some((m) => m.from === 'workshop' && m.photos.length) ? 'Measured' : 'To measure')

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
const clock = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
const dayOf = (ms) => {
  const now = Date.now()
  if (sameDay(ms, now)) return 'Today'
  if (sameDay(ms, now - 86400000)) return 'Yesterday'
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
/** In the list: the time today, else the day. */
const whenOf = (ms) => (sameDay(ms, Date.now()) ? clock(ms) : sameDay(ms, Date.now() - 86400000) ? 'Yesterday' : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))

/**
 * A photo brought down to the size it is shown at, by the site's own image
 * service (vercel.json "images"): a chat list of full phone photos is
 * megabytes. Where that is not to be had the photo itself is shown.
 */
const sized = (url, width) => `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=70`
function Shot({ url, width, ...rest }) {
  const [src, setSrc] = useState(() => sized(url, width))
  useEffect(() => { setSrc(sized(url, width)) }, [url, width])
  return <img src={src} onError={() => { if (src !== url) setSrc(url) }} {...rest} />
}

/**
 * A phone photo is 4-12 MB and its upload over mobile data is most of the
 * wait. Brought down to 2000px it still reads to the last figure.
 */
async function forUpload(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}

/** Uploads photos to the books' store; returns their ids, in the order given. */
async function upload(convex, files) {
  return Promise.all(files.map(async (file) => {
    const body = await forUpload(file)
    const url = await convex.mutation(api.files.generateUploadUrl, {})
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': body.type || 'image/jpeg' }, body })
    if (!res.ok) throw new Error('A photo did not upload. Try again.')
    return (await res.json()).storageId
  }))
}
const said = (err) => (typeof err?.data === 'string' ? err.data : err?.message) || 'Could not send. Try again.'

const Icon = ({ d, size = 22, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{d}</svg>
)
const CameraIcon = (p) => <Icon {...p} d={<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>} />
const PhotosIcon = (p) => <Icon {...p} d={<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></>} />
const SendIcon = (p) => <Icon {...p} d={<path d="M4 12l16-8-6 16-3-7z" />} />
const CloseIcon = (p) => <Icon {...p} d={<path d="M6 6l12 12M18 6L6 18" />} />
const PlusIcon = (p) => <Icon {...p} d={<path d="M12 5v14M5 12h14" />} />
const TickIcon = (p) => <Icon {...p} d={<path d="M5 12.5l4.5 4.5L19 7.5" />} />
const TrashIcon = (p) => <Icon {...p} d={<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />} />
const ShareIcon = (p) => <Icon {...p} d={<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>} />

/** The light that says the list on screen is the live one. */
function LiveLight() {
  const convex = useConvex()
  const [on, setOn] = useState(() => convex.connectionState().isWebSocketConnected)
  useEffect(() => {
    const timer = setInterval(() => setOn(convex.connectionState().isWebSocketConnected), 1500)
    return () => clearInterval(timer)
  }, [convex])
  return <span className={`live ${on ? 'on' : ''}`} role="status"><i />{on ? 'Live' : 'Connecting'}</span>
}

export default function App() {
  const live = useQuery(api.workshop.list, {})
  const [cached] = useState(kept)
  useEffect(() => { if (live) keep(live) }, [live])
  const jobs = live ?? cached
  const [openId, setOpenId] = useState(null)
  const [making, setMaking] = useState(false)
  const open = openId ? jobs?.find((j) => j.id === openId) : null

  // The phone's Back closes a thread, as it closes a chat. A photo open over
  // the thread is closed first (Thread), and the thread stays.
  useEffect(() => {
    const onPop = (e) => { if (!e.state?.job) setOpenId(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openJob = (id) => { window.history.pushState({ job: id }, ''); setOpenId(id) }
  // A job removed while its thread is open: back to the list.
  useEffect(() => { if (openId && live && !live.some((j) => j.id === openId)) window.history.back() }, [openId, live])

  // What is new, on the app's own tab or task-switcher title.
  const fresh = (jobs ?? []).reduce((t, j) => t + newIn(j), 0)
  useEffect(() => { document.title = `${fresh ? `(${fresh}) ` : ''}Shiv ${APP_NAME}` }, [fresh])

  if (open) return <Thread job={open} onBack={() => window.history.back()} />
  return (
    <>
      <List jobs={jobs} onOpen={openJob} onNew={() => setMaking(true)} />
      {making && <NewOrder onClose={() => setMaking(false)} onMade={(id) => { setMaking(false); openJob(id) }} />}
    </>
  )
}

function List({ jobs, onOpen, onNew }) {
  const [tab, setTab] = useState('open')
  const [q, setQ] = useState('')
  const rows = useMemo(() => (jobs ?? [])
    .filter((j) => j.status === tab)
    .filter((j) => !q.trim() || `${titleOf(j)} ${j.number}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [jobs, tab, q])
  const count = (status) => (jobs ?? []).filter((j) => j.status === status).length

  return (
    <div className="app">
      <header className="top">
        <div className="brandrow">
          <img src={ICON} alt="" />
          <div className="brand">{APP_NAME}</div>
          <LiveLight />
        </div>
        <nav className="tabs">
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Open{jobs ? ` · ${count('open')}` : ''}</button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Done</button>
        </nav>
      </header>
      <div className="searchbar">
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="chats">
        {rows.map((job) => {
          const last = job.messages[job.messages.length - 1]
          const first = job.messages.flatMap((m) => m.photos)[0]
          const news = newIn(job)
          const stage = stageOf(job)
          const line = last
            ? `${last.from === SIDE ? 'You: ' : ''}${last.photos.length ? (last.photos.length > 1 ? `${last.photos.length} photos` : 'Photo') : ''}${last.photos.length && last.text ? ' · ' : ''}${last.text}`
            : ''
          return (
            <li key={job.id}>
              <button type="button" onClick={() => onOpen(job.id)}>
                <span className="avatar">{first ? <Shot url={first.url} width={256} alt="" loading="lazy" decoding="async" /> : titleOf(job)[0]?.toUpperCase()}</span>
                <span className="who">
                  <b>{titleOf(job)}</b>
                  <small><em className={`stage ${stage === 'To measure' ? 'wait' : 'ok'}`}>{stage}</em>{line}</small>
                </span>
                <span className="side">
                  <time className={news ? 'new' : ''}>{whenOf(job.updatedAt)}</time>
                  {news > 0 && <i className="badge">{news}</i>}
                </span>
              </button>
            </li>
          )
        })}
        {!jobs && <li className="empty">Loading</li>}
        {jobs && !rows.length && (
          <li className="empty">
            {q ? 'Nothing by that name.' : tab === 'done' ? 'Nothing finished yet.'
              : SIDE === 'shop' ? 'No work orders yet. Tap New order to send the first.' : 'No work orders yet. A new one from the shop shows here by itself.'}
          </li>
        )}
      </ul>
      {SIDE === 'shop' && (
        <button type="button" className="fab" onClick={onNew}><PlusIcon /> New order</button>
      )}
    </div>
  )
}

/** Photos chosen and not yet sent, each with its own preview. */
function usePicked() {
  const [picked, setPicked] = useState([])
  const add = (files) => setPicked((cur) => [...cur, ...[...files].filter((f) => f.type.startsWith('image/')).map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10))
  const drop = (url) => setPicked((cur) => { URL.revokeObjectURL(url); return cur.filter((p) => p.url !== url) })
  const clear = () => setPicked((cur) => { for (const p of cur) URL.revokeObjectURL(p.url); return [] })
  return { picked, add, drop, clear }
}

/** The two ways to add a photo: the camera, straight away, or ones already on the phone. */
function PhotoInputs({ camera, gallery, onFiles }) {
  const take = (e) => { onFiles(e.target.files); e.target.value = '' }
  return (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={take} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={take} />
    </>
  )
}

function Picked({ picked, onDrop }) {
  if (!picked.length) return null
  return (
    <div className="picked">
      {picked.map((p) => (
        <span key={p.url}>
          <img src={p.url} alt="" />
          <button type="button" onClick={() => onDrop(p.url)} aria-label="Remove this photo"><CloseIcon size={14} /></button>
        </span>
      ))}
    </div>
  )
}

/** A new work order: its photo or photos, and who it is for if the counter cares to say. */
function NewOrder({ onClose, onMade }) {
  const convex = useConvex()
  const create = useMutation(api.workshop.create)
  const { picked, add, drop } = usePicked()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const camera = useRef(null)
  const gallery = useRef(null)

  const send = async () => {
    if (!picked.length || busy) return
    setBusy(true)
    setError('')
    try {
      const photos = await upload(convex, picked.map((p) => p.file))
      onMade(await create({ title: title.trim() || undefined, photos }))
    } catch (err) {
      setError(said(err))
      setBusy(false)
    }
  }

  return (
    <div className="sheetback" onClick={busy ? undefined : onClose}>
      <div className="sheet wide" role="dialog" aria-modal="true" aria-label="New work order" onClick={(e) => e.stopPropagation()}>
        <b className="sheettitle">New work order</b>
        <p>Photograph the order. It goes to the workshop as it is.</p>
        <PhotoInputs camera={camera} gallery={gallery} onFiles={add} />
        <Picked picked={picked} onDrop={drop} />
        <div className="pickrow">
          <button type="button" className="pick" onClick={() => camera.current?.click()} disabled={busy}><CameraIcon /> Take photo</button>
          <button type="button" className="pick" onClick={() => gallery.current?.click()} disabled={busy}><PhotosIcon /> Choose</button>
        </div>
        <input className="field" placeholder="Customer or place (optional)" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sheetbtns">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="solid" onClick={send} disabled={!picked.length || busy}>{busy ? 'Sending' : 'Send to workshop'}</button>
        </div>
      </div>
    </div>
  )
}

function Thread({ job, onBack }) {
  const convex = useConvex()
  const send = useMutation(api.workshop.send)
  const seen = useMutation(api.workshop.seen)
  const setStatus = useMutation(api.workshop.setStatus)
  const remove = useMutation(api.workshop.remove)
  const { picked, add, drop, clear } = usePicked()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [viewer, setViewer] = useState(null)
  const [asking, setAsking] = useState(false)
  const camera = useRef(null)
  const gallery = useRef(null)
  const end = useRef(null)

  // Like a chat: opens at the newest, and follows it.
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [job.messages.length, picked.length])

  // With the thread on screen, what the other side sent is no longer new.
  const news = newIn(job)
  useEffect(() => {
    if (news > 0 && document.visibilityState === 'visible') void seen({ jobId: job.id, side: SIDE }).catch(() => {})
  }, [news, job.id, seen])

  // A photo opens over the thread; the phone's Back closes it.
  const photos = useMemo(() => job.messages.flatMap((m) => m.photos), [job.messages])
  const openPhoto = (storageId) => {
    window.history.pushState({ job: job.id, photo: true }, '')
    setViewer(photos.findIndex((p) => p.storageId === storageId))
  }
  useEffect(() => {
    const onPop = (e) => { if (!e.state?.photo) setViewer(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const post = async () => {
    if (busy || (!picked.length && !text.trim())) return
    setBusy(true)
    setError('')
    try {
      const ids = await upload(convex, picked.map((p) => p.file))
      await send({ jobId: job.id, from: SIDE, photos: ids, text: text.trim() || undefined })
      clear()
      setText('')
    } catch (err) {
      setError(said(err))
    } finally {
      setBusy(false)
    }
  }

  const items = useMemo(() => {
    const out = []
    let lastDay = ''
    for (const m of job.messages) {
      const day = dayOf(m.at)
      if (day !== lastDay) { out.push({ key: `d-${day}-${m.id}`, day }); lastDay = day }
      out.push({ key: m.id, m })
    }
    return out
  }, [job.messages])

  const stage = stageOf(job)
  const first = photos[0]
  const waiting = SIDE === 'workshop' && stage === 'To measure'

  return (
    <div className="app chat">
      <header className="top chathead">
        <button type="button" className="back" onClick={onBack} aria-label="Back">‹</button>
        <span className="avatar small">{first ? <Shot url={first.url} width={256} alt="" /> : titleOf(job)[0]?.toUpperCase()}</span>
        <span className="who">
          <b>{titleOf(job)}</b>
          <small>{job.title ? `Work order ${job.number} · ` : ''}{stage}</small>
        </span>
        {SIDE === 'shop' && (
          <>
            <button type="button" className="act" onClick={() => setStatus({ jobId: job.id, status: job.status === 'done' ? 'open' : 'done' }).catch((err) => setError(said(err)))}>
              {job.status === 'done' ? 'Reopen' : <><TickIcon size={18} /> Done</>}
            </button>
            <button type="button" className="act icon" onClick={() => setAsking(true)} aria-label="Delete this work order"><TrashIcon size={18} /></button>
          </>
        )}
      </header>

      <main className="thread">
        {items.map((it) => {
          if (it.day) return <div key={it.key} className="daytag"><span>{it.day}</span></div>
          const m = it.m
          const mine = m.from === SIDE
          return (
            <div key={it.key} className={`bubble ${mine ? 'right' : 'left'}`}>
              {!mine && <div className="kind">{SIDE_NAME[m.from]}</div>}
              {m.photos.length > 0 && (
                <div className={`shots n${Math.min(m.photos.length, 3)}`}>
                  {m.photos.map((p) => (
                    <button key={p.storageId} type="button" onClick={() => openPhoto(p.storageId)}>
                      <Shot url={p.url} width={640} alt={m.from === 'workshop' ? 'Measurement photo' : 'Work order photo'} loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
              {m.text && <div className="text">{m.text}</div>}
              <div className="meta">{clock(m.at)}</div>
            </div>
          )
        })}
        {waiting && <p className="hint">Visit the site, then send a photo of the measurements here.</p>}
        <div ref={end} />
      </main>

      <footer className="composer">
        <PhotoInputs camera={camera} gallery={gallery} onFiles={add} />
        <Picked picked={picked} onDrop={drop} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="tool" onClick={() => gallery.current?.click()} disabled={busy} aria-label="Choose photos from the phone"><PhotosIcon /></button>
          <input type="text" placeholder="Write a line" value={text} maxLength={500} disabled={busy}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void post() }} />
          {picked.length || text.trim() ? (
            <button type="button" className="go" onClick={post} disabled={busy} aria-label="Send">{busy ? <span className="spin" /> : <SendIcon />}</button>
          ) : (
            <button type="button" className={`go ${waiting ? 'wide' : ''}`} onClick={() => camera.current?.click()} disabled={busy} aria-label="Take a photo">
              <CameraIcon />{waiting && ' Measurement photo'}
            </button>
          )}
        </div>
      </footer>

      {viewer != null && viewer >= 0 && <Viewer photos={photos} start={viewer} title={titleOf(job)} onClose={() => window.history.back()} />}
      {asking && (
        <div className="sheetback" onClick={() => setAsking(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Delete this work order" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">Delete this work order?</b>
            <p>{titleOf(job)}<br />Its photos and the workshop's replies are removed for good.</p>
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="solid danger" onClick={() => { setAsking(false); remove({ jobId: job.id }).catch((err) => setError(said(err))) }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** A thread's photos, full screen: swipe (or the arrow keys) from one to the next. */
function Viewer({ photos, start, title, onClose }) {
  const strip = useRef(null)
  const [at, setAt] = useState(start)
  const [note, setNote] = useState('')

  // Opens on the photo that was tapped.
  useLayoutEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = start * el.clientWidth
  }, [start])

  const turn = (by) => {
    const el = strip.current
    if (el) el.scrollTo({ left: Math.min(photos.length - 1, Math.max(0, at + by)) * el.clientWidth, behavior: 'smooth' })
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') turn(1)
      else if (e.key === 'ArrowLeft') turn(-1)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** The photo on screen, handed to the phone's share sheet (WhatsApp and the rest). */
  const share = async () => {
    setNote('')
    try {
      const res = await fetch(photos[at].url)
      const blob = await res.blob()
      const base = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Work order'
      const file = new File([blob], `${base} ${at + 1}.jpg`, { type: blob.type || 'image/jpeg' })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: base }); return }
      // No share sheet here (a computer): the photo is saved instead.
      const link = document.createElement('a')
      link.href = URL.createObjectURL(file)
      link.download = file.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
      setNote('Saved to this device.')
    } catch (err) {
      if (err?.name !== 'AbortError') setNote('Could not share. Try again.')
    }
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="vbar">
        <button type="button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <span className="count">{photos.length > 1 ? `${at + 1} of ${photos.length}` : ''}</span>
        <button type="button" className="text" onClick={share}><ShareIcon size={20} /> Share</button>
      </div>
      <div className="vstrip" ref={strip}
        onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {photos.map((p, i) => (
          <div key={p.storageId} className="vslide" onClick={onClose}>
            {/* The photo itself, for reading a figure up close; the phone keeps it once fetched (sw.js). */}
            <img src={p.url} alt={`Photo ${i + 1}`} loading={Math.abs(i - start) > 1 ? 'lazy' : undefined} onClick={(e) => e.stopPropagation()} />
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="vdots" aria-hidden="true">{photos.map((p, i) => <i key={p.storageId} className={i === at ? 'on' : ''} />)}</div>
      )}
      {note && <div className="vnote" role="status">{note}</div>}
    </div>
  )
}
