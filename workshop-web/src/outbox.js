import { useSyncExternalStore } from 'react'
import { SIDE } from './side.js'
import { api, finished, needsOf, said, stageId, stageNo } from './flow.js'

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

/**
 * The outbox: what has been sent from this phone and is still on its way.
 *
 * Send shows in the job at once and returns; the upload and the post happen
 * behind it, so nobody stands on a site watching a spinner. The job moves on
 * on this phone the moment it is sent (`ahead`): Complete puts it at the next
 * step, a count shows as the pieces made, as the books will have it.
 *
 * Each job's sends go up one after another, in the order they were made, so a
 * Complete never reaches the books before the photos it follows. What is
 * still to go is kept on the phone (IndexedDB), photos and all: a phone
 * closed, out of charge or out of signal sends it the next time the app
 * opens. A send that fails is tried again by itself when the line comes back,
 * every half minute while it is out, or on a tap. One the books refuse (the
 * step was done from the other side meanwhile) is marked Not sent, says why,
 * and no longer moves the job on this phone.
 */
export const outbox = { items: [], listeners: new Set(), convex: null, live: undefined }
const told = () => { outbox.items = [...outbox.items]; for (const fn of outbox.listeners) fn() }
const watch = (fn) => { outbox.listeners.add(fn); return () => outbox.listeners.delete(fn) }
const held = () => outbox.items
export const useOutbox = () => useSyncExternalStore(watch, held, held)

/* ── kept on the phone ──────────────────────────────────────────────────── */
let opened = null
const db = () => (opened ??= new Promise((done, fail) => {
  const req = indexedDB.open(`workshop-outbox-${SIDE}`, 1)
  req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' })
  req.onsuccess = () => done(req.result)
  req.onerror = () => fail(req.error)
}))
const kept = async (mode, fn) => {
  const tx = (await db()).transaction('items', mode)
  const req = fn(tx.objectStore('items'))
  return new Promise((done, fail) => { tx.oncomplete = () => done(req.result); tx.onerror = () => fail(tx.error) })
}
// The previews are this visit's only; the rest, files included, is what is kept.
const keep = (item) => {
  const { previews, state, error, busy, refused, restored, ...rest } = item
  return kept('readwrite', (s) => s.put(rest)).catch(() => { /* a phone that keeps nothing still sends it */ })
}
const unkeep = (item) => kept('readwrite', (s) => s.delete(item.id)).catch(() => {})

/**
 * What was still to go when the app was last closed. It may have reached the
 * books just before: what the live list already has is not sent twice.
 */
void (typeof indexedDB === 'undefined' ? Promise.resolve([]) : kept('readonly', (s) => s.getAll()).catch(() => []))
  .then((items) => {
    for (const item of items.sort((a, b) => a.at - b.at)) {
      outbox.items.push({ ...item, state: 'sending', error: '', previews: item.files.map((f) => URL.createObjectURL(f)), restored: true })
    }
    told()
    pump()
  })
const landed = (jobs, item) => {
  const job = item.jobId ? jobs.find((j) => j.id === item.jobId) : null
  const first = item.photoIds?.[0]
  if (first) return jobs.some((j) => (!item.jobId || j.id === item.jobId) && j.messages.some((m) => m.photos.some((p) => p.storageId === first)))
  if (!item.jobId) return false
  if (!job) return true // the job is gone: nothing to send it to
  if (item.complete) return item.step === 'assemble' ? job.assembled : stageNo(stageId(job)) > stageNo(item.step) || finished(job)
  if (item.ordered) return job.ordered
  if (item.arrived) return job.arrived
  if (item.visitAt) return job.visitAt === item.visitAt
  if (item.boards != null) return job.messages.some((m) => m.from === SIDE && m.boards === item.boards && m.at >= item.at)
  return false
}

/* ── sending ────────────────────────────────────────────────────────────── */
/** One job's sends in turn; each new order on its own. Starts whatever is next and free to go. */
function pump() {
  if (!outbox.convex) return
  const lines = new Set()
  for (const item of outbox.items) {
    const line = item.jobId ?? item.id
    // One the books refused waits for a tap, and holds up nothing behind it.
    if (item.refused || lines.has(line)) continue
    lines.add(line)
    if (item.state === 'sending' && !item.busy && (!item.restored || outbox.live)) void run(item)
  }
}

async function run(item) {
  item.busy = true
  try {
    if (item.restored && landed(outbox.live, item)) { discard(item); return }
    item.restored = false
    // Photos that went up before a failed post are not sent up again.
    if (!item.photoIds) { item.photoIds = await upload(outbox.convex, item.files); void keep(item) }
    if (item.jobId) {
      await outbox.convex.mutation(api.workshop.send, {
        jobId: item.jobId, from: SIDE, photos: item.photoIds,
        ...(item.step ? { step: item.step } : {}),
        ...(item.boards != null ? { boards: item.boards } : {}),
        ...(item.complete ? { complete: true } : {}),
        ...(item.ordered ? { ordered: true } : {}),
        ...(item.arrived ? { arrived: true } : {}),
        ...(item.visitAt ? { visitAt: item.visitAt, callPhone: item.callPhone } : {}),
      })
    }
    else await outbox.convex.mutation(api.workshop.create, { ...item.customer, photos: item.photoIds, ...(item.priority ? { priority: true } : {}), ...(item.needs ? { assemble: item.needs.assemble, order: item.needs.order } : {}) })
    // The live list has it by now, so its stand-in goes.
    discard(item)
  } catch (err) {
    item.busy = false
    item.state = 'failed'
    // The books said no, as against no line: it will not go by trying again on its own.
    item.refused = err?.data !== undefined
    item.error = said(err)
    told()
  }
}

/** Sends again what failed; a tap on Not sent. */
export function deliver(item) {
  item.state = 'sending'
  item.error = ''
  item.refused = false
  told()
  pump()
}

/** Puts something for a job (`jobId`) or a new order (`customer`) in the outbox and starts it on its way. */
export function post(item) {
  const queued = { id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), state: 'sending', error: '', files: [], previews: [], ...item }
  outbox.items.push(queued)
  told()
  void keep(queued)
  pump()
}
export function discard(item) {
  outbox.items = outbox.items.filter((x) => x !== item)
  for (const url of item.previews) URL.revokeObjectURL(url)
  void unkeep(item)
  told()
  pump()
}
/** Given the books' line once it is there, and the live list each time it changes, which tells a restored send that has already landed. */
export function start(convex, live) {
  outbox.convex = convex
  outbox.live = live
  pump()
}
const again = () => { for (const item of outbox.items) if (item.state === 'failed' && !item.refused) { item.state = 'sending'; item.error = '' } told(); pump() }
window.addEventListener('online', again)
setInterval(() => { if (outbox.items.some((item) => item.state === 'failed' && !item.refused)) again() }, 30000)

/**
 * The jobs as this phone has them: the live list, with what is still on its
 * way already in it. Each send is put in the way the books will
 * (convex/workshop.ts `send`): a stand-in message (`pending`, its photos the
 * phone's own copies) and what it changes, the step moving on with it.
 */
const NEXT = { measurement: 'quotation', quotation: 'assemble', assemble: 'goahead', goahead: 'fitting', fitting: null }
function putIn(job, item) {
  const at = stageId(job)
  const facts = {}
  let moves = false
  if (!finished(job)) {
    if (item.complete && (at === 'measurement' || at === 'fitting')) moves = true
    else if (item.complete) facts.assembled = true
    else if (item.step === 'assemble' && item.boards != null) facts.boardsMade = item.boards
    else if (item.ordered) facts.ordered = true
    else if (item.arrived) facts.arrived = true
    else if (item.visitAt) { facts.visitAt = item.visitAt; facts.callPhone = item.callPhone; moves = true }
    else if (item.step === 'quotation') { if (item.boards != null) facts.boardsTotal = item.boards; moves = true }
    if ((facts.assembled || facts.arrived) && at === 'assemble') {
      const n = needsOf({ ...job, ...facts })
      moves = !n.assembling && !n.ordering
    }
  }
  const message = {
    id: item.id, from: SIDE, step: item.step ?? (SIDE === 'shop' ? 'visit' : at), boards: item.boards ?? null, assemble: null, order: null,
    complete: !!item.complete, ordered: !!item.ordered, arrived: !!item.arrived, visitAt: item.visitAt ?? null, callPhone: item.callPhone ?? '',
    text: '', by: '', at: item.at, pending: true,
    photos: item.previews.map((url, i) => ({ storageId: `${item.id}-${i}`, url })),
  }
  return {
    ...job, ...facts,
    ...(moves ? (NEXT[at] ? { stage: NEXT[at] } : { status: 'done' }) : {}),
    messages: [...job.messages, message],
    updatedAt: Math.max(job.updatedAt, item.at),
    [`${SIDE}SeenAt`]: Math.max(job[`${SIDE}SeenAt`] ?? 0, item.at),
  }
}
export function ahead(jobs, items) {
  if (!jobs) return jobs
  const going = items.filter((item) => item.jobId && !item.refused)
  if (!going.length) return jobs
  return jobs.map((job) => going.reduce((j, item) => (item.jobId === j.id ? putIn(j, item) : j), job))
}

/**
 * The rest of what a job's page can do (who it is for, and marking it read)
 * shows on this phone the moment it is tapped: the list here is changed first
 * and the books a moment later, which then send back the same thing. If the
 * books refuse, the list goes back to what they hold.
 */
const withJob = (store, jobId, change) => {
  const jobs = store.getQuery(api.workshop.list, {})
  if (jobs) store.setQuery(api.workshop.list, {}, jobs.flatMap((j) => (j.id !== jobId ? [j] : change(j) ?? [])))
}
export const atOnce = {
  setPriority: (store, { jobId, priority }) => withJob(store, jobId, (j) => ({ ...j, priority, updatedAt: Date.now() })),
  setNeeds: (store, { jobId, assemble, order }) => withJob(store, jobId, (j) => {
    const next = { ...j, needsAssemble: assemble, needsOrder: order, updatedAt: Date.now() }
    const n = needsOf(next)
    return stageId(j) === 'assemble' && !finished(j) && !n.assembling && !n.ordering ? { ...next, stage: 'goahead' } : next
  }),
  seen: (store, { jobId, side }) => withJob(store, jobId, (j) => ({ ...j, [`${side}SeenAt`]: Date.now() })),
  setCustomer: (store, { jobId, ledgerId, title, phones }) => {
    const account = ledgerId ? store.getQuery(api.workshop.customers, {})?.find((c) => c.id === ledgerId) : null
    withJob(store, jobId, (j) => {
      const added = phones ?? j.phones ?? []
      return { ...j, ledgerId: account?.id ?? null, title: account?.name ?? title ?? (ledgerId ? j.title : ''), place: account?.place ?? (ledgerId ? j.place : ''), phone: [account?.phone, ...added].filter(Boolean).join(', '), phones: added, updatedAt: Date.now() }
    })
  },
  // Gone from this phone at once; back again if the books refuse the PIN.
  remove: (store, { jobId }) => withJob(store, jobId, () => null),
  removeMessage: (store, { jobId, messageId }) => withJob(store, jobId, (j) => {
    const left = j.messages.filter((m) => m.id !== messageId)
    return left.length ? { ...j, messages: left } : null
  }),
  removePhoto: (store, { jobId, messageId, photo }) => withJob(store, jobId, (j) => {
    const left = j.messages.flatMap((m) => {
      if (m.id !== messageId) return [m]
      const photos = m.photos.filter((p) => p.storageId !== photo)
      const marks = m.text || m.boards != null || m.assemble != null || m.order != null || m.complete || m.ordered || m.arrived || m.visitAt != null
      return photos.length || marks ? [{ ...m, photos }] : []
    })
    return left.length ? { ...j, messages: left } : null
  }),
}
