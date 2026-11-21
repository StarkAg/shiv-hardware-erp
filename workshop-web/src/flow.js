import { anyApi } from 'convex/server'
import { OTHER, SIDE } from './side.js'

/**
 * The flow of a job, and how it is put into words.
 *
 * The rules themselves live in the books (convex/workshop.ts `send`): which
 * side does which step, that none is skipped and none gone back to. This is
 * the same list of steps as the screens read it, and everything a job or a
 * message is called.
 */
export const api = anyApi

/**
 * The steps a job goes through, in order, and whose turn each is:
 *
 *   measurement  the workshop measures on site and photographs the figures, a
 *                visit at a time, as many as it needs, then Measuring done
 *   quotation    the shop makes the work order from them and sends its photo
 *   assemble     the workshop builds it, says how many pieces are made, then Complete;
 *                or, where the job asks for it, the shop orders it in
 *                (Ordered, with the WhatsApp screenshot if it likes) and says
 *                Arrived (with the bill or challan if it likes); or both, side
 *                by side (`needsOf`)
 *   goahead      the shop rings the customer and says when to go and whom to ring
 *   fitting      the workshop fits it and photographs it, over as many visits
 *                as it needs, then Fitting done; the job is finished
 *
 * `todo` is what the list says while a step waits; `short` is the one word a
 * narrow box or the tracker has room for.
 */
export const STAGES = [
  { id: 'measurement', label: 'Measurement', short: 'Measure', todo: 'To measure', turn: 'workshop' },
  { id: 'quotation', label: 'Work order', short: 'Order', todo: 'Work order to make', turn: 'shop' },
  { id: 'assemble', label: 'Assemble', short: 'Assemble', todo: 'Being assembled', turn: 'workshop' },
  { id: 'goahead', label: 'Go-ahead', short: 'Go-ahead', todo: 'Go-ahead to give', turn: 'shop' },
  { id: 'fitting', label: 'Fitting', short: 'Fitting', todo: 'To fit', turn: 'workshop' },
]
/**
 * Nothing in a job is free text: everything sent is tagged with what it is,
 * and this is what each tag is called.
 */
export const TAGS = { visit: 'Visit order', measurement: 'Measurement', quotation: 'Work order', assemble: 'Work status', ordered: 'Ordered', arrived: 'Arrived', goahead: 'Go-ahead', fitting: 'Fitted' }
/** The side that sends each tag. */
export const TAG_FROM = { visit: 'shop', measurement: 'workshop', quotation: 'shop', assemble: 'workshop', ordered: 'shop', arrived: 'shop', goahead: 'shop', fitting: 'workshop' }
/** What the workshop's Complete is called at each of its steps. */
export const DONE = { measurement: 'Measuring done', assemble: 'Assembling complete', fitting: 'Fitting done' }

/**
 * The visits a step has taken: the workshop's photographs of it, a visit to
 * each day they were sent on. Returns the visit number of each message (by
 * id) and how many visits there have been.
 */
export const visitsOf = (job, tag) => {
  const days = []
  const of = {}
  for (const m of job.messages) {
    if (m.from !== 'workshop' || (m.step ?? 'measurement') !== tag || !m.photos?.length) continue
    const day = new Date(m.at).toDateString()
    if (!days.includes(day)) days.push(day)
    of[m.id] = days.indexOf(day) + 1
  }
  return { of, count: days.length }
}

/**
 * What a job asks for, chosen when the counter makes it: the workshop to
 * assemble it, the shop to order it in from a supplier, or both. A job from
 * before the choice is to be assembled. `assembling` and `ordering` are what is still to do of each.
 */
export const needsOf = (job) => {
  const assemble = job.needsAssemble !== false
  const order = job.needsOrder === true
  return { assemble, order, assembling: assemble && !job.assembled, ordering: order && !job.arrived, toOrder: order && !job.ordered }
}
/** The third step, named for what the job asks for. */
const WORK = {
  assemble: { label: 'Assemble', short: 'Assemble' },
  order: { label: 'Order in', short: 'Order in' },
  both: { label: 'Assemble, order in', short: 'Make, buy' },
}
const workOf = (job) => { const n = needsOf(job); return WORK[n.assemble && n.order ? 'both' : n.order ? 'order' : 'assemble'] }
/** A step as it is for this job: the third one is named for what the job asks for. */
export const stepOf = (job, st) => (st.id === 'assemble' ? { ...st, ...workOf(job) } : st)

export const stageId = (job) => job.stage ?? 'measurement'
export const stageAt = (job) => stepOf(job, STAGES.find((s) => s.id === stageId(job)) ?? STAGES[0])
export const stageNo = (id) => STAGES.findIndex((s) => s.id === id)
export const finished = (job) => job.status === 'done'
export const stageOf = (job) => {
  if (finished(job)) return 'Done'
  if (stageId(job) !== 'assemble') return stageAt(job).todo
  const n = needsOf(job)
  const buying = n.toOrder ? 'to order' : 'ordered, to arrive'
  return n.assembling && n.ordering ? `Assembling, ${buying}`
    : n.ordering ? (n.toOrder ? 'To order' : 'Ordered, to arrive')
    : 'Being assembled'
}
/**
 * Whether the step a job stands at is this side's to do. While a job is
 * assembled and ordered in at once it is both sides' turn: the workshop's
 * until it is complete, the shop's until what was ordered has arrived.
 */
export const myTurn = (job) => {
  if (finished(job)) return false
  if (stageId(job) !== 'assemble') return stageAt(job).turn === SIDE
  const n = needsOf(job)
  return SIDE === 'workshop' ? n.assembling : n.ordering
}
/** Where a step stands for a job: done, the one in hand, or still to come. */
export const stepState = (job, id) => (finished(job) || stageNo(id) < stageNo(stageId(job)) ? 'done' : id === stageId(job) ? 'now' : 'later')

export const titleOf = (job) => job.title || `Work order ${job.number}`
/**
 * The books write a customer as "Sanjay Mahto Ji, Korambe": the name, and
 * after the first comma where they are. They are shown apart, the name and
 * under it the address on one line.
 */
export const nameOf = (job) => titleOf(job).split(',')[0].trim()
export const addressOf = (job) => {
  const after = titleOf(job).split(',').slice(1).join(',').replace(/\s+/g, ' ').trim()
  // The account's own place, when it has one the name does not already say.
  const place = String(job.place ?? '').trim()
  return [after, place && !after.toLowerCase().includes(place.toLowerCase()) ? place : ''].filter(Boolean).join(', ')
}
/** What the other side has sent since this side last had the job open. */
export const newIn = (job) => job.messages.filter((m) => m.from === OTHER && m.at > (job[`${SIDE}SeenAt`] ?? 0)).length

/**
 * What is made is counted in pieces: a job may be boards, an aluminium door,
 * windows. The books still call the figure `boards`.
 */
export const piecesLine = (made, total) => `${made}${total ? ` of ${total}` : ''} ${made === 1 && !total ? 'piece' : 'pieces'} made`
export const visitLine = (ms) => new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
/** Something sent, in a few words: for the list, and for one still on its way. */
export const lineOf = (m, job) => {
  const n = m.photos?.length ?? m.files?.length ?? 0
  if (m.complete) return DONE[m.step] ?? 'Complete'
  if (m.ordered) return 'Ordered'
  if (m.arrived) return 'Ordered items arrived'
  if (m.visitAt) return `Go-ahead: ${visitLine(m.visitAt)}`
  if (m.slip) return m.slip.lines.length ? `Visit order · ${m.slip.lines.length} ${m.slip.lines.length === 1 ? 'item' : 'items'}` : 'Visit order'
  if (m.pad) return `Work order made on the app · ${m.pad.lines.length} ${m.pad.lines.length === 1 ? 'item' : 'items'}`
  if (m.boards != null && m.step !== 'quotation') return `Work status: ${piecesLine(m.boards, job?.boardsTotal)}`
  if (n) return `${TAGS[m.step] ?? (m.from === 'workshop' ? 'Measurement' : 'Photo')}${n > 1 ? ` · ${n} photos` : ''}`
  return m.text || ''
}

/**
 * The numbers to ring a customer on. The books keep one line for the phone,
 * and where a customer has two they are written into it side by side
 * ("8340785465 / 9000000000"): each run of digits long enough to be a number
 * is one contact.
 */
export const contactsOf = (phone) => [...new Set((String(phone ?? '').match(/\+?\d[\d\s-]{8,}\d/g) ?? [])
  .map((n) => n.replace(/[\s-]+/g, ''))
  // Two ten-digit numbers with only a space between them read as one run: taken apart again.
  .flatMap((n) => (/^\d{20,}$/.test(n) && n.length % 10 === 0 ? n.match(/\d{10}/g) : [n])))]
/** Where the site is, as a link the phone's map opens, when the job carries one. */
export const mapLinkOf = (job) => job.mapUrl || (job.location?.lat != null ? `https://www.google.com/maps?q=${job.location.lat},${job.location.lng}` : '')

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
export const clock = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
/** In the list and beside what was sent: the time today, else the day. */
export const whenOf = (ms) => (sameDay(ms, Date.now()) ? clock(ms) : sameDay(ms, Date.now() - 86400000) ? 'Yesterday' : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
/** The day and the time, for something sent on an earlier day. */
export const stampOf = (ms) => (sameDay(ms, Date.now()) ? clock(ms) : `${whenOf(ms)}, ${clock(ms)}`)

/** What the books said when they refused, or a plain line when they said nothing. */
export const said = (err) => (typeof err?.data === 'string' ? err.data : err?.message) || 'Could not send. Try again.'
