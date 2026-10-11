import { useSyncExternalStore } from 'react'
import { SIDE } from './side.js'
import { api, said } from './flow.js'

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
 * Send shows the photo in the job at once and returns; the upload and the
 * post happen behind it, so nobody stands on a site watching a spinner. A
 * send that fails (no signal) stays in the job marked Not sent and is tried
 * again by itself when the phone is back online, or on a tap.
 *
 * Kept in memory: a send still on its way when the app is closed is lost, and
 * is simply sent again.
 */
export const outbox = { items: [], listeners: new Set(), convex: null }
const told = () => { outbox.items = [...outbox.items]; for (const fn of outbox.listeners) fn() }
const watch = (fn) => { outbox.listeners.add(fn); return () => outbox.listeners.delete(fn) }
const held = () => outbox.items
export const useOutbox = () => useSyncExternalStore(watch, held, held)

export async function deliver(item) {
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

/** Puts something for a job (`jobId`) or a new order (`customer`) in the outbox and starts it on its way. */
export function post(item) {
  const queued = { id: `out-${Date.now()}-${outbox.items.length}`, at: Date.now(), state: 'sending', error: '', files: [], previews: [], ...item }
  outbox.items.push(queued)
  told()
  void deliver(queued)
}
export function discard(item) {
  outbox.items = outbox.items.filter((x) => x !== item)
  for (const url of item.previews) URL.revokeObjectURL(url)
  told()
}
window.addEventListener('online', () => { for (const item of outbox.items) if (item.state === 'failed') void deliver(item) })

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
  seen: (store, { jobId, side }) => withJob(store, jobId, (j) => ({ ...j, [`${side}SeenAt`]: Date.now() })),
  setCustomer: (store, { jobId, ledgerId, title }) => {
    const account = ledgerId ? store.getQuery(api.workshop.customers, {})?.find((c) => c.id === ledgerId) : null
    withJob(store, jobId, (j) => ({ ...j, ledgerId: account?.id ?? null, title: account?.name ?? title ?? '', place: account?.place ?? '', phone: account?.phone ?? '', updatedAt: Date.now() }))
  },
}
