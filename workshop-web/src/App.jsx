import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { APP_NAME, ICON, OTHER, SIDE, SIDE_NAME } from './side.js'
import { BUBBLE, SMALL, savePhotos, sized } from './offline.js'
import Camera from './Camera.jsx'

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
 * thread opens at once and can be read on a site with no signal. Holding a
 * finger on a message takes it out of its thread, and on a job in the list
 * takes the whole work order off it: on either phone, with the delete PIN.
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
/**
 * The books write a customer as "Sanjay Mahto Ji, Korambe": the name, and
 * after the first comma where they are. The list shows the two apart, the
 * name and under it the address on one line.
 */
const nameOf = (job) => titleOf(job).split(',')[0].trim()
const addressOf = (job) => {
  const after = titleOf(job).split(',').slice(1).join(',').replace(/\s+/g, ' ').trim()
  // The account's own place, when it has one the name does not already say.
  const place = String(job.place ?? '').trim()
  return [after, place && !after.toLowerCase().includes(place.toLowerCase()) ? place : ''].filter(Boolean).join(', ')
}
/** What the other side has sent since this side last had the thread open. */
const newIn = (job) => job.messages.filter((m) => m.from === OTHER && m.at > (job[`${SIDE}SeenAt`] ?? 0)).length
/** The three places a job can stand, in the order the work goes. */
/**
 * The steps a job goes through, in order, and whose turn each is
 * (convex/workshop.ts `send` is where each is done and the job moved on):
 *
 *   measurement  the workshop measures on site and photographs the figures
 *   quotation    the shop makes the work order from them and sends its photo
 *   assemble     the workshop builds it, says how many boards are made, then Complete
 *   goahead      the shop rings the customer and says when to go and whom to ring
 *   fitting      the workshop fits it and photographs it; the job is finished
 *
 * `todo` is what the list says while a step waits.
 */
const STAGES = [
  { id: 'measurement', label: 'Measurement', todo: 'To measure', turn: 'workshop' },
  { id: 'quotation', label: 'Work order', todo: 'Work order to make', turn: 'shop' },
  { id: 'assemble', label: 'Assemble', todo: 'Being assembled', turn: 'workshop' },
  { id: 'goahead', label: 'Go-ahead', todo: 'Complete: go-ahead to give', turn: 'shop' },
  { id: 'fitting', label: 'Fitting', todo: 'To fit', turn: 'workshop' },
]
/**
 * Nothing in a thread is free text: every message is tagged with what it is,
 * and this is what each tag is called in the chat.
 */
const TAGS = { visit: 'Visit order', measurement: 'Measurement', quotation: 'Work order', assemble: 'Work status', goahead: 'Go-ahead', fitting: 'Fitted' }
const stageId = (job) => job.stage ?? 'measurement'
const stageAt = (job) => STAGES.find((s) => s.id === stageId(job)) ?? STAGES[0]
const stageNo = (id) => STAGES.findIndex((s) => s.id === id)
const finished = (job) => job.status === 'done'
const stageOf = (job) => (finished(job) ? 'Done' : stageAt(job).todo)
/** Whether the step a job stands at is this side's to do. */
const myTurn = (job) => !finished(job) && stageAt(job).turn === SIDE

const boardsLine = (made, total) => `${made}${total ? ` of ${total}` : ''} ${made === 1 && !total ? 'board' : 'boards'} made`
const visitLine = (ms) => new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
/** A message in a few words: for the list, and for one still on its way. */
const lineOf = (m, job) => {
  const n = m.photos?.length ?? m.files?.length ?? 0
  if (m.complete) return 'Complete'
  if (m.visitAt) return `Go-ahead: ${visitLine(m.visitAt)}`
  if (m.boards != null && m.step !== 'quotation') return `Work status: ${boardsLine(m.boards, job?.boardsTotal)}`
  if (n) return `${TAGS[m.step] ?? (m.from === 'workshop' ? 'Measurement' : 'Photo')}${n > 1 ? ` · ${n} photos` : ''}`
  return m.text || ''
}

/**
 * The numbers to ring a customer on. The books keep one line for the phone,
 * and where a customer has two they are written into it side by side
 * ("8340785465 / 9000000000"): each run of digits long enough to be a number
 * is one contact.
 */
const contactsOf = (phone) => [...new Set((String(phone ?? '').match(/\+?\d[\d\s-]{8,}\d/g) ?? [])
  .map((n) => n.replace(/[\s-]+/g, ''))
  // Two ten-digit numbers with only a space between them read as one run: taken apart again.
  .flatMap((n) => (/^\d{20,}$/.test(n) && n.length % 10 === 0 ? n.match(/\d{10}/g) : [n])))]
/** Where the site is, as a link the phone's map opens, when the job carries one. */
const mapLinkOf = (job) => job.mapUrl || (job.location?.lat != null ? `https://www.google.com/maps?q=${job.location.lat},${job.location.lng}` : '')

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
    if (item.jobId) {
      await outbox.convex.mutation(api.workshop.send, {
        jobId: item.jobId, from: SIDE, photos: item.photoIds,
        ...(item.step ? { step: item.step } : {}),
        ...(item.boards != null ? { boards: item.boards } : {}),
        ...(item.complete ? { complete: true } : {}),
        ...(item.visitAt ? { visitAt: item.visitAt, callPhone: item.callPhone } : {}),
      })
    }
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
 * The rest of what a thread can do (who it is for, and marking it read)
 * shows on this phone the moment it is tapped: the list here
 * is changed first and the books a moment later, which then send back the
 * same thing. If the books refuse, the list goes back to what they hold.
 */
const withJob = (store, jobId, change) => {
  const jobs = store.getQuery(api.workshop.list, {})
  if (jobs) store.setQuery(api.workshop.list, {}, jobs.flatMap((j) => (j.id !== jobId ? [j] : change(j) ?? [])))
}
const atOnce = {
  seen: (store, { jobId, side }) => withJob(store, jobId, (j) => ({ ...j, [`${side}SeenAt`]: Date.now() })),
  setCustomer: (store, { jobId, ledgerId, title }) => {
    const account = ledgerId ? store.getQuery(api.workshop.customers, {})?.find((c) => c.id === ledgerId) : null
    withJob(store, jobId, (j) => ({ ...j, ledgerId: account?.id ?? null, title: account?.name ?? title ?? '', place: account?.place ?? '', phone: account?.phone ?? '', updatedAt: Date.now() }))
  },
}

/** Puts a reply (`jobId`) or a new order (`customer`) in the outbox and starts it on its way. */
function post(item) {
  const queued = { id: `out-${Date.now()}-${outbox.items.length}`, at: Date.now(), state: 'sending', error: '', files: [], previews: [], ...item }
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
const PhoneIcon = (p) => <Icon {...p} d={<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />} />
const PersonIcon = (p) => <Icon {...p} d={<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>} />
const PinIcon = (p) => <Icon {...p} d={<><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.6" /></>} />
const MenuIcon = (p) => <Icon {...p} d={<path d="M4 6h16M4 12h16M4 18h16" />} />
const TickIcon = (p) => <Icon {...p} d={<path d="M5 12.5l4.5 4.5L19 7.5" />} />
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
  /**
   * The filter under the search. It opens on To do: the jobs waiting on this
   * side (the step is its turn) and any with something new from the other,
   * so the list a phone opens on is the work in hand. Then All, and the jobs
   * standing at each step.
   */
  const FILTERS = [
    { id: 'todo', label: 'To do', test: (j) => myTurn(j) || newIn(j) > 0 },
    { id: 'all', label: 'All', test: () => true },
    ...STAGES.map((st) => ({ id: st.id, label: st.label, test: (j) => !finished(j) && stageId(j) === st.id })),
  ]
  const [filter, setFilter] = useState('todo')
  const showing = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]
  const rows = useMemo(() => (jobs ?? [])
    .filter((j) => showing.test(j))
    .filter((j) => !q.trim() || `${titleOf(j)} ${j.number}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [jobs, q, filter])
  // New orders still on their way: shown at the head of the list from the moment they are sent.
  const sending = useOutbox().filter((item) => !item.jobId)
  const remove = useMutation(api.workshop.remove)
  // The work order about to be deleted, once a finger has been held on it.
  const [deleting, setDeleting] = useState(null)
  const holdToDelete = useHold(setDeleting)
  const photosIn = (job) => job.messages.reduce((n, m) => n + m.photos.length, 0)

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
      <div className="filters" role="group" aria-label="Which jobs to show">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`${filter === f.id ? 'on' : ''} ${f.id === 'todo' ? 'todo' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}{jobs && <b>{jobs.filter(f.test).length}</b>}
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
          const line = last ? `${last.from === SIDE ? 'You: ' : ''}${lineOf(last, job)}` : ''
          return (
            <li key={job.id} className="holdable" {...holdToDelete(job)}>
              <button type="button" onClick={() => onOpen(job.id)}>
                <span className="avatar">{first ? <Shot url={first.url} width={SMALL} alt="" loading="lazy" decoding="async" /> : titleOf(job)[0]?.toUpperCase()}</span>
                <span className="who">
                  <b>{nameOf(job)}</b>
                  {addressOf(job) && <small className="addr">{addressOf(job)}</small>}
                  <small><em className={`stage ${myTurn(job) ? 'wait' : 'ok'}`}>{standing}</em>{line}</small>
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
            {q ? 'Nothing by that name.'
              : filter === 'todo' && jobs.length ? 'Nothing is waiting on you. Tap All to see every job.'
              : filter !== 'todo' && filter !== 'all' ? `Nothing at ${showing.label.toLowerCase()}.`
              : SIDE === 'shop' ? 'No work orders yet. Tap New order to send the first.' : 'No work orders yet. A new one from the shop shows here by itself.'}
          </li>
        )}
      </ul>
      {SIDE === 'shop' && (
        <button type="button" className="fab" onClick={onNew}><PlusIcon /> New order</button>
      )}
      {deleting && (
        <DeleteSheet title="Delete this work order?" onClose={() => setDeleting(null)} run={(pin) => remove({ jobId: deleting.id, pin })}>
          {titleOf(deleting)}{photosIn(deleting) ? ` · ${photosIn(deleting)} ${photosIn(deleting) === 1 ? 'photo' : 'photos'}` : ''}
          <br />The whole work order is removed for both sides, for good.
        </DeleteSheet>
      )}
    </div>
  )
}

// The delete PIN, once it has been right, is held for five minutes so a few
// messages can go without typing it for each. In memory only, never stored.
const heldPin = { pin: '', until: 0 }
const pinStillGood = () => heldPin.until > Date.now()
const holdPin = (pin) => { heldPin.pin = pin; heldPin.until = Date.now() + 5 * 60_000 }

/**
 * Holding a finger for half a second on a message (its photo or its text) or
 * on a job in the list asks to delete it: `onHold` is told which. A finger
 * that moves is scrolling, not holding; and the tap that ends a hold does not
 * also open what was held.
 */
function useHold(onHold) {
  const press = useRef({ timer: 0, x: 0, y: 0, held: false })
  useEffect(() => () => clearTimeout(press.current.timer), [])
  return (what) => ({
    onPointerDown: (e) => {
      const p = press.current
      clearTimeout(p.timer)
      p.held = false
      p.x = e.clientX
      p.y = e.clientY
      p.timer = setTimeout(() => { p.held = true; navigator.vibrate?.(15); onHold(what) }, 550)
    },
    onPointerMove: (e) => { const p = press.current; if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10) clearTimeout(p.timer) },
    onPointerUp: () => clearTimeout(press.current.timer),
    onPointerCancel: () => clearTimeout(press.current.timer),
    onPointerLeave: () => clearTimeout(press.current.timer),
    // The phone's own long-press menu (save image, copy) would come up over the question.
    onContextMenu: (e) => e.preventDefault(),
    onClickCapture: (e) => { if (press.current.held) { press.current.held = false; e.stopPropagation(); e.preventDefault() } },
  })
}

/**
 * The question before anything is deleted, with the delete PIN typed under
 * it. `run(pin)` does the deleting; a PIN the books refuse is asked for again.
 */
function DeleteSheet({ title, children, run, onClose }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const confirm = async () => {
    const code = pinStillGood() ? heldPin.pin : pin.trim()
    if (!code || checking) return
    setChecking(true)
    setError('')
    try {
      await run(code)
      holdPin(code)
      onClose()
    } catch (err) {
      heldPin.until = 0
      setPin('')
      setError(said(err))
      setChecking(false)
    }
  }
  return (
    <div className="sheetback" onClick={checking ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <b className="sheettitle">{title}</b>
        <p>{children}</p>
        {!pinStillGood() && (
          <input className="field pin" type="password" inputMode="numeric" autoComplete="off" placeholder="Delete PIN" value={pin} autoFocus
            onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }} />
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sheetbtns">
          <button type="button" className="ghost" onClick={onClose} disabled={checking}>Cancel</button>
          <button type="button" className="solid danger" onClick={confirm} disabled={checking || (!pinStillGood() && !pin.trim())}>{checking ? 'Checking' : 'Delete'}</button>
        </div>
      </div>
    </div>
  )
}

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

/** A new job: the photo or photos of the visit order, and who it is for. It starts at measurement. */
function NewOrder({ onClose }) {
  const { picked, add, drop, take } = usePicked()
  const [customer, setCustomer] = useState(null)
  // The live camera, open over the sheet while photographing.
  const [cam, setCam] = useState(false)
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
        <b className="sheettitle">New visit order</b>
        <p>Photograph the visit order. It goes to the workshop, to visit and measure.</p>
        <PhotoInputs camera={camera} gallery={gallery} onFiles={add} />
        {cam && <Camera title="Visit order" onUse={add} onClose={() => setCam(false)} onFallback={() => camera.current?.click()} />}
        <Picked picked={picked} onDrop={drop} />
        <div className="pickrow">
          <button type="button" className="pick" onClick={() => setCam(true)}><CameraIcon /> Take photo</button>
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
  const setCustomer = useMutation(api.workshop.setCustomer).withOptimisticUpdate(atOnce.setCustomer)
  // The customer being chosen in the "Customer" sheet; undefined while it is shut.
  const [choosing, setChoosing] = useState(undefined)
  const { picked, add, drop, take } = usePicked()
  const [error, setError] = useState('')
  // This thread's replies still on their way: shown as sent from the moment Send is tapped.
  const outgoing = useOutbox().filter((item) => item.jobId === job.id)
  const [viewer, setViewer] = useState(null)
  // Who the job is for is on a card at the head of the chat (below); the
  // header opens the fuller window, which also says which box the job is in.
  const [info, setInfo] = useState(false)
  // The message about to be deleted, once a finger has been held on it.
  const [deleting, setDeleting] = useState(null)
  const holdToDelete = useHold(setDeleting)
  const camera = useRef(null)
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

  /**
   * What this side can add to the thread, from the three-lines button at the
   * foot. Never a typed line: each is photographs tagged with what they are,
   * or a marker (boards made, Complete, the go-ahead). `stage` is the step it
   * belongs to; one with none (the visit order) can be added at any time.
   */
  const ACTIONS = SIDE === 'workshop' ? [
    { id: 'measurement', label: 'Measurement', kind: 'photo', stage: 'measurement', say: 'Photograph the measurements' },
    { id: 'status', label: 'Work status', kind: 'boards', stage: 'assemble', say: 'How many boards are made' },
    { id: 'complete', label: 'Complete', kind: 'complete', stage: 'assemble', say: 'Assembling is finished' },
    { id: 'fitting', label: 'Fitting', kind: 'photo', stage: 'fitting', say: 'Photograph it fitted' },
  ] : [
    { id: 'visit', label: 'Visit order', kind: 'photo', stage: null, say: 'Add a photo of the visit order' },
    { id: 'quotation', label: 'Work order', kind: 'photo', stage: 'quotation', say: 'Attach the work order' },
    { id: 'goahead', label: 'Go-ahead', kind: 'goahead', stage: 'goahead', say: 'When to visit and whom to call' },
  ]
  const [menu, setMenu] = useState(false)
  // The live camera, open over the chat while a step is being photographed.
  const [cam, setCam] = useState(false)
  // The tag of the photos being taken, and the three small sheets.
  const [step, setStep] = useState(null)
  const [boardsOpen, setBoardsOpen] = useState(false)
  const [boards, setBoards] = useState(0)
  const [boardsToMake, setBoardsToMake] = useState('')
  const [completing, setCompleting] = useState(false)
  const [going, setGoing] = useState(null)
  const act = (action) => {
    setMenu(false)
    setError('')
    if (action.kind === 'photo') { setStep(action.id); setCam(true) }
    else if (action.kind === 'boards') { setBoards(job.boardsMade ?? 0); setBoardsOpen(true) }
    else if (action.kind === 'complete') setCompleting(true)
    else {
      // Tomorrow at ten unless a time is already set; the customer's first number.
      const at = new Date(job.visitAt ?? Date.now() + 86400000)
      if (!job.visitAt) at.setHours(10, 0, 0, 0)
      const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      setGoing({ when: local, phone: job.callPhone || contactsOf(job.phone)[0] || '' })
    }
  }
  // Each is sent at once: it shows in the thread while it goes up behind (the outbox).
  const sendPhotos = () => {
    if (!picked.length || !step) return
    const photos = take()
    const n = Number(boardsToMake)
    post({ jobId: job.id, step, files: photos.map((p) => p.file), previews: photos.map((p) => p.url), ...(step === 'quotation' && boardsToMake !== '' && n >= 0 ? { boards: n } : {}) })
    setBoardsToMake('')
    setError('')
  }
  const sendBoards = () => { post({ jobId: job.id, step: 'assemble', boards }); setBoardsOpen(false) }
  const sendComplete = () => { post({ jobId: job.id, step: 'assemble', complete: true }); setCompleting(false) }
  const sendGoAhead = () => {
    const visitAt = new Date(going.when).getTime()
    if (!visitAt || contactsOf(going.phone).length !== 1) return
    post({ jobId: job.id, step: 'goahead', visitAt, callPhone: contactsOf(going.phone)[0] })
    setGoing(null)
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
  // What the foot of the chat says is waiting, in the reader's own words.
  const at = stageId(job)
  const waitingFor = finished(job) ? 'Finished'
    : SIDE === 'workshop' ? {
      measurement: 'To measure. Tap the lines, then Measurement',
      quotation: 'With the shop: the work order is being made',
      assemble: 'Assembling. Tap the lines for work status or Complete',
      goahead: 'Complete. Waiting for the shop\'s go-ahead',
      fitting: 'Go-ahead given. Tap the lines, then Fitting, once fitted',
    }[at] : {
      measurement: 'With the workshop: to measure',
      quotation: 'Measured. Tap the lines, then Work order',
      assemble: 'With the workshop: being assembled',
      goahead: 'Complete. Call the customer, then tap the lines for the go-ahead',
      fitting: 'With the workshop: to fit',
    }[at]

  return (
    <div className="app chat">
      <header className="top chathead">
        <button type="button" className="back" onClick={onBack} aria-label="Back">‹</button>
        <span className="avatar small">{first ? <Shot url={first.url} width={SMALL} alt="" /> : titleOf(job)[0]?.toUpperCase()}</span>
        <button type="button" className="who" onClick={() => setInfo(true)} aria-label={`${titleOf(job)}: customer details`}>
          <b>{titleOf(job)}</b>
          <small>{[job.title ? `Work order ${job.number}` : '', job.place, standing].filter(Boolean).join(' · ')}</small>
        </button>
        {contactsOf(job.phone)[0] && <a className="call" href={`tel:${contactsOf(job.phone)[0]}`} aria-label={`Call ${titleOf(job)}`}><PhoneIcon /></a>}
      </header>
      {/* Who it is for, always in view at the head of the chat: the name, where
          they are, every number to ring, and the site on the map once a job
          carries one. At the counter it is also where the customer is set. */}
      {(job.title || job.phone || SIDE === 'shop') && (
        <section className="custcard" aria-label="Customer">
          {job.title && (
            <div className="names">
              <b>{nameOf(job)}</b>
              {addressOf(job) && <small>{addressOf(job)}</small>}
            </div>
          )}
          <div className="links">
            {contactsOf(job.phone).map((number) => (
              <a key={number} href={`tel:${number}`} aria-label={`Call ${number}`}><PhoneIcon size={16} />{number}</a>
            ))}
            {mapLinkOf(job) && <a href={mapLinkOf(job)} target="_blank" rel="noreferrer"><PinIcon size={16} />Map</a>}
            {SIDE === 'shop' && (
              <button type="button" onClick={() => setChoosing(job.ledgerId ? { ledgerId: job.ledgerId, name: job.title, place: job.place, phone: job.phone } : job.title ? { name: job.title } : null)}>
                <PersonIcon size={16} />{job.title ? 'Change' : 'Set customer'}
              </button>
            )}
          </div>
          {(job.boardsTotal != null || job.boardsMade != null || job.visitAt) && (
            <div className="facts">
              {(job.boardsTotal != null || job.boardsMade != null) && <span>{job.boardsMade != null ? boardsLine(job.boardsMade, job.boardsTotal) : `${job.boardsTotal} boards to make`}</span>}
              {job.visitAt && <span>Visit {visitLine(job.visitAt)}</span>}
              {job.visitAt && job.callPhone && <a href={`tel:${job.callPhone}`}><PhoneIcon size={14} />Call {job.callPhone}</a>}
            </div>
          )}
        </section>
      )}

      <main className="thread">
        {items.map((it) => {
          if (it.day) return <div key={it.key} className="daytag"><span>{it.day}</span></div>
          const m = it.m
          const mine = m.from === SIDE
          return (
            <div key={it.key} className={`bubble holdable ${mine ? 'right' : 'left'}`} {...holdToDelete(m)}>
              <div className="kind step">{TAGS[m.step] ?? (m.from === 'workshop' && m.photos.length ? 'Measurement' : SIDE_NAME[m.from])}</div>
              {m.photos.length > 0 && (
                <div className={`shots n${Math.min(m.photos.length, 3)}`}>
                  {m.photos.map((p) => (
                    <button key={p.storageId} type="button" onClick={() => openPhoto(p.storageId)}>
                      <Shot url={p.url} width={BUBBLE} alt={TAGS[m.step] ?? 'Photo'} loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
              {m.complete && <div className="marker ok"><TickIcon size={20} /> Assembling complete</div>}
              {m.boards != null && m.step === 'quotation' && <div className="marker small">{m.boards} boards to make</div>}
              {m.boards != null && m.step !== 'quotation' && <div className="marker"><b>{m.boards}</b>{job.boardsTotal ? ` of ${job.boardsTotal}` : ''} boards made</div>}
              {m.visitAt && (
                <div className="marker goahead">
                  <span>Visit: <b>{visitLine(m.visitAt)}</b></span>
                  {m.callPhone && <a href={`tel:${m.callPhone}`}><PhoneIcon size={16} />Call {m.callPhone}</a>}
                </div>
              )}
              {/* A line typed before threads became tags only. */}
              {m.text && <div className="text">{m.text}</div>}
              <div className="meta">{clock(m.at)}</div>
            </div>
          )
        })}
        {outgoing.map((item) => (
          <div key={item.id} className={`bubble right outgoing ${item.state}`}>
            <div className="kind step">{TAGS[item.step] ?? 'Photo'}</div>
            {item.previews.length > 0 && (
              <div className={`shots n${Math.min(item.previews.length, 3)}`}>
                {item.previews.map((url) => <span key={url}><img src={url} alt="" /></span>)}
              </div>
            )}
            {!item.previews.length && <div className="marker">{lineOf(item, job)}</div>}
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
        {!outgoing.length && !finished(job) && <p className="hint">{waitingFor}.</p>}
        <div ref={end} />
      </main>

      {/* The camera, live, for whichever step is being photographed. The
          file input under it is what it falls back to where no live camera
          can be had and, at the counter, how a picture already on the phone
          is attached. */}
      {cam && (
        <Camera title={TAGS[step] ?? 'Photo'} onUse={add} onClose={() => setCam(false)}
          onFallback={() => camera.current?.click()}
          onGallery={SIDE === 'shop' ? () => camera.current?.click() : undefined} />
      )}
      {/* The foot of the chat: no line to type on either side. The three lines
          open what this side can add; photos being sent wait here with their
          tag. The workshop photographs with the camera, there and then; the
          shop may also pick a picture already on the phone. */}
      <footer className="composer">
        <input ref={camera} type="file" accept="image/*" hidden multiple={SIDE === 'shop'} {...(SIDE === 'workshop' ? { capture: 'environment' } : {})}
          onChange={(e) => { add(e.target.files); e.target.value = '' }} />
        <Picked picked={picked} onDrop={drop} />
        {picked.length > 0 && step === 'quotation' && (
          <label className="boardsask">
            Boards to make
            <input type="number" inputMode="numeric" min={0} max={999} placeholder="0" value={boardsToMake} onChange={(e) => setBoardsToMake(e.target.value)} />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {picked.length ? (
          <div className="row">
            <button type="button" className="tool" onClick={() => setCam(true)} aria-label="Add another photo"><CameraIcon /></button>
            <button type="button" className="go grow" onClick={sendPhotos}><SendIcon /> Send: {TAGS[step] ?? 'photo'}</button>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="tool menu" onClick={() => setMenu(true)} aria-label="What to add"><MenuIcon /></button>
            <span className="now">{waitingFor}</span>
          </div>
        )}
      </footer>

      {menu && (
        <div className="sheetback" onClick={() => setMenu(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="What to add" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">What is done?</b>
            <ul className="steps">
              {ACTIONS.map((a) => {
                // Before its step, at it, or after it. The visit order has no step: any time.
                const past = a.stage != null && (finished(job) || stageNo(a.stage) < stageNo(at))
                const current = a.stage != null && !finished(job) && a.stage === at
                const open = !finished(job) && (a.stage == null || current || (past && a.kind === 'photo') || (a.kind === 'goahead' && at === 'fitting'))
                const note = current ? a.say
                  : a.stage == null ? a.say
                  : past ? (a.kind === 'photo' ? 'Done. Tap to add another photo' : a.kind === 'goahead' && open ? 'Given. Tap to change it' : 'Done')
                  : `After ${STAGES[stageNo(a.stage) - 1]?.label.toLowerCase() ?? 'the step before'}`
                return (
                  <li key={a.id}>
                    <button type="button" className={current ? 'now' : past ? 'done' : ''} disabled={!open} onClick={() => act(a)}>
                      <span className="mark">{past ? <TickIcon size={18} /> : a.kind === 'photo' ? <CameraIcon size={18} /> : a.kind === 'goahead' ? <PhoneIcon size={18} /> : <TickIcon size={18} />}</span>
                      <span className="what"><b>{a.label}</b><small>{finished(job) ? 'Finished' : note}</small></span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setMenu(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {boardsOpen && (
        <div className="sheetback" onClick={() => setBoardsOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Work status" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">Work status</b>
            <p>How many boards are made so far{job.boardsTotal ? `, of ${job.boardsTotal}` : ''}?</p>
            <div className="stepper">
              <button type="button" onClick={() => setBoards((n) => Math.max(0, n - 1))} aria-label="One fewer">−</button>
              <input type="number" inputMode="numeric" min={0} max={999} value={boards} aria-label="Boards made"
                onChange={(e) => setBoards(Math.max(0, Math.min(999, Math.trunc(Number(e.target.value) || 0))))} onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => setBoards((n) => Math.min(999, n + 1))} aria-label="One more">+</button>
            </div>
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setBoardsOpen(false)}>Cancel</button>
              <button type="button" className="solid" onClick={sendBoards}>Send</button>
            </div>
          </div>
        </div>
      )}
      {completing && (
        <div className="sheetback" onClick={() => setCompleting(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Complete" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">Assembling complete?</b>
            <p>The shop is told. It will call the customer and send you the go-ahead: when to visit and whom to call.</p>
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setCompleting(false)}>Not yet</button>
              <button type="button" className="solid" onClick={sendComplete}>Complete</button>
            </div>
          </div>
        </div>
      )}
      {going && (
        <div className="sheetback" onClick={() => setGoing(null)}>
          <div className="sheet wide" role="dialog" aria-modal="true" aria-label="Go-ahead" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">Go-ahead to the workshop</b>
            <p>After calling the customer: when to visit, and whom to call.</p>
            <label className="asklabel">When to visit
              <input className="field" type="datetime-local" value={going.when} onChange={(e) => setGoing({ ...going, when: e.target.value })} />
            </label>
            <span className="asklabel">Whom to call</span>
            {contactsOf(job.phone).length > 0 && (
              <div className="chips">
                {contactsOf(job.phone).map((number) => (
                  <button key={number} type="button" className={contactsOf(going.phone)[0] === number ? 'on' : ''} onClick={() => setGoing({ ...going, phone: number })}>{number}</button>
                ))}
              </div>
            )}
            <input className="field" type="tel" inputMode="tel" placeholder="Phone number" value={going.phone} maxLength={16}
              onChange={(e) => setGoing({ ...going, phone: e.target.value.replace(/[^\d+\s-]/g, '') })} />
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setGoing(null)}>Cancel</button>
              <button type="button" className="solid" onClick={sendGoAhead} disabled={!going.when || contactsOf(going.phone).length !== 1}>Send go-ahead</button>
            </div>
          </div>
        </div>
      )}
      {viewer != null && viewer >= 0 && <Viewer photos={photos} start={viewer} title={titleOf(job)} onClose={() => window.history.back()} />}
      {info && (
        <div className="sheetback" onClick={() => setInfo(false)}>
          <div className="sheet customer" role="dialog" aria-modal="true" aria-label="Customer" onClick={(e) => e.stopPropagation()}>
            <span className="avatar big">{titleOf(job)[0]?.toUpperCase()}</span>
            <b className="fullname">{titleOf(job)}</b>
            <small className="sub">{[job.title ? `Work order ${job.number}` : '', job.place].filter(Boolean).join(' · ')}</small>
            {contactsOf(job.phone).length > 0 ? (
              <ul className="contacts">
                {contactsOf(job.phone).map((number) => (
                  <li key={number}><a href={`tel:${number}`}><PhoneIcon size={20} /><span>{number}</span><em>Call</em></a></li>
                ))}
              </ul>
            ) : (
              <p className="none">{job.ledgerId ? 'No phone number is saved for this customer in the panel.' : 'No customer account is attached to this order.'}</p>
            )}
            {mapLinkOf(job) && (
              <a className="maplink" href={mapLinkOf(job)} target="_blank" rel="noreferrer"><PinIcon size={20} /><span>Site location</span><em>Open map</em></a>
            )}
            <div className="sheetbtns">
              {SIDE === 'shop' && (
                <button type="button" className="ghost" onClick={() => { setInfo(false); setChoosing(job.ledgerId ? { ledgerId: job.ledgerId, name: job.title, place: job.place, phone: job.phone } : job.title ? { name: job.title } : null) }}>Change</button>
              )}
              <button type="button" className="solid" onClick={() => setInfo(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
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
        <DeleteSheet title="Delete this message?" onClose={() => setDeleting(null)} run={(pin) => removeMessage({ jobId: job.id, messageId: deleting.id, pin })}>
          {SIDE_NAME[deleting.from]}, {clock(deleting.at)}{deleting.photos.length ? ` · ${deleting.photos.length} ${deleting.photos.length === 1 ? 'photo' : 'photos'}` : ''}
          <br />It is removed for both sides, for good.{job.messages.length === 1 ? ' It is the only message here, so the work order goes with it.' : ''}
        </DeleteSheet>
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
