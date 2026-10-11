import { useEffect, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { sized } from './offline.js'
import { STAGES, said, stageAt, stageId, stepState, finished, myTurn } from './flow.js'

/**
 * The small parts both screens are made of: the icons, a photo at the size it
 * is shown, the step tracker, the pieces made, and the two things a finger
 * does besides tapping (holding to delete, and picking photos to send).
 */

const Icon = ({ d, size = 22, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{d}</svg>
)
export const CameraIcon = (p) => <Icon {...p} d={<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>} />
export const PhotosIcon = (p) => <Icon {...p} d={<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></>} />
export const SendIcon = (p) => <Icon {...p} d={<path d="M4 12l16-8-6 16-3-7z" />} />
export const CloseIcon = (p) => <Icon {...p} d={<path d="M6 6l12 12M18 6L6 18" />} />
export const PlusIcon = (p) => <Icon {...p} d={<path d="M12 5v14M5 12h14" />} />
export const BackIcon = (p) => <Icon {...p} d={<path d="M15 5l-7 7 7 7" />} />
export const PhoneIcon = (p) => <Icon {...p} d={<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />} />
export const PersonIcon = (p) => <Icon {...p} d={<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>} />
export const PinIcon = (p) => <Icon {...p} d={<><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.6" /></>} />
export const TickIcon = (p) => <Icon {...p} d={<path d="M5 12.5l4.5 4.5L19 7.5" />} />
export const ClockIcon = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>} />
export const ShareIcon = (p) => <Icon {...p} d={<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>} />
// What is to do, everything, and one for each step.
export const TodoIcon = (p) => <Icon {...p} d={<><path d="M9 11.5l2.5 2.5L20 5.5" /><path d="M20 12.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10" /></>} />
export const AllIcon = (p) => <Icon {...p} d={<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>} />
export const RuleIcon = (p) => <Icon {...p} d={<><path d="M3.5 16.5l13-13 4 4-13 13z" /><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2" /></>} />
export const SheetIcon = (p) => <Icon {...p} d={<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>} />
export const ToolIcon = (p) => <Icon {...p} d={<path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L3 18l3 3 6.4-6.4a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z" />} />
export const DoorIcon = (p) => <Icon {...p} d={<><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16" /><path d="M14.5 12v1.5" /></>} />
export const ClipIcon = (p) => <Icon {...p} d={<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6" /></>} />
/** The picture each step goes by, in the filter boxes and beside what was sent. */
export const STEP_ICONS = { visit: ClipIcon, measurement: RuleIcon, quotation: SheetIcon, assemble: ToolIcon, goahead: PhoneIcon, fitting: DoorIcon }

/**
 * A photo brought down to the size it is shown at, by the site's own image
 * service (vercel.json "images"): a list of full phone photos is megabytes.
 * Where that is not to be had the photo itself is shown.
 */
export function Shot({ url, width, ...rest }) {
  const [src, setSrc] = useState(() => sized(url, width))
  useEffect(() => { setSrc(sized(url, width)) }, [url, width])
  return <img src={src} onError={() => { if (src !== url) setSrc(url) }} {...rest} />
}

/**
 * Where a job stands among its five steps.
 *
 * Full, at the head of a job's page: a sign for each step, named under it.
 * Small, in a job's row in the list: five bars that say the same at a glance.
 * A done step is green; the one in hand is blue when it is this side's to do
 * and yellow when it is with the other side. Not a control: no step is picked.
 */
export function StepTracker({ job, mini = false }) {
  const label = finished(job) ? 'Finished' : `Step ${STAGES.findIndex((s) => s.id === stageId(job)) + 1} of ${STAGES.length}: ${stageAt(job).label}`
  const look = (id) => { const state = stepState(job, id); return state === 'now' ? `now ${myTurn(job) ? 'mine' : 'wait'}` : state }
  if (mini) {
    return (
      <span className="minitrack" role="img" aria-label={label}>
        {STAGES.map((s) => <i key={s.id} className={look(s.id)} />)}
      </span>
    )
  }
  return (
    <ol className="tracker" aria-label={label}>
      {STAGES.map((s, i) => {
        const state = stepState(job, s.id)
        return (
          <li key={s.id} className={look(s.id)} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="dot">{state === 'done' ? <TickIcon size={22} strokeWidth="3.2" /> : i + 1}</span>
            <span className="word">{s.short}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * How many pieces are made, a cell for each to make: the work status at a
 * glance, in the list and on a job's page. A job of many pieces gets a bar
 * instead. Nothing is drawn until the work order has said how many there are.
 */
export function Pieces({ made, total, big = false }) {
  if (!total) return null
  const done = Math.min(total, made ?? 0)
  return (
    <span className={`pieces ${big ? 'big' : ''}`} role="img" aria-label={`${done} of ${total} pieces made`}>
      {total <= 16
        ? <span className="cells" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>{Array.from({ length: total }, (_, i) => <i key={i} className={i < done ? 'made' : ''} />)}</span>
        : <span className="track"><i style={{ width: `${Math.round((done / total) * 100)}%` }} /></span>}
      {!big && <b>{done}/{total}</b>}
    </span>
  )
}

/** The light that says what is on screen is the live list. */
export function LiveLight() {
  const convex = useConvex()
  const [on, setOn] = useState(() => convex.connectionState().isWebSocketConnected)
  useEffect(() => {
    const timer = setInterval(() => setOn(convex.connectionState().isWebSocketConnected), 1500)
    return () => clearInterval(timer)
  }, [convex])
  return <span className={`live ${on ? 'on' : ''}`} role="status"><i />{on ? 'Live' : 'Connecting'}</span>
}

/** How far the saving of photos to the phone has got: a line and a bar under the name. */
export function Saving({ saving }) {
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

/**
 * A small sheet over the screen. A tap beside it closes it, unless `locked`.
 * While it is up, the screen under it cannot be tabbed into or tapped.
 */
export function Sheet({ label, wide = false, locked = false, onClose, children }) {
  const back = useRef(null)
  useEffect(() => {
    const under = [...(back.current?.parentElement?.children ?? [])].filter((el) => el !== back.current && !el.inert)
    for (const el of under) el.inert = true
    return () => { for (const el of under) el.inert = false }
  }, [])
  return (
    <div className="sheetback" ref={back} onClick={locked ? undefined : onClose}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// The delete PIN, once it has been right, is held for five minutes so a few
// things can go without typing it for each. In memory only, never stored.
const heldPin = { pin: '', until: 0 }
const pinStillGood = () => heldPin.until > Date.now()
const holdPin = (pin) => { heldPin.pin = pin; heldPin.until = Date.now() + 5 * 60_000 }

/**
 * Holding a finger for half a second on something sent, or on a job in the
 * list, asks to delete it: `onHold` is told which. A finger that moves is
 * scrolling, not holding; and the tap that ends a hold does not also open
 * what was held.
 */
export function useHold(onHold) {
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
export function DeleteSheet({ title, children, run, onClose }) {
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
    <Sheet label={title} locked={checking} onClose={onClose}>
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
    </Sheet>
  )
}

/** Photos chosen and not yet sent, each with its own preview. */
export function usePicked() {
  const [picked, setPicked] = useState([])
  const add = (files) => setPicked((cur) => [...cur, ...[...files].filter((f) => f.type.startsWith('image/')).map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 10))
  const drop = (url) => setPicked((cur) => { URL.revokeObjectURL(url); return cur.filter((p) => p.url !== url) })
  /** Hands the photos on to be sent (the outbox keeps their previews) and empties the tray. */
  const take = () => { setPicked([]); return picked }
  return { picked, add, drop, take }
}

export function Picked({ picked, onDrop }) {
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
