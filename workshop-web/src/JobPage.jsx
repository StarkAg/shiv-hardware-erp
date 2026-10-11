import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { SIDE, SIDE_NAME } from './side.js'
import { BUBBLE } from './offline.js'
import {
  STAGES, TAGS, TAG_FROM, addressOf, api, boardsLine, contactsOf, finished, lineOf, mapLinkOf, myTurn, nameOf, newIn,
  said, stageAt, stageId, stageNo, stampOf, titleOf, visitLine,
} from './flow.js'
import { atOnce, deliver, discard, post, useOutbox } from './outbox.js'
import {
  BackIcon, Boards, CameraIcon, ClockIcon, CloseIcon, DeleteSheet, PersonIcon, PhoneIcon, PhotosIcon, Picked, PinIcon, STEP_ICONS,
  SendIcon, Sheet, Shot, StepTracker, TickIcon, useHold, usePicked,
} from './ui.jsx'
import { CustomerPicker, customerArgs } from './NewOrder.jsx'
import Camera from './Camera.jsx'
import Viewer from './Viewer.jsx'

/** The steps as they are listed down the page, the latest first; the visit order is where a job begins. */
const DOWN = ['fitting', 'goahead', 'assemble', 'quotation', 'measurement', 'visit']
/** Something sent before everything was tagged: read by who sent it. */
const tagOf = (m) => m.step ?? (m.from === 'workshop' ? 'measurement' : 'visit')

/**
 * One job, as a page built around its steps.
 *
 * At the head, where the job stands among its five steps. Under it, the one
 * thing to do now: a single panel that is this side's action when the step is
 * its turn (photograph the measurements, attach the work order, count the
 * boards and press Complete, give the go-ahead, photograph it fitted) and says
 * who it is waiting on when it is not. Then who it is for, and everything sent
 * so far, step by step with the latest first.
 *
 * Nothing is typed as free text and no step is picked: the books move a job
 * on when its step is done (convex/workshop.ts `send`), and a step that is
 * done is closed.
 */
export default function JobPage({ job, onBack }) {
  const seen = useMutation(api.workshop.seen).withOptimisticUpdate(atOnce.seen)
  const removeMessage = useMutation(api.workshop.removeMessage)
  const setCustomer = useMutation(api.workshop.setCustomer).withOptimisticUpdate(atOnce.setCustomer)
  const { picked, add, drop, take } = usePicked()
  const [error, setError] = useState('')
  // What this phone has sent for the job and is still on its way: shown in its step at once.
  const outgoing = useOutbox().filter((item) => item.jobId === job.id)
  const at = stageId(job)
  const mine = myTurn(job)
  const over = finished(job)

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
  const shoot = (tag) => { setError(''); setStep(tag); setCam(true) }
  const fromPhone = (tag) => { setError(''); setStep(tag); file.current?.click() }
  // Sent at once: it shows in its step while it goes up behind (the outbox).
  const sendPhotos = () => {
    if (!picked.length || !step) return
    const shots = take()
    const n = Number(boardsToMake)
    post({ jobId: job.id, step, files: shots.map((p) => p.file), previews: shots.map((p) => p.url), ...(step === 'quotation' && boardsToMake !== '' && n >= 0 ? { boards: n } : {}) })
    setBoardsToMake('')
  }
  /** The one photo action of a step: the camera, then what was shot waiting to be sent under its tag. */
  const photoAction = (tag, label, { gallery = false, quiet = false } = {}) => (picked.length && step === tag ? (
    <>
      <Picked picked={picked} onDrop={drop} />
      {tag === 'quotation' && (
        <label className="ask inline">
          Boards to make
          <input type="number" inputMode="numeric" min={0} max={999} placeholder="0" value={boardsToMake} onChange={(e) => setBoardsToMake(e.target.value)} />
        </label>
      )}
      <div className="row">
        <button type="button" className="btn ghost square" onClick={() => setCam(true)} aria-label="Add another photo"><CameraIcon /></button>
        <button type="button" className="btn solid grow" onClick={sendPhotos}><SendIcon size={20} /> Send {TAGS[tag].toLowerCase()}</button>
      </div>
    </>
  ) : (
    <div className="row">
      <button type="button" className={`btn grow ${quiet ? 'ghost' : 'solid big'}`} onClick={() => shoot(tag)}><CameraIcon /> {label}</button>
      {gallery && <button type="button" className="btn ghost" onClick={() => fromPhone(tag)}><PhotosIcon size={20} /> From phone</button>}
    </div>
  ))

  /* ── the work status, while assembling ──────────────────────────────────── */
  /**
   * Plus for each board made, minus to correct. Nothing else to tap: the
   * figure is sent by itself a moment after the last tap, so four boards in a
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
      <span><ClockIcon size={18} /><b>{visitLine(job.visitAt)}</b></span>
      {job.callPhone && <a className="btn ghost" href={`tel:${job.callPhone}`}><PhoneIcon size={18} /> Call {job.callPhone}</a>}
    </div>
  ) : null

  /* ── the one thing to do now ────────────────────────────────────────────── */
  const stepNo = stageNo(at) + 1
  const head = (title, lead) => (
    <div className="nowhead">
      <span className="num">{mine ? stepNo : <ClockIcon size={18} />}</span>
      <div>
        <small>{mine ? `Step ${stepNo} of ${STAGES.length}: yours to do` : `Step ${stepNo} of ${STAGES.length}: with the ${SIDE === 'shop' ? 'workshop' : 'shop'}`}</small>
        <b>{title}</b>
        {lead && <p>{lead}</p>}
      </div>
    </div>
  )
  const now = over ? (
    <div className="nowhead">
      <span className="num done"><TickIcon size={18} /></span>
      <div><small>All five steps are done</small><b>Finished</b></div>
    </div>
  ) : SIDE === 'workshop' ? {
    measurement: <>{head('Measure', 'Visit the site and measure. Then photograph the measurements.')}{photoAction('measurement', 'Photograph the measurements')}</>,
    quotation: head('Work order', 'The shop is making the work order from your measurements.'),
    assemble: (
      <>
        {head('Assemble', 'Tap + for each board made. Press Complete when it is all assembled.')}
        <Boards made={tallied} total={job.boardsTotal} big />
        <div className="tally">
          <button type="button" className="btn ghost step" onClick={() => bump(-1)} disabled={tallied <= 0} aria-label="One board fewer">−</button>
          <span className="figure" aria-live="polite"><b>{tallied}</b><small>{job.boardsTotal ? `of ${job.boardsTotal} boards made` : 'boards made'}</small></span>
          <button type="button" className="btn solid step" onClick={() => bump(1)} aria-label="One more board made">+</button>
        </div>
        <button type="button" className="btn good big" onClick={() => { sendTally(); setCompleting(true) }}><TickIcon size={20} /> Complete</button>
      </>
    ),
    goahead: head('Go-ahead', 'Complete. The shop will call the customer and send the go-ahead: when to visit and whom to call.'),
    fitting: <>{head('Fit it', 'The go-ahead is given. Fit it, then photograph it fitted.')}{visit}{photoAction('fitting', 'Photograph it fitted')}</>,
  }[at] : {
    measurement: <>{head('Measurement', 'The workshop is to visit the site and measure.')}{photoAction('visit', 'Add a visit order photo', { gallery: true, quiet: true })}</>,
    quotation: <>{head('Work order', 'Measured. Make the work order and attach it: it goes to the workshop to assemble.')}{photoAction('quotation', 'Attach the work order', { gallery: true })}</>,
    assemble: (
      <>
        {head('Being assembled', job.boardsMade == null ? 'No boards logged yet.' : job.boardsTotal ? '' : `${boardsLine(job.boardsMade)}.`)}
        <Boards made={job.boardsMade} total={job.boardsTotal} big />
      </>
    ),
    goahead: (
      <>
        {head('Give the go-ahead', 'Assembling is complete. Call the customer, then say when to visit and whom to call.')}
        <label className="ask">When to visit
          <input type="datetime-local" value={going.when} onChange={(e) => setGoing({ ...going, when: e.target.value })} />
        </label>
        <span className="ask">Whom to call</span>
        {contactsOf(job.phone).length > 0 && (
          <div className="chips">
            {contactsOf(job.phone).map((number) => (
              <button key={number} type="button" className={contactsOf(going.phone)[0] === number ? 'on' : ''} onClick={() => setGoing({ ...going, phone: number })}>{number}</button>
            ))}
          </div>
        )}
        <input className="field" type="tel" inputMode="tel" placeholder="Phone number" value={going.phone} maxLength={16}
          onChange={(e) => setGoing({ ...going, phone: e.target.value.replace(/[^\d+\s-]/g, '') })} />
        <button type="button" className="btn solid big" onClick={sendGoAhead} disabled={!goReady}><SendIcon size={20} /> Send go-ahead</button>
      </>
    ),
    fitting: <>{head('Fitting', 'The workshop is to fit it.')}{visit}</>,
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
        {contacts[0] && <a className="call" href={`tel:${contacts[0]}`} aria-label={`Call ${titleOf(job)}`}><PhoneIcon /></a>}
      </header>

      <main className="scroll">
        <StepTracker job={job} />

        <section className={`now ${over ? 'over' : mine ? 'mine' : 'wait'}`} aria-label="What to do now">
          {now}
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        {/* Who it is for: every number to ring, the site on the map once a job
            carries one and, at the counter, where the customer is set. */}
        {(contacts.length > 0 || mapLinkOf(job) || SIDE === 'shop') && (
          <section className="customer" aria-label="Customer">
            {contacts.map((number) => (
              <a key={number} href={`tel:${number}`} aria-label={`Call ${number}`}><PhoneIcon size={16} />{number}</a>
            ))}
            {mapLinkOf(job) && <a href={mapLinkOf(job)} target="_blank" rel="noreferrer"><PinIcon size={16} />Map</a>}
            {SIDE === 'shop' && (
              <button type="button" onClick={() => setChoosing(customerNow)}><PersonIcon size={16} />{job.title ? 'Change customer' : 'Set customer'}</button>
            )}
          </section>
        )}

        {sections.map(({ tag, items, pending }) => {
          const StepIcon = STEP_ICONS[tag]
          const latest = items[items.length - 1]
          return (
            <section key={tag} className="stepsec" aria-label={TAGS[tag]}>
              <header>
                <span className="ico"><StepIcon size={18} /></span>
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
                  {m.boards != null && tag === 'quotation' && <p className="mark">{m.boards} boards to make</p>}
                  {m.boards != null && tag !== 'quotation' && <p className="mark"><b>{m.boards}</b>{job.boardsTotal ? ` of ${job.boardsTotal}` : ''} boards made <time>{stampOf(m.at)}</time></p>}
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
          <p>The shop is told. It will call the customer and send you the go-ahead: when to visit and whom to call. This step cannot be gone back to.</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setCompleting(false)}>Not yet</button>
            <button type="button" className="solid" onClick={sendComplete}>Complete</button>
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
