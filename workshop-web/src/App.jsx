import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { APP_NAME, ICON, OTHER, SIDE, SIDE_NAME } from './side.js'
import { BUBBLE, SMALL, savePhotos, sized } from './offline.js'

/**
 * Shiv Workshop and Shiv Workshop Counter: a work order as a chat, in photos.
 *
 * Two apps from this one build (src/side.js says which). At the counter the
 * shop photographs a work order and sends it; on the workshop's phone, Gopal
 * and Bandhu's, it arrives as a new chat. They visit the site and answer with
 * a photograph of the measurements, which the counter sees at once. No item
 * list and no money: the paper says it all.
 *
 * Who an order is for comes from the panel: the counter picks the customer's
 * account, and the job then carries that account's name, place and phone as
 * the books have them today, with a button to ring the customer.
 *
 * Every photo is saved on the phone as the app opens (src/offline.js), so a
 * thread opens at once and can be read on a site with no signal. The counter
 * can take a message out of a thread, with its delete PIN.
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
/** The three places a job can stand, in the order the work goes. */
const STAGES = [
  { id: 'measurement', label: 'Measurement' },
  { id: 'assemble', label: 'Assemble' },
  { id: 'fitting', label: 'Fitting' },
]
const stageId = (job) => job.stage ?? 'measurement'
/** At measurement a job is still to be measured until the workshop has sent a photo back. */
const measured = (job) => job.messages.some((m) => m.from === 'workshop' && m.photos.length)
const stageOf = (job) => (stageId(job) === 'measurement' ? (measured(job) ? 'Measured' : 'To measure') : STAGES.find((s) => s.id === stageId(job))?.label ?? '')

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
function Shot({ url, width, ...rest }) {
  const [src, setSrc] = useState(() => sized(url, width))
  useEffect(() => { setSrc(sized(url, width)) }, [url, width])
  return <img src={src} onError={() => { if (src !== url) setSrc(url) }} {...rest} />
}

/**
 * A phone photo is 4-12 MB and its upload over mobile data is most of the
 * wait. Brought down to 1600px and packed tighter it is about a twentieth of
 * that, and a written figure still reads when zoomed.
 */
async function forUpload(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.72))
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

/**
 * The outbox: what has been sent from this phone and is still on its way.
 *
 * Send shows the photo in the thread at once and returns; the upload and the
 * post happen behind it, so nobody stands on a site watching a spinner. A
 * send that fails (no signal) stays in the thread marked Not sent and is tried
 * again by itself when the phone is back online, or on a tap.
 *
 * Kept in memory: a send still on its way when the app is closed is lost, and
 * is simply sent again.
 */
const outbox = { items: [], listeners: new Set(), convex: null }
const told = () => { outbox.items = [...outbox.items]; for (const fn of outbox.listeners) fn() }
const watch = (fn) => { outbox.listeners.add(fn); return () => outbox.listeners.delete(fn) }
const useOutbox = () => useSyncExternalStore(watch, () => outbox.items)

async function deliver(item) {
  item.state = 'sending'
  item.error = ''
  told()
  try {
    // Photos that went up before a failed post are not sent up again.
    item.photoIds ??= await upload(outbox.convex, item.files)
    if (item.jobId) await outbox.convex.mutation(api.workshop.send, { jobId: item.jobId, from: SIDE, photos: item.photoIds, text: item.text || undefined })
    else await outbox.convex.mutation(api.workshop.create, { ...item.customer, photos: item.photoIds })
    // The live list has it by now, so its stand-in goes.
    discard(item)
  } catch (err) {
    item.state = 'failed'
    item.error = said(err)
    told()
  }
}
/**
 * The rest of what a thread can do (where the work stands, who it is for, and
 * marking it read) shows on this phone the moment it is tapped: the list here
 * is changed first and the books a moment later, which then send back the
 * same thing. If the books refuse, the list goes back to what they hold.
 */
const withJob = (store, jobId, change) => {
  const jobs = store.getQuery(api.workshop.list, {})
  if (jobs) store.setQuery(api.workshop.list, {}, jobs.flatMap((j) => (j.id !== jobId ? [j] : change(j) ?? [])))
}
const atOnce = {
  seen: (store, { jobId, side }) => withJob(store, jobId, (j) => ({ ...j, [`${side}SeenAt`]: Date.now() })),
  setStage: (store, { jobId, stage }) => withJob(store, jobId, (j) => ({ ...j, stage, updatedAt: Date.now() })),
  setCustomer: (store, { jobId, ledgerId, title }) => {
    const account = ledgerId ? store.getQuery(api.workshop.customers, {})?.find((c) => c.id === ledgerId) : null
    withJob(store, jobId, (j) => ({ ...j, ledgerId: account?.id ?? null, title: account?.name ?? title ?? '', place: account?.place ?? '', phone: account?.phone ?? '', updatedAt: Date.now() }))
  },
}

/** Puts a reply (`jobId`) or a new order (`customer`) in the outbox and starts it on its way. */
function post(item) {
  const queued = { id: `out-${Date.now()}-${outbox.items.length}`, at: Date.now(), state: 'sending', error: '', ...item }
  outbox.items.push(queued)
  told()
  void deliver(queued)
}
function discard(item) {
  outbox.items = outbox.items.filter((x) => x !== item)
  for (const url of item.previews) URL.revokeObjectURL(url)
  told()
}
window.addEventListener('online', () => { for (const item of outbox.items) if (item.state === 'failed') void deliver(item) })

const Icon = ({ d, size = 22, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{d}</svg>
)
const CameraIcon = (p) => <Icon {...p} d={<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>} />
const PhotosIcon = (p) => <Icon {...p} d={<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></>} />
const SendIcon = (p) => <Icon {...p} d={<path d="M4 12l16-8-6 16-3-7z" />} />
const CloseIcon = (p) => <Icon {...p} d={<path d="M6 6l12 12M18 6L6 18" />} />
const PlusIcon = (p) => <Icon {...p} d={<path d="M12 5v14M5 12h14" />} />
const TrashIcon = (p) => <Icon {...p} d={<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />} />
const PhoneIcon = (p) => <Icon {...p} d={<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />} />
const PersonIcon = (p) => <Icon {...p} d={<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>} />
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

/**
 * Saves every photo to the phone, in the background, each time the list
 * arrives or changes. Returns how far it has got: { step, done, total }.
 */
function useSavePhotos(jobs) {
  const [progress, setProgress] = useState(null)
  const state = useRef({ running: false, again: false, jobs: null })
  useEffect(() => {
    if (!jobs) return
    const s = state.current
    s.jobs = jobs
    // One run at a time: a list that changes mid-run starts another after it.
    if (s.running) { s.again = true; return }
    s.running = true
    void (async () => {
      do {
        s.again = false
        try { await savePhotos({ jobs: s.jobs, onProgress: setProgress }) } catch { /* a phone that keeps nothing still shows everything live */ }
      } while (s.again)
      s.running = false
    })()
  }, [jobs])
  return progress
}

/** How far the saving to the phone has got: a line and a bar under the name. */
function Saving({ saving }) {
  if (!saving || saving.step === 'paused' || !saving.total) return null
  const done = saving.step === 'done'
  const percent = done ? 100 : Math.round((saving.done / saving.total) * 100)
  return (
    <div className={`saving ${done ? 'ok' : ''}`} role="status">
      <div className="savetext"><span>{done ? 'All photos are saved on this phone' : `Saving photos on this phone: ${saving.done} of ${saving.total}`}</span>{!done && <b>{percent}%</b>}</div>
      <div className="savebar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
    </div>
  )
}

export default function App() {
  const convex = useConvex()
  useEffect(() => { outbox.convex = convex }, [convex])
  const live = useQuery(api.workshop.list, {})
  const saving = useSavePhotos(live)
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
      <List jobs={jobs} onOpen={openJob} onNew={() => setMaking(true)} saving={saving} />
      {making && <NewOrder onClose={() => setMaking(false)} />}
    </>
  )
}

function List({ jobs, onOpen, onNew, saving }) {
  const [q, setQ] = useState('')
  // The box picked under the search: only the jobs standing there. None picked, all of them.
  const [stage, setStage] = useState(null)
  const rows = useMemo(() => (jobs ?? [])
    .filter((j) => !stage || stageId(j) === stage)
    .filter((j) => !q.trim() || `${titleOf(j)} ${j.number}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [jobs, q, stage])
  const count = (id) => (jobs ?? []).filter((j) => stageId(j) === id).length
  // New orders still on their way: shown at the head of the list from the moment they are sent.
  const sending = useOutbox().filter((item) => !item.jobId)

  return (
    <div className="app">
      <header className="top">
        <div className="brandrow">
          <img src={ICON} alt="" />
          <div className="brand">{APP_NAME}</div>
          <LiveLight />
        </div>
        <Saving saving={saving} />
      </header>
      <div className="searchbar">
        <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="stages" role="group" aria-label="Where the work stands">
        {STAGES.map((s) => (
          <button key={s.id} type="button" className={stage === s.id ? 'on' : ''} aria-pressed={stage === s.id} onClick={() => setStage(stage === s.id ? null : s.id)}>
            <b>{jobs ? count(s.id) : ''}</b>{s.label}
          </button>
        ))}
      </div>
      <ul className="chats">
        {sending.map((item) => (
          <li key={item.id} className="outgoing">
            <button type="button" onClick={() => { if (item.state === 'failed') void deliver(item) }}>
              <span className="avatar"><img src={item.previews[0]} alt="" /></span>
              <span className="who">
                <b>{item.title || 'New work order'}</b>
                <small className={item.state === 'failed' ? 'bad' : ''}>{item.state === 'failed' ? `Not sent. Tap to try again. ${item.error}` : `Sending ${item.files.length > 1 ? `${item.files.length} photos` : 'the photo'}`}</small>
              </span>
              {item.state === 'failed' ? null : <span className="spin dark" />}
            </button>
            {item.state === 'failed' && <button type="button" className="drop" onClick={() => discard(item)} aria-label="Do not send this order"><CloseIcon size={16} /></button>}
          </li>
        ))}
        {rows.map((job) => {
          const last = job.messages[job.messages.length - 1]
          const first = job.messages.flatMap((m) => m.photos)[0]
          const news = newIn(job)
          const standing = stageOf(job)
          const line = last
            ? `${last.from === SIDE ? 'You: ' : ''}${last.photos.length ? (last.photos.length > 1 ? `${last.photos.length} photos` : 'Photo') : ''}${last.photos.length && last.text ? ' · ' : ''}${last.text}`
            : ''
          return (
            <li key={job.id}>
              <button type="button" onClick={() => onOpen(job.id)}>
                <span className="avatar">{first ? <Shot url={first.url} width={SMALL} alt="" loading="lazy" decoding="async" /> : titleOf(job)[0]?.toUpperCase()}</span>
                <span className="who">
                  <b>{titleOf(job)}</b>
                  <small><em className={`stage ${standing === 'To measure' ? 'wait' : 'ok'}`}>{standing}</em>{line}</small>
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
        {jobs && !rows.length && !sending.length && (
          <li className="empty">
            {q ? 'Nothing by that name.' : stage ? `Nothing at ${STAGES.find((s) => s.id === stage).label.toLowerCase()}.`
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

// The delete PIN, once it has been right, is held for five minutes so a few
// messages can go without typing it for each. In memory only, never stored.
const heldPin = { pin: '', until: 0 }
const pinStillGood = () => heldPin.until > Date.now()
const holdPin = (pin) => { heldPin.pin = pin; heldPin.until = Date.now() + 5 * 60_000 }

/** Photos chosen and not yet sent, each with its own preview. */
function usePicked() {
  const [picked, setPicked] = useState([])
  const add = (files) => setPicked((cur) => [...cur, ...[...files].filter((f) => f.type.startsWith('image/')).map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10))
  const drop = (url) => setPicked((cur) => { URL.revokeObjectURL(url); return cur.filter((p) => p.url !== url) })
  /** Hands the photos on to be sent (the outbox keeps their previews) and empties the tray. */
  const take = () => { setPicked([]); return picked }
  return { picked, add, drop, take }
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

/**
 * Who an order is for: `{ ledgerId, name, place, phone }` once an account is
 * picked from the panel's customers, `{ name }` for a name typed for someone
 * who has no account yet, or null.
 */
function CustomerPicker({ value, onChange, disabled }) {
  const customers = useQuery(api.workshop.customers, {})
  const [q, setQ] = useState(value && !value.ledgerId ? value.name : '')

  if (value?.ledgerId) {
    return (
      <div className="chosen">
        <PersonIcon size={20} />
        <span>
          <b>{value.name}</b>
          <small>{[value.place, value.phone].filter(Boolean).join(' · ') || 'From the accounts'}</small>
        </span>
        <button type="button" onClick={() => { setQ(''); onChange(null) }} disabled={disabled} aria-label="Pick another customer"><CloseIcon size={16} /></button>
      </div>
    )
  }
  const needle = q.trim().toLowerCase()
  const found = needle ? (customers ?? []).filter((c) => `${c.name} ${c.place} ${c.phone}`.toLowerCase().includes(needle)).slice(0, 8) : []
  return (
    <div className="picker">
      <input className="field" placeholder="Customer: search the accounts, or type a name" value={q} maxLength={80} disabled={disabled}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value.trim() ? { name: e.target.value } : null) }} />
      {found.length > 0 && (
        <ul className="found">
          {found.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChange({ ledgerId: c.id, name: c.name, place: c.place, phone: c.phone })}>
                <b>{c.name}</b>
                <small>{[c.place, c.phone].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle && customers && !found.length && <p className="pickhint">Not in the accounts. It is sent under this name.</p>}
    </div>
  )
}
/** A picked or typed customer, as the server takes it. */
const customerArgs = (c) => (c?.ledgerId ? { ledgerId: c.ledgerId } : c?.name?.trim() ? { title: c.name.trim() } : {})

/** A new work order: its photo or photos, and who it is for. */
function NewOrder({ onClose }) {
  const { picked, add, drop, take } = usePicked()
  const [customer, setCustomer] = useState(null)
  const camera = useRef(null)
  const gallery = useRef(null)

  // Sent at once: the order shows at the head of the list while it goes up behind.
  const send = () => {
    if (!picked.length) return
    const photos = take()
    post({ customer: customerArgs(customer), title: customer?.name?.trim() ?? '', files: photos.map((p) => p.file), previews: photos.map((p) => p.url) })
    onClose()
  }

  return (
    <div className="sheetback" onClick={onClose}>
      <div className="sheet wide" role="dialog" aria-modal="true" aria-label="New work order" onClick={(e) => e.stopPropagation()}>
        <b className="sheettitle">New work order</b>
        <p>Photograph the order. It goes to the workshop as it is.</p>
        <PhotoInputs camera={camera} gallery={gallery} onFiles={add} />
        <Picked picked={picked} onDrop={drop} />
        <div className="pickrow">
          <button type="button" className="pick" onClick={() => camera.current?.click()}><CameraIcon /> Take photo</button>
          <button type="button" className="pick" onClick={() => gallery.current?.click()}><PhotosIcon /> Choose</button>
        </div>
        <CustomerPicker value={customer} onChange={setCustomer} />
        <div className="sheetbtns">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="solid" onClick={send} disabled={!picked.length}>Send to workshop</button>
        </div>
      </div>
    </div>
  )
}

function Thread({ job, onBack }) {
  const seen = useMutation(api.workshop.seen).withOptimisticUpdate(atOnce.seen)
  const removeMessage = useMutation(api.workshop.removeMessage)
  const setStage = useMutation(api.workshop.setStage).withOptimisticUpdate(atOnce.setStage)
  const setCustomer = useMutation(api.workshop.setCustomer).withOptimisticUpdate(atOnce.setCustomer)
  // The customer being chosen in the "Customer" sheet; undefined while it is shut.
  const [choosing, setChoosing] = useState(undefined)
  const { picked, add, drop, take } = usePicked()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // This thread's replies still on their way: shown as sent from the moment Send is tapped.
  const outgoing = useOutbox().filter((item) => item.jobId === job.id)
  const [viewer, setViewer] = useState(null)
  // The message the counter is about to delete, and the PIN being typed for it.
  const [deleting, setDeleting] = useState(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [checking, setChecking] = useState(false)
  const askDelete = (m) => { setDeleting(m); setPin(''); setPinError('') }
  const confirmDelete = async () => {
    const code = pinStillGood() ? heldPin.pin : pin.trim()
    if (!code || checking) return
    setChecking(true)
    setPinError('')
    try {
      await removeMessage({ jobId: job.id, messageId: deleting.id, pin: code })
      holdPin(code)
      setDeleting(null)
    } catch (err) {
      heldPin.until = 0
      setPin('')
      setPinError(said(err))
    } finally {
      setChecking(false)
    }
  }
  const camera = useRef(null)
  const gallery = useRef(null)
  const end = useRef(null)

  // Like a chat: opens at the newest, and follows it.
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [job.messages.length, picked.length, outgoing.length])

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

  // Sent at once: the reply shows in the thread while it goes up behind (the outbox).
  const reply = () => {
    if (!picked.length && !text.trim()) return
    const photos = take()
    post({ jobId: job.id, text: text.trim(), files: photos.map((p) => p.file), previews: photos.map((p) => p.url) })
    setText('')
    setError('')
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

  const standing = stageOf(job)
  const first = photos[0]
  const waiting = SIDE === 'workshop' && standing === 'To measure'

  return (
    <div className="app chat">
      <header className="top chathead">
        <button type="button" className="back" onClick={onBack} aria-label="Back">‹</button>
        <span className="avatar small">{first ? <Shot url={first.url} width={SMALL} alt="" /> : titleOf(job)[0]?.toUpperCase()}</span>
        <span className="who">
          <b>{titleOf(job)}</b>
          <small>{[job.title ? `Work order ${job.number}` : '', job.place, standing].filter(Boolean).join(' · ')}</small>
        </span>
        {job.phone && <a className="call" href={`tel:${job.phone}`} aria-label={`Call ${titleOf(job)}`}><PhoneIcon /></a>}
      </header>
      <div className="stages inthread" role="group" aria-label="Where the work stands">
        {STAGES.map((s) => (
          <button key={s.id} type="button" className={stageId(job) === s.id ? 'on' : ''} aria-pressed={stageId(job) === s.id}
            onClick={() => { if (stageId(job) !== s.id) setStage({ jobId: job.id, stage: s.id }).catch((err) => setError(said(err))) }}>
            {s.label}
          </button>
        ))}
      </div>
      {SIDE === 'shop' && (
        <div className="actions">
          <button type="button" onClick={() => setChoosing(job.ledgerId ? { ledgerId: job.ledgerId, name: job.title, place: job.place, phone: job.phone } : job.title ? { name: job.title } : null)}>
            <PersonIcon size={17} /> Customer
          </button>
        </div>
      )}

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
                      <Shot url={p.url} width={BUBBLE} alt={m.from === 'workshop' ? 'Measurement photo' : 'Work order photo'} loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
              {m.text && <div className="text">{m.text}</div>}
              <div className="meta">
                {SIDE === 'shop' && <button type="button" className="unsend" onClick={() => askDelete(m)} aria-label="Delete this message"><TrashIcon size={14} /></button>}
                {clock(m.at)}
              </div>
            </div>
          )
        })}
        {outgoing.map((item) => (
          <div key={item.id} className={`bubble right outgoing ${item.state}`}>
            {item.previews.length > 0 && (
              <div className={`shots n${Math.min(item.previews.length, 3)}`}>
                {item.previews.map((url) => <span key={url}><img src={url} alt="" /></span>)}
              </div>
            )}
            {item.text && <div className="text">{item.text}</div>}
            {item.state === 'failed' ? (
              <div className="meta bad">
                <button type="button" onClick={() => void deliver(item)}>Not sent. Tap to try again</button>
                <button type="button" onClick={() => discard(item)} aria-label="Do not send this"><CloseIcon size={14} /></button>
              </div>
            ) : (
              <div className="meta">Sending <span className="spin dark tiny" /></div>
            )}
          </div>
        ))}
        {waiting && !outgoing.length && <p className="hint">Visit the site, then send a photo of the measurements here.</p>}
        <div ref={end} />
      </main>

      <footer className="composer">
        <PhotoInputs camera={camera} gallery={gallery} onFiles={add} />
        <Picked picked={picked} onDrop={drop} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="tool" onClick={() => gallery.current?.click()} aria-label="Choose photos from the phone"><PhotosIcon /></button>
          <input type="text" placeholder="Write a line" value={text} maxLength={500}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') reply() }} />
          {picked.length || text.trim() ? (
            <button type="button" className="go" onClick={reply} aria-label="Send"><SendIcon /></button>
          ) : (
            <button type="button" className={`go ${waiting ? 'wide' : ''}`} onClick={() => camera.current?.click()} aria-label="Take a photo">
              <CameraIcon />{waiting && ' Measurement photo'}
            </button>
          )}
        </div>
      </footer>

      {viewer != null && viewer >= 0 && <Viewer photos={photos} start={viewer} title={titleOf(job)} onClose={() => window.history.back()} />}
      {choosing !== undefined && (
        <div className="sheetback" onClick={() => setChoosing(undefined)}>
          <div className="sheet wide" role="dialog" aria-modal="true" aria-label="Customer" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">Who is this for?</b>
            <p>Pick the customer's account from the panel; the name, place and phone come with it.</p>
            <CustomerPicker value={choosing} onChange={setChoosing} />
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setChoosing(undefined)}>Cancel</button>
              <button type="button" className="solid" onClick={() => { const args = customerArgs(choosing); setChoosing(undefined); setCustomer({ jobId: job.id, ...args }).catch((err) => setError(said(err))) }}>Save</button>
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="sheetback" onClick={checking ? undefined : () => setDeleting(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Delete this message" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">Delete this message?</b>
            <p>
              {SIDE_NAME[deleting.from]}, {clock(deleting.at)}{deleting.photos.length ? ` · ${deleting.photos.length} ${deleting.photos.length === 1 ? 'photo' : 'photos'}` : ''}
              <br />It is removed for both sides, for good.{job.messages.length === 1 ? ' It is the only message here, so the work order goes with it.' : ''}
            </p>
            {!pinStillGood() && (
              <input className="field pin" type="password" inputMode="numeric" autoComplete="off" placeholder="Delete PIN" value={pin} autoFocus
                onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void confirmDelete() }} />
            )}
            {pinError && <p className="error" role="alert">{pinError}</p>}
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setDeleting(null)} disabled={checking}>Cancel</button>
              <button type="button" className="solid danger" onClick={confirmDelete} disabled={checking || (!pinStillGood() && !pin.trim())}>{checking ? 'Checking' : 'Delete'}</button>
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
