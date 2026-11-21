import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { SIDE, SIDE_NAME } from './side.js'
import { BUBBLE } from './offline.js'
import {
  DONE, TAGS, TAG_FROM, addressOf, api, contactsOf, finished, lineOf, mapLinkOf, myTurn, nameOf, needsOf, newIn,
  said, stageAt, stageId, stampOf, titleOf, visitLine, visitsOf,
} from './flow.js'
import { atOnce, deliver, discard, post, useOutbox } from './outbox.js'
import {
  BackIcon, BoxIcon, CameraIcon, ClockIcon, CloseIcon, DeleteSheet, FlagIcon, PersonIcon, PhoneIcon, PhotosIcon, Picked, Pieces, PinIcon,
  SendIcon, Sheet, SheetIcon, Shot, StepTracker, TickIcon, useHold, usePicked,
} from './ui.jsx'
import { CustomerPicker, customerArgs } from './NewOrder.jsx'
import Camera from './Camera.jsx'
import Viewer from './Viewer.jsx'
import MakeOrder, { whoOf } from './MakeOrder.jsx'
import { PadSheet, PrintPads, copyOf } from './pad/PadSheet.jsx'
import { SlipSheet } from './pad/VisitSlip.jsx'
import { PrintSlipButton } from './pad/PrintSlipButton.jsx'

/** The steps as they are listed down the page, the latest first; the visit order is where a job begins. */
const DOWN = ['fitting', 'goahead', 'arrived', 'ordered', 'assemble', 'quotation', 'measurement', 'visit']
/** Something sent before everything was tagged: read by who sent it. */
const whenDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const tagOf = (m) => m.step ?? (m.from === 'workshop' ? 'measurement' : 'visit')
/** Whether a message marks something besides its photographs, so it stays when they are all deleted (removePhoto). */
const marksOf = (m) => !!(m.text || m.boards != null || m.pad || m.slip || m.assemble != null || m.order != null || m.complete || m.ordered || m.arrived || m.visitAt)

/**
 * One job, as a page built around its steps.
 *
 * At the head, where the job stands among its five steps, a sign each. Under
 * it the step in hand, as one panel: blue with this side's work in it when the
 * step is its turn (the measurements, the work order, the count of pieces, the
 * go-ahead, the fitting), yellow and saying who it is with when it is not.
 * A job is made asking the workshop to assemble it, the shop to order it in
 * from a supplier, or both (NewOrder); with both, the third step is each side's at once,
 * the workshop's Complete and the shop's Arrived, and the go-ahead waits for
 * the two.
 * Then who it is for, and everything sent so far, step by step with the latest
 * first. The one action of the step is a single button at the foot of the
 * screen, always in the same place under the thumb.
 *
 * Nothing is typed as free text and no step is picked: the books move a job
 * on when its step is done (convex/workshop.ts `send`), and a step that is
 * done is closed.
 */
export default function JobPage({ job, onBack }) {
  const seen = useMutation(api.workshop.seen).withOptimisticUpdate(atOnce.seen)
  const removeMessage = useMutation(api.workshop.removeMessage).withOptimisticUpdate(atOnce.removeMessage)
  const removePhoto = useMutation(api.workshop.removePhoto).withOptimisticUpdate(atOnce.removePhoto)
  const setCustomer = useMutation(api.workshop.setCustomer).withOptimisticUpdate(atOnce.setCustomer)
  const setPriority = useMutation(api.workshop.setPriority).withOptimisticUpdate(atOnce.setPriority)
  const setNeeds = useMutation(api.workshop.setNeeds).withOptimisticUpdate(atOnce.setNeeds)
  const { picked, add, drop, take } = usePicked()
  const [error, setError] = useState('')
  // What this phone has sent for the job and is still on its way: shown in its step at once.
  const outgoing = useOutbox().filter((item) => item.jobId === job.id)
  const at = stageId(job)
  const mine = myTurn(job)
  const over = finished(job)
  const needs = needsOf(job)

  // With the job on screen, what the other side sent is no longer new.
  const news = newIn(job)
  useEffect(() => {
    if (news > 0 && document.visibilityState === 'visible') void seen({ jobId: job.id, side: SIDE }).catch(() => {})
  }, [news, job.id, seen])

  // A photo opens over the page; the phone's Back closes it.
  const [viewer, setViewer] = useState(null)
  const photos = useMemo(() => job.messages.flatMap((m) => m.photos), [job.messages])
  const openPhoto = (storageId) => {
    window.history.pushState({ job: job.id, photo: true }, '')
    setViewer(photos.findIndex((p) => p.storageId === storageId))
  }
  // The work order made on the app opens over the page as its own screen, and
  // a pad sent opens large; the phone's Back closes either.
  const [makingPad, setMakingPad] = useState(false)
  const [padOpen, setPadOpen] = useState(null)
  const [printPad, setPrintPad] = useState(null)
  const openOver = (what, set) => { window.history.pushState({ job: job.id, [what]: true }, ''); set() }
  useEffect(() => {
    const onPop = (e) => {
      if (!e.state?.photo) setViewer(null)
      if (!e.state?.pad) setMakingPad(false)
      if (!e.state?.padview) setPadOpen(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // What was sent and is about to be deleted, once a finger has been held on it:
  // the whole message, or held on one photograph (`photo`), that one only.
  const [deleting, setDeleting] = useState(null)
  const holdToDelete = useHold(setDeleting)
  /** On a photograph: held, it is the one to delete, not the message around it. */
  const holdPhoto = (m, photo) => {
    const hold = holdToDelete({ ...m, photo })
    return { ...hold, onPointerDown: (e) => { e.stopPropagation(); hold.onPointerDown(e) } }
  }
  // The customer being chosen in the "Customer" sheet; undefined while it is shut.
  const [choosing, setChoosing] = useState(undefined)
  const saveCustomer = () => { const args = customerArgs(choosing); setChoosing(undefined); setCustomer({ jobId: job.id, ...args }).catch((err) => setError(said(err))) }

  /* ── photographing a step ───────────────────────────────────────────────── */
  // The tag of the photos being taken, and the live camera open over the page.
  const [step, setStep] = useState(null)
  const [cam, setCam] = useState(false)
  // The camera's way out where no live one can be had and, at the counter, a picture already on the phone.
  const file = useRef(null)
  const [boardsToMake, setBoardsToMake] = useState('')
  const shoot = (tag) => { setError(''); setStep(tag); setCam(true) }
  const fromPhone = (tag) => { setError(''); setStep(tag); file.current?.click() }
  // Sent at once: it shows in its step while it goes up behind (the outbox).
  const sendPhotos = () => {
    if (!picked.length || !step) return
    const shots = take()
    const n = Number(boardsToMake)
    post({
      jobId: job.id, step, files: shots.map((p) => p.file), previews: shots.map((p) => p.url),
      ...(step === 'quotation' && needs.assemble && boardsToMake !== '' && n >= 0 ? { boards: n } : {}),
    })
    setBoardsToMake('')
  }
  /**
   * A step done with a photo. In the panel: what has been shot, waiting to be
   * sent under its tag, and at the counter the way to a picture already on the
   * phone. The camera and the sending are the button at the foot (`dock`).
   */
  const tray = (tag, { gallery = false, camera = '' } = {}) => (picked.length && step === tag ? (
    <>
      <Picked picked={picked} onDrop={drop} />
      {tag === 'quotation' && needs.assemble && (
        <label className="ask inline">
          Pieces to make
          <input type="number" inputMode="numeric" min={0} max={999} placeholder="0" value={boardsToMake} onChange={(e) => setBoardsToMake(e.target.value)} />
        </label>
      )}
      <button type="button" className="key ghost" onClick={() => setCam(true)}><CameraIcon /> Another photo</button>
    </>
  ) : (
    <>
      {camera && <button type="button" className="key ghost" onClick={() => shoot(tag)}><CameraIcon /> {camera}</button>}
      {gallery && <button type="button" className="key ghost" onClick={() => fromPhone(tag)}><PhotosIcon /> {gallery === true ? 'Choose from the phone' : gallery}</button>}
    </>
  ))
  /** The button at the foot for a photo step: the camera, then Send once something is shot. */
  const photoKey = (tag, label) => (picked.length && step === tag
    ? { label: `Send ${TAGS[tag].toLowerCase()}`, Icon: SendIcon, run: sendPhotos, tone: 'safe' }
    : label ? { label, Icon: CameraIcon, run: () => shoot(tag), tone: 'must' } : null)

  /* ── the work status, while assembling ──────────────────────────────────── */
  /**
   * Plus for each piece made, minus to correct. Nothing else to tap: the
   * figure is sent by itself a moment after the last tap, so four pieces in a
   * row are one line in the log, not four.
   */
  const [tally, setTally] = useState(null)
  const tallyTimer = useRef(0)
  const tallyNow = useRef(null)
  const sendTally = () => {
    clearTimeout(tallyTimer.current)
    const n = tallyNow.current
    tallyNow.current = null
    if (n != null && n !== (job.boardsMade ?? 0)) post({ jobId: job.id, step: 'assemble', boards: n })
  }
  const bump = (by) => {
    const next = Math.max(0, Math.min(999, (tally ?? job.boardsMade ?? 0) + by))
    setTally(next)
    tallyNow.current = next
    clearTimeout(tallyTimer.current)
    tallyTimer.current = setTimeout(sendTally, 1300)
  }
  // Once the books say the same figure, the tapped one has landed.
  useEffect(() => { if (tally != null && tallyNow.current == null && job.boardsMade === tally) setTally(null) }, [job.boardsMade, tally])
  // Leaving the page with a figure tapped and not yet sent: it is sent on the way out.
  const flushTally = useRef(sendTally)
  flushTally.current = sendTally
  useEffect(() => () => flushTally.current(), [])
  const tallied = tally ?? job.boardsMade ?? 0
  const [completing, setCompleting] = useState(false)
  // Complete ends the workshop's step in hand: measuring, assembling or fitting.
  const sendComplete = () => { post({ jobId: job.id, step: at, complete: true }); setCompleting(false) }

  /* ── visits ─────────────────────────────────────────────────────────────── */
  // Measuring and fitting can take more than one visit, as many as the
  // workshop needs: each visit's photos, then Measuring done or Fitting done.
  const measured = visitsOf(job, 'measurement')
  const fitted = visitsOf(job, 'fitting')
  const visitsLine = (n) => (n ? `${n} ${n === 1 ? 'visit' : 'visits'} so far.` : '')
  /** The workshop's key at a visit step: the camera, Send once shot, and Done once a visit is in. */
  const visitKey = (tag, label, count) => (picked.length && step === tag ? photoKey(tag, '')
    : count ? { label: DONE[tag], Icon: TickIcon, run: () => setCompleting(true), tone: 'safe' }
    : photoKey(tag, label))

  /* ── what was ordered in, at the counter ────────────────────────────────── */
  // Ordered, with the screenshot of the order sent to the supplier if one was chosen.
  // Without one it is asked first, as nothing else stands between a tap and the step.
  const [ordering, setOrdering] = useState(false)
  const orderProof = picked.length > 0 && step === 'ordered'
  const sendOrdered = () => {
    const shots = orderProof ? take() : []
    post({ jobId: job.id, step: 'ordered', ordered: true, files: shots.map((p) => p.file), previews: shots.map((p) => p.url) })
    setOrdering(false)
  }
  // Arrived, with the supplier's bill or challan if it was photographed.
  const [arriving, setArriving] = useState(false)
  const proof = picked.length > 0 && step === 'arrived'
  const sendArrived = () => {
    const shots = proof ? take() : []
    post({ jobId: job.id, step: 'arrived', arrived: true, files: shots.map((p) => p.file), previews: shots.map((p) => p.url) })
    setArriving(false)
  }
  /** What was asked for and is done, said before the go-ahead. */
  const ready = needs.assemble && needs.order ? 'Assembled, and the ordered items are in.' : needs.order ? 'The ordered items are in.' : 'Assembled.'

  /* ── the go-ahead ───────────────────────────────────────────────────────── */
  // Tomorrow at ten until the counter says otherwise, and the customer's first number.
  const [going, setGoing] = useState(() => {
    const when = new Date(Date.now() + 86400000)
    when.setHours(10, 0, 0, 0)
    return { when: new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16), phone: contactsOf(job.phone)[0] || '' }
  })
  const goReady = !!going.when && contactsOf(going.phone).length === 1
  const sendGoAhead = () => {
    const visitAt = new Date(going.when).getTime()
    if (!visitAt || !goReady) return
    post({ jobId: job.id, step: 'goahead', visitAt, callPhone: contactsOf(going.phone)[0] })
  }
  /** When to go and whom to ring, once the go-ahead is given. */
  const visit = job.visitAt ? (
    <div className="visit">
      <span><ClockIcon size={22} /><b>{visitLine(job.visitAt)}</b></span>
      {job.callPhone && <a className="key must" href={`tel:${job.callPhone}`}><PhoneIcon size={20} /> {job.callPhone}</a>}
    </div>
  ) : null

  /* ── the step in hand ───────────────────────────────────────────────────── */
  const other = SIDE === 'shop' ? 'workshop' : 'shop'
  const head = (title, lead) => (
    <div className="nowhead">
      <b>{title}</b>
      <small>{mine ? 'Yours to do' : `With the ${other}`}</small>
      {lead && <p>{lead}</p>}
    </div>
  )
  /** The pieces made, as a figure on a plate; with its two keys where it is this side's to count. */
  const counter = (made, keys) => (
    <>
      <div className={`counter ${keys ? '' : 'read'}`}>
        {keys && <button type="button" className="less" onClick={() => bump(-1)} disabled={made <= 0} aria-label="One piece fewer">−</button>}
        <span className="figure" aria-live="polite"><b>{made}{job.boardsTotal ? <small>/{job.boardsTotal}</small> : null}</b><small>{made === 1 && !job.boardsTotal ? 'Piece made' : 'Pieces made'}</small></span>
        {keys && <button type="button" className="more" onClick={() => bump(1)} aria-label="One more piece made">+</button>}
      </div>
      <Pieces made={made} total={job.boardsTotal} big />
    </>
  )
  const now = over ? (
    <div className="nowhead"><b>Finished</b><small>All 5 steps done</small></div>
  ) : SIDE === 'workshop' ? {
    measurement: <>{head('Measure', visitsLine(measured.count))}{tray('measurement', { camera: measured.count ? 'Photograph another visit' : '' })}</>,
    quotation: head('Work order', 'The shop is making the work order from your measurements.'),
    assemble: needs.assembling
      ? <>{head('Assemble', needs.order ? (job.arrived ? 'The ordered items are in at the shop.' : 'The shop is ordering items for this job too.') : '')}{counter(tallied, true)}</>
      : needs.assemble
        ? <>{head('Assembled', 'The shop is waiting for the ordered items. The go-ahead comes once they are in.')}{counter(job.boardsMade ?? 0, false)}</>
        : head('Order in', 'Nothing to assemble. The shop is ordering it in; it comes to you to fit.'),
    goahead: head('Go-ahead', `${ready} The shop calls the customer, then sends when to visit and whom to call.`),
    fitting: <>{head('Fit it', visitsLine(fitted.count))}{visit}{tray('fitting', { camera: fitted.count ? 'Photograph another visit' : '' })}</>,
  }[at] : {
    measurement: <>{head('Measurement', visitsLine(measured.count) || 'The workshop is to visit the site and measure.')}{tray('visit', { gallery: true, camera: 'Add a visit order photo' })}</>,
    quotation: (
      <>
        {head('Work order', picked.length && step === 'quotation' ? '' : 'Make it on the app, or photograph the paper one.')}
        {!(picked.length && step === 'quotation') && (
          <button type="button" className="key ghost" onClick={() => openOver('pad', () => setMakingPad(true))}><SheetIcon /> Make it on the app</button>
        )}
        {tray('quotation', { gallery: true })}
      </>
    ),
    assemble: (
      <>
        {head(stageAt(job).label, needs.toOrder ? 'Order it from the supplier on WhatsApp, then mark it ordered.'
          : needs.ordering ? 'Ordered. Mark it arrived when it comes in.' : '')}
        {needs.assemble && (job.assembled
          ? <p className="mark ok"><TickIcon size={18} /> Assembling complete</p>
          : job.boardsMade != null ? counter(job.boardsMade, false) : <p className="mark">Assembling: nothing counted yet.</p>)}
        {needs.order && job.ordered && <p className="mark ok"><TickIcon size={18} /> Ordered</p>}
        {needs.order && !needs.ordering && <p className="mark ok"><TickIcon size={18} /> Ordered items arrived</p>}
        {needs.toOrder ? tray('ordered', { gallery: 'Add WhatsApp screenshot' }) : needs.ordering && tray('arrived', { gallery: true, camera: 'Photograph bill or challan' })}
      </>
    ),
    goahead: (
      <>
        {head('Go-ahead', `${ready} Call the customer, then say when to visit and whom to call.`)}
        <label className="ask">When to visit
          <input type="datetime-local" value={going.when} onChange={(e) => setGoing({ ...going, when: e.target.value })} />
        </label>
        <span className="ask">Whom to call</span>
        {contactsOf(job.phone).length > 0 && (
          <div className="chips">
            {contactsOf(job.phone).map((number) => (
              <button key={number} type="button" className={contactsOf(going.phone)[0] === number ? 'on' : ''} aria-pressed={contactsOf(going.phone)[0] === number} onClick={() => setGoing({ ...going, phone: number })}>{number}</button>
            ))}
          </div>
        )}
        <input className="field" type="tel" inputMode="tel" maxLength={16} aria-label="Another number to call"
          placeholder={contactsOf(job.phone).length ? 'Or another number' : 'Phone number'}
          value={contactsOf(job.phone).includes(contactsOf(going.phone)[0]) ? '' : going.phone}
          onChange={(e) => setGoing({ ...going, phone: e.target.value.replace(/[^\d+\s-]/g, '') })} />
      </>
    ),
    fitting: <>{head('Fitting', visitsLine(fitted.count) || 'The workshop is to fit it.')}{visit}</>,
  }[at]

  /* ── the one button at the foot ─────────────────────────────────────────── */
  const dock = over ? null : SIDE === 'workshop' ? {
    measurement: visitKey('measurement', 'Photograph measurements', measured.count),
    assemble: needs.assembling ? { label: 'Complete', Icon: TickIcon, run: () => { sendTally(); setCompleting(true) }, tone: 'safe' } : null,
    fitting: visitKey('fitting', 'Photograph it fitted', fitted.count),
  }[at] : {
    measurement: photoKey('visit', ''),
    quotation: photoKey('quotation', 'Photograph work order'),
    assemble: !needs.ordering ? null
      : needs.toOrder ? (orderProof
        ? { label: 'Send ordered', Icon: SendIcon, run: sendOrdered, tone: 'safe' }
        : { label: 'Ordered', Icon: TickIcon, run: () => setOrdering(true), tone: 'safe' })
      : { label: 'Arrived', Icon: TickIcon, run: () => setArriving(true), tone: 'safe' },
    goahead: { label: 'Send go-ahead', Icon: SendIcon, run: sendGoAhead, tone: 'safe', off: !goReady },
  }[at]

  /* ── everything sent so far, step by step ───────────────────────────────── */
  const sections = DOWN.map((tag) => ({
    tag,
    // What is still on its way is in the job (outbox.js `ahead`) and shown as sending, below.
    items: job.messages.filter((m) => !m.pending && tagOf(m) === tag),
    pending: outgoing.filter((item) => (item.step ?? 'visit') === tag),
  })).filter((s) => s.items.length || s.pending.length)

  const contacts = contactsOf(job.phone)
  // The account's own phone, without the numbers added on the job, which the sheet lists to change.
  const phones = job.phones ?? []
  const customerNow = job.ledgerId ? { ledgerId: job.ledgerId, name: job.title, place: job.place, phone: contacts.filter((n) => !phones.includes(n)).join(', '), phones }
    : job.title || phones.length ? { name: job.title, phones } : null

  /** One step's section: what was sent under its tag, and what is still on its way. */
  const sectionOf = ({ tag, items, pending }) => {
    const latest = items[items.length - 1]
      const visits = visitsOf(job, tag)
      return (
        <section key={tag} className="stepsec" aria-label={TAGS[tag]}>
          <header>
            <b>{TAGS[tag]}</b>
            <small>{SIDE_NAME[TAG_FROM[tag]]}{latest ? ` · ${stampOf(latest.at)}` : ''}</small>
          </header>
          {items.map((m, i) => (
            <div key={m.id} className="entry holdable" {...holdToDelete(m)}>
              {/* Where a step took more than one visit, each visit's photos under its number. */}
              {visits.count > 1 && visits.of[m.id] && visits.of[m.id] !== visits.of[items[i - 1]?.id] && (
                <p className="mark visitno">Visit {visits.of[m.id]} <time>{whenDay(m.at)}</time></p>
              )}
              {m.photos.length > 0 && (
                <div className="shots">
                  {m.photos.map((p) => (
                    <button key={p.storageId} type="button" onClick={() => openPhoto(p.storageId)} {...holdPhoto(m, p.storageId)}>
                      <Shot url={p.url} width={BUBBLE} alt={TAGS[tag]} loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
              {/* A visit order made on the app: the letterhead slip; tapped, it opens large. */}
              {m.slip && (
                <>
                  <button type="button" className="padthumb" onClick={() => openOver('padview', () => setPadOpen({ slip: m.slip }))} aria-label="Open the visit order">
                    <SlipSheet number={job.number} who={whoOf(job)} slip={m.slip} />
                  </button>
                  {SIDE === 'shop' && (
                    <PrintSlipButton number={job.number} who={whoOf(job)} slip={m.slip} />
                  )}
                </>
              )}
              {/* A work order made on the app: its yellow copy, the workshop's; tapped, it opens large. */}
              {m.pad && (
                <>
                  <button type="button" className="padthumb" onClick={() => openOver('padview', () => setPadOpen(m.pad))} aria-label="Open the work order">
                    <PadSheet copy={copyOf('workshop')} number={job.number} who={whoOf(job)} pad={m.pad} />
                  </button>
                  {SIDE === 'shop' && (
                    <button type="button" className="key ghost" onClick={() => setPrintPad(m.pad)}><SheetIcon /> Print 3 pages</button>
                  )}
                </>
              )}
              {m.complete && <p className="mark ok"><TickIcon size={18} /> {DONE[tag] ?? 'Complete'} <time>{stampOf(m.at)}</time></p>}
              {m.ordered && <p className="mark ok"><TickIcon size={18} /> Ordered <time>{stampOf(m.at)}</time></p>}
              {tag === 'quotation' && (m.assemble != null || m.order != null) && (
                <p className="mark">{[m.assemble && 'Assemble', m.order && 'Order in'].filter(Boolean).join(' + ')}</p>
              )}
              {m.boards != null && tag === 'quotation' && <p className="mark"><b>{m.boards}</b> {m.boards === 1 ? 'piece' : 'pieces'} to make</p>}
              {m.arrived && <p className="mark ok"><TickIcon size={18} /> Ordered items arrived <time>{stampOf(m.at)}</time></p>}
              {m.boards != null && tag !== 'quotation' && <p className="mark"><b>{m.boards}</b>{job.boardsTotal ? ` of ${job.boardsTotal}` : ''} {m.boards === 1 && !job.boardsTotal ? 'piece' : 'pieces'} made <time>{stampOf(m.at)}</time></p>}
              {m.visitAt && (
                <p className="mark">Visit <b>{visitLine(m.visitAt)}</b>{m.callPhone && <a href={`tel:${m.callPhone}`}><PhoneIcon size={15} /> {m.callPhone}</a>}</p>
              )}
              {/* A line typed before jobs became tags only. */}
              {m.text && <p className="mark">{m.text}</p>}
            </div>
          ))}
          {pending.map((item) => (
            <div key={item.id} className={`entry pending ${item.state}`}>
              {item.previews.length > 0 && (
                <div className="shots">{item.previews.map((url) => <span key={url}><img src={url} alt="" /></span>)}</div>
              )}
              {!item.previews.length && <p className="mark">{lineOf(item, job)}</p>}
              {item.state === 'failed' ? (
                <p className="state bad">
                  {item.refused
                    ? <span>Not sent. {item.error}</span>
                    : <button type="button" onClick={() => void deliver(item)}>Not sent. Tap to try again</button>}
                  <button type="button" className="x" onClick={() => discard(item)} aria-label="Do not send this"><CloseIcon size={14} /></button>
                </p>
              ) : (
                <p className="state">Sending <span className="spin tiny" /></p>
              )}
            </div>
          ))}
        </section>
      )
  }

  if (makingPad && SIDE === 'shop' && at === 'quotation' && !over) return <MakeOrder job={job} onClose={() => window.history.back()} />

  return (
    <div className="app page">
      <header className="pagehead">
        <button type="button" className="back" onClick={onBack} aria-label="Back to the list"><BackIcon /></button>
        <div className="who">
          <b>{nameOf(job)}</b>
          <small>{[addressOf(job), `Work order ${job.number}`].filter(Boolean).join(' · ')}</small>
        </div>
        {contacts[0] && <a className="round" href={`tel:${contacts[0]}`} aria-label={`Call ${titleOf(job)}`}><PhoneIcon /></a>}
      </header>

      <main className="scroll">
        <StepTracker job={job} />
        {job.priority && !over && <p className="prio big"><FlagIcon size={20} strokeWidth="3" /> Priority</p>}

        {/* The visit order first: what the customer asked for, before anything else is done. */}
        {sections.filter((s) => s.tag === 'visit').map(sectionOf)}

        <section className={`nowpanel ${over ? 'over' : mine ? 'mine' : 'wait'}`} aria-label="What to do now">
          {now}
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        {/* Who it is for, a line each: every number to ring, the site on the map
            once a job carries one and, at the counter, where the customer is set. */}
        {(contacts.length > 0 || mapLinkOf(job) || SIDE === 'shop') && (
          <section className="rows" aria-label="Customer">
            {contacts.map((number, i) => (
              <a key={number} className="rowline" href={`tel:${number}`} aria-label={`Call ${number}`}>
                <span className="lbl">{i === 0 ? 'Customer' : `Number ${i + 1}`}</span><span className="val">{number}</span><span className="round"><PhoneIcon size={20} /></span>
              </a>
            ))}
            {mapLinkOf(job) && (
              <a className="rowline" href={mapLinkOf(job)} target="_blank" rel="noreferrer">
                <span className="lbl">Site</span><span className="val">Open the map</span><span className="round"><PinIcon size={20} /></span>
              </a>
            )}
            {SIDE === 'shop' && !over && (
              <button type="button" className="rowline" aria-pressed={job.priority} onClick={() => setPriority({ jobId: job.id, priority: !job.priority }).catch((err) => setError(said(err)))}>
                <span className="lbl">Priority</span><span className="val">{job.priority ? 'On' : 'Off'}</span><span className={`go ${job.priority ? 'on' : ''}`}><FlagIcon size={20} /></span>
              </button>
            )}
            {/* An assembly that turns out to need something bought in (a Sunmica
                sheet): Order in, switched on until the go-ahead, and off again
                until it is ordered. */}
            {SIDE === 'shop' && !over && ['measurement', 'quotation', 'assemble'].includes(at) && needs.assemble && (
              <button type="button" className="rowline" aria-pressed={needs.order} disabled={job.ordered}
                onClick={() => setNeeds({ jobId: job.id, assemble: true, order: !needs.order }).catch((err) => setError(said(err)))}>
                <span className="lbl">Order in</span><span className="val">{job.ordered ? 'Ordered' : needs.order ? 'On' : 'Off'}</span><span className={`go ${needs.order ? 'on' : ''}`}><BoxIcon size={20} /></span>
              </button>
            )}
            {SIDE === 'shop' && (
              <button type="button" className="rowline" onClick={() => setChoosing(customerNow)}>
                <span className="lbl">Account</span><span className="val">{job.title ? 'Change customer' : 'Set customer'}</span><span className="go"><PersonIcon size={20} /></span>
              </button>
            )}
          </section>
        )}

        {sections.filter((s) => s.tag !== 'visit').map(sectionOf)}
      </main>

      {dock && (
        <div className="dock">
          <button type="button" className={`key ${dock.tone}`} onClick={dock.run} disabled={dock.off}><dock.Icon size={26} strokeWidth="2.6" /> {dock.label}</button>
        </div>
      )}

      <input ref={file} type="file" accept="image/*" hidden multiple={SIDE === 'shop'} {...(SIDE === 'workshop' ? { capture: 'environment' } : {})}
        onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      {cam && (
        <Camera title={TAGS[step] ?? 'Photo'} onUse={add} onClose={() => setCam(false)}
          onFallback={() => file.current?.click()}
          onGallery={SIDE === 'shop' ? () => file.current?.click() : undefined} />
      )}
      {padOpen && (
        <div className="padview" role="dialog" aria-modal="true" aria-label="Work order">
          <header>
            <b>Work order {job.number}</b>
            <button type="button" className="round" onClick={() => window.history.back()} aria-label="Close"><CloseIcon /></button>
          </header>
          <div className="padviewin">
            {padOpen.slip
              ? <SlipSheet number={job.number} who={whoOf(job)} slip={padOpen.slip} fixedZoom={0.8} />
              : <PadSheet copy={copyOf('workshop')} number={job.number} who={whoOf(job)} pad={padOpen} fixedZoom={0.8} />}
          </div>
        </div>
      )}
      {printPad && <PrintPads number={job.number} who={whoOf(job)} pad={printPad} onDone={() => setPrintPad(null)} />}
      {viewer != null && viewer >= 0 && <Viewer photos={photos} start={viewer} title={titleOf(job)} onClose={() => window.history.back()} />}
      {completing && (
        <Sheet label="Complete" onClose={() => setCompleting(false)}>
          <b className="sheettitle">{DONE[at] ?? 'Complete'}?</b>
          <p>{at === 'measurement' ? `${visitsLine(measured.count)} The shop makes the work order from the measurements. No more visits to measure after this.`
            : at === 'fitting' ? `${visitsLine(fitted.count)} The job is finished. No more visits after this.`
            : needs.ordering ? 'The shop is told. The go-ahead waits for the ordered items to come in. This step cannot be gone back to.'
            : 'The shop is told, and sends the go-ahead after calling the customer. This step cannot be gone back to.'}</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setCompleting(false)}>Not yet</button>
            <button type="button" className="solid safe" onClick={sendComplete}>{DONE[at] ?? 'Complete'}</button>
          </div>
        </Sheet>
      )}
      {ordering && (
        <Sheet label="Ordered" onClose={() => setOrdering(false)}>
          <b className="sheettitle">Ordered?</b>
          <p>No screenshot with it. Arrived is next, when the items come in. This cannot be gone back to.</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setOrdering(false)}>Not yet</button>
            <button type="button" className="solid safe" onClick={sendOrdered}>Ordered</button>
          </div>
        </Sheet>
      )}
      {arriving && (
        <Sheet label="Arrived" onClose={() => setArriving(false)}>
          <b className="sheettitle">Ordered items arrived?</b>
          <p>{needs.assembling
            ? 'The workshop is told. The go-ahead waits for assembling to be complete.'
            : 'The go-ahead is next: call the customer.'} This cannot be gone back to.</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setArriving(false)}>Not yet</button>
            <button type="button" className="solid safe" onClick={sendArrived}>Arrived</button>
          </div>
        </Sheet>
      )}
      {choosing !== undefined && (
        <Sheet label="Customer" wide onClose={() => setChoosing(undefined)}>
          <b className="sheettitle">Who is this for?</b>
          <p>Pick the customer's account from the panel; the name, place and phone come with it. Add any more numbers to ring under it.</p>
          <CustomerPicker value={choosing} onChange={setChoosing} onDone={saveCustomer} autoFocus />
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setChoosing(undefined)}>Cancel</button>
            <button type="button" className="solid" onClick={saveCustomer}>Save</button>
          </div>
        </Sheet>
      )}
      {deleting && (deleting.photo ? (
        <DeleteSheet title="Delete this photo?" onClose={() => setDeleting(null)} run={(pin) => removePhoto({ jobId: job.id, messageId: deleting.id, photo: deleting.photo, pin })}>
          {TAGS[tagOf(deleting)]}, {stampOf(deleting.at)}{deleting.photos.length > 1 ? ` · photo ${deleting.photos.findIndex((p) => p.storageId === deleting.photo) + 1} of ${deleting.photos.length}` : ''}
          <br />It is removed for both sides, for good. The other photos stay, and the job stays at the step it has reached.{job.messages.length === 1 && deleting.photos.length === 1 && !marksOf(deleting) ? ' It is the only thing here, so the work order goes with it.' : ''}
        </DeleteSheet>
      ) : (
        <DeleteSheet title="Delete this?" onClose={() => setDeleting(null)} run={(pin) => removeMessage({ jobId: job.id, messageId: deleting.id, pin })}>
          {TAGS[tagOf(deleting)]}, {stampOf(deleting.at)}{deleting.photos.length ? ` · ${deleting.photos.length} ${deleting.photos.length === 1 ? 'photo' : 'photos'}` : ''}
          <br />It is removed for both sides, for good. The job stays at the step it has reached.{job.messages.length === 1 ? ' It is the only thing here, so the work order goes with it.' : ''}
        </DeleteSheet>
      ))}
    </div>
  )
}
