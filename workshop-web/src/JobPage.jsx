import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { SIDE, SIDE_NAME } from './side.js'
import { BUBBLE } from './offline.js'
import {
  TAGS, TAG_FROM, addressOf, api, contactsOf, finished, lineOf, mapLinkOf, myTurn, nameOf, needsOf, newIn,
  said, stageAt, stageId, stampOf, titleOf, visitLine,
} from './flow.js'
import { atOnce, deliver, discard, post, useOutbox } from './outbox.js'
import {
  BackIcon, CameraIcon, ClockIcon, CloseIcon, DeleteSheet, PersonIcon, PhoneIcon, PhotosIcon, Picked, Pieces, PinIcon,
  SendIcon, Sheet, Shot, StepTracker, TickIcon, useHold, usePicked,
} from './ui.jsx'
import { CustomerPicker, customerArgs } from './NewOrder.jsx'
import Camera from './Camera.jsx'
import Viewer from './Viewer.jsx'

/** The steps as they are listed down the page, the latest first; the visit order is where a job begins. */
const DOWN = ['fitting', 'goahead', 'arrived', 'assemble', 'quotation', 'measurement', 'visit']
/** What a work order can ask for, a tick each; either or both. */
const NEEDS = [['assemble', 'Assemble'], ['order', 'Order in']]
/** Something sent before everything was tagged: read by who sent it. */
const tagOf = (m) => m.step ?? (m.from === 'workshop' ? 'measurement' : 'visit')

/**
 * One job, as a page built around its steps.
 *
 * At the head, where the job stands among its five steps, a sign each. Under
 * it the step in hand, as one panel: blue with this side's work in it when the
 * step is its turn (the measurements, the work order, the count of pieces, the
 * go-ahead, the fitting), yellow and saying who it is with when it is not.
 * A work order is ticked for the workshop to assemble, the shop to order it in
 * from a supplier, or both; with both, the third step is each side's at once,
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
  const removeMessage = useMutation(api.workshop.removeMessage)
  const setCustomer = useMutation(api.workshop.setCustomer).withOptimisticUpdate(atOnce.setCustomer)
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
  useEffect(() => {
    const onPop = (e) => { if (!e.state?.photo) setViewer(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // What was sent and is about to be deleted, once a finger has been held on it.
  const [deleting, setDeleting] = useState(null)
  const holdToDelete = useHold(setDeleting)
  // The customer being chosen in the "Customer" sheet; undefined while it is shut.
  const [choosing, setChoosing] = useState(undefined)

  /* ── photographing a step ───────────────────────────────────────────────── */
  // The tag of the photos being taken, and the live camera open over the page.
  const [step, setStep] = useState(null)
  const [cam, setCam] = useState(false)
  // The camera's way out where no live one can be had and, at the counter, a picture already on the phone.
  const file = useRef(null)
  const [boardsToMake, setBoardsToMake] = useState('')
  // What the work order being sent asks for: assembling, until the counter ticks otherwise.
  const [asks, setAsks] = useState({ assemble: true, order: false })
  // Ticks a box, never leaving none ticked.
  const tickNeeds = (value, onPick) => (
    <div className="chips needs" role="group" aria-label="What this job needs">
      {NEEDS.map(([k, label]) => (
        <button key={k} type="button" className={value[k] ? 'on' : ''} aria-pressed={value[k]}
          onClick={() => { const next = { assemble: value.assemble, order: value.order, [k]: !value[k] }; if (next.assemble || next.order) onPick(next) }}>
          {value[k] && <TickIcon size={20} strokeWidth="3" />} {label}
        </button>
      ))}
    </div>
  )
  const shoot = (tag) => { setError(''); setStep(tag); setCam(true) }
  const fromPhone = (tag) => { setError(''); setStep(tag); file.current?.click() }
  // Sent at once: it shows in its step while it goes up behind (the outbox).
  const sendPhotos = () => {
    if (!picked.length || !step) return
    const shots = take()
    const n = Number(boardsToMake)
    post({
      jobId: job.id, step, files: shots.map((p) => p.file), previews: shots.map((p) => p.url),
      ...(step === 'quotation' && asks.assemble && boardsToMake !== '' && n >= 0 ? { boards: n } : {}),
      ...(step === 'quotation' ? { assemble: asks.assemble, order: asks.order } : {}),
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
      {tag === 'quotation' && tickNeeds(asks, setAsks)}
      {tag === 'quotation' && asks.assemble && (
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
      {gallery && <button type="button" className="key ghost" onClick={() => fromPhone(tag)}><PhotosIcon /> Choose from the phone</button>}
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
  const sendComplete = () => { post({ jobId: job.id, step: 'assemble', complete: true }); setCompleting(false) }

  /* ── what was ordered in, at the counter ────────────────────────────────── */
  // Arrived, with its proof: the supplier's bill or challan, photographed.
  const [arriving, setArriving] = useState(false)
  const proof = picked.length > 0 && step === 'arrived'
  const sendArrived = () => {
    if (!proof) return
    const shots = take()
    post({ jobId: job.id, step: 'arrived', arrived: true, files: shots.map((p) => p.file), previews: shots.map((p) => p.url) })
    setArriving(false)
  }
  // The ticks changed while the job is being assembled or ordered: asked first.
  const [changing, setChanging] = useState(null)
  const changeNeeds = () => {
    const next = changing
    setChanging(null)
    setNeeds({ jobId: job.id, assemble: next.assemble, order: next.order }).catch((err) => setError(said(err)))
  }
  const doneBy = (n) => (!n.assemble || job.assembled) && (!n.order || job.arrived)
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
    measurement: <>{head('Measure')}{tray('measurement')}</>,
    quotation: head('Work order', 'The shop is making the work order from your measurements.'),
    assemble: needs.assembling
      ? <>{head('Assemble', needs.order ? (job.arrived ? 'The ordered items are in at the shop.' : 'The shop is ordering items for this job too.') : '')}{counter(tallied, true)}</>
      : needs.assemble
        ? <>{head('Assembled', 'The shop is waiting for the ordered items. The go-ahead comes once they are in.')}{counter(job.boardsMade ?? 0, false)}</>
        : head('Order in', 'Nothing to assemble. The shop is ordering it in; it comes to you to fit.'),
    goahead: head('Go-ahead', `${ready} The shop calls the customer, then sends when to visit and whom to call.`),
    fitting: <>{head('Fit it')}{visit}{tray('fitting')}</>,
  }[at] : {
    measurement: <>{head('Measurement', 'The workshop is to visit the site and measure.')}{tray('visit', { gallery: true, camera: 'Add a visit order photo' })}</>,
    quotation: <>{head('Work order')}{tray('quotation', { gallery: true })}</>,
    assemble: (
      <>
        {head(stageAt(job).label, needs.ordering ? 'Order it from the supplier. When it comes in, photograph its bill or challan.' : '')}
        {needs.assemble && (job.assembled
          ? <p className="mark ok"><TickIcon size={18} /> Assembling complete</p>
          : job.boardsMade != null ? counter(job.boardsMade, false) : <p className="mark">Assembling: nothing counted yet.</p>)}
        {needs.order && !needs.ordering && <p className="mark ok"><TickIcon size={18} /> Ordered items arrived</p>}
        {needs.ordering && tray('arrived', { gallery: true })}
        <span className="ask">This job</span>
        {tickNeeds(needs, (next) => setChanging(next))}
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
    fitting: <>{head('Fitting', 'The workshop is to fit it.')}{visit}</>,
  }[at]

  /* ── the one button at the foot ─────────────────────────────────────────── */
  const dock = over ? null : SIDE === 'workshop' ? {
    measurement: photoKey('measurement', 'Photograph measurements'),
    assemble: needs.assembling ? { label: 'Complete', Icon: TickIcon, run: () => { sendTally(); setCompleting(true) }, tone: 'safe' } : null,
    fitting: photoKey('fitting', 'Photograph it fitted'),
  }[at] : {
    measurement: photoKey('visit', ''),
    quotation: photoKey('quotation', 'Photograph work order'),
    assemble: !needs.ordering ? null
      : proof ? { label: 'Arrived', Icon: TickIcon, run: () => setArriving(true), tone: 'safe' }
      : { label: 'Photograph bill or challan', Icon: CameraIcon, run: () => shoot('arrived'), tone: 'must' },
    goahead: { label: 'Send go-ahead', Icon: SendIcon, run: sendGoAhead, tone: 'safe', off: !goReady },
  }[at]

  /* ── everything sent so far, step by step ───────────────────────────────── */
  const sections = DOWN.map((tag) => ({
    tag,
    items: job.messages.filter((m) => tagOf(m) === tag),
    pending: outgoing.filter((item) => (item.step ?? 'visit') === tag),
  })).filter((s) => s.items.length || s.pending.length)

  const contacts = contactsOf(job.phone)
  const customerNow = job.ledgerId ? { ledgerId: job.ledgerId, name: job.title, place: job.place, phone: job.phone } : job.title ? { name: job.title } : null

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
            {SIDE === 'shop' && (
              <button type="button" className="rowline" onClick={() => setChoosing(customerNow)}>
                <span className="lbl">Account</span><span className="val">{job.title ? 'Change customer' : 'Set customer'}</span><span className="go"><PersonIcon size={20} /></span>
              </button>
            )}
          </section>
        )}

        {sections.map(({ tag, items, pending }) => {
          const latest = items[items.length - 1]
          return (
            <section key={tag} className="stepsec" aria-label={TAGS[tag]}>
              <header>
                <b>{TAGS[tag]}</b>
                <small>{SIDE_NAME[TAG_FROM[tag]]}{latest ? ` · ${stampOf(latest.at)}` : ''}</small>
              </header>
              {items.map((m) => (
                <div key={m.id} className="entry holdable" {...holdToDelete(m)}>
                  {m.photos.length > 0 && (
                    <div className="shots">
                      {m.photos.map((p) => (
                        <button key={p.storageId} type="button" onClick={() => openPhoto(p.storageId)}>
                          <Shot url={p.url} width={BUBBLE} alt={TAGS[tag]} loading="lazy" decoding="async" />
                        </button>
                      ))}
                    </div>
                  )}
                  {m.complete && <p className="mark ok"><TickIcon size={18} /> Assembling complete <time>{stampOf(m.at)}</time></p>}
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
                      <button type="button" onClick={() => void deliver(item)}>Not sent. Tap to try again</button>
                      <button type="button" className="x" onClick={() => discard(item)} aria-label="Do not send this"><CloseIcon size={14} /></button>
                    </p>
                  ) : (
                    <p className="state">Sending <span className="spin tiny" /></p>
                  )}
                </div>
              ))}
            </section>
          )
        })}
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
      {viewer != null && viewer >= 0 && <Viewer photos={photos} start={viewer} title={titleOf(job)} onClose={() => window.history.back()} />}
      {completing && (
        <Sheet label="Complete" onClose={() => setCompleting(false)}>
          <b className="sheettitle">Assembling complete?</b>
          <p>{needs.ordering
            ? 'The shop is told. The go-ahead waits for the ordered items to come in. This step cannot be gone back to.'
            : 'The shop is told, and sends the go-ahead after calling the customer. This step cannot be gone back to.'}</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setCompleting(false)}>Not yet</button>
            <button type="button" className="solid safe" onClick={sendComplete}>Complete</button>
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
      {changing && (
        <Sheet label="This job" onClose={() => setChanging(null)}>
          <b className="sheettitle">{NEEDS.filter(([k]) => changing[k]).map(([, label]) => label).join(' + ')}?</b>
          <p>{doneBy(changing)
            ? 'Everything it asks for is done, so it goes on to the go-ahead.'
            : changing.assemble && !needs.assemble ? 'The workshop is told to assemble it.'
            : changing.order && !needs.order ? 'Order it from the supplier, then tap Arrived.'
            : 'The other side sees the change.'}</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setChanging(null)}>Cancel</button>
            <button type="button" className="solid" onClick={changeNeeds}>Change</button>
          </div>
        </Sheet>
      )}
      {choosing !== undefined && (
        <Sheet label="Customer" wide onClose={() => setChoosing(undefined)}>
          <b className="sheettitle">Who is this for?</b>
          <p>Pick the customer's account from the panel; the name, place and phone come with it.</p>
          <CustomerPicker value={choosing} onChange={setChoosing} />
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setChoosing(undefined)}>Cancel</button>
            <button type="button" className="solid" onClick={() => { const args = customerArgs(choosing); setChoosing(undefined); setCustomer({ jobId: job.id, ...args }).catch((err) => setError(said(err))) }}>Save</button>
          </div>
        </Sheet>
      )}
      {deleting && (
        <DeleteSheet title="Delete this?" onClose={() => setDeleting(null)} run={(pin) => removeMessage({ jobId: job.id, messageId: deleting.id, pin })}>
          {TAGS[tagOf(deleting)]}, {stampOf(deleting.at)}{deleting.photos.length ? ` · ${deleting.photos.length} ${deleting.photos.length === 1 ? 'photo' : 'photos'}` : ''}
          <br />It is removed for both sides, for good. The job stays at the step it has reached.{job.messages.length === 1 ? ' It is the only thing here, so the work order goes with it.' : ''}
        </DeleteSheet>
      )}
    </div>
  )
}
