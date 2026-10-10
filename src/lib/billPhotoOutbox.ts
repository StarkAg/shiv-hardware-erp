/**
 * Bill photographs, sent after the bill rather than before it.
 *
 * Saving used to crop, shrink and upload every attached photo, one by one,
 * before the bill itself was even sent — so Save sat there for as long as the
 * shop's upload took. Now the bill is saved at once and its new photos wait
 * here, on this PC (IndexedDB, so a reload or a closed panel loses nothing),
 * until they are uploaded and added to the saved bill and its voucher
 * (bills.addImages). Each page uploaded is remembered, so a retry never sends
 * it twice. Retried on start, when the network comes back, and every minute.
 */
import { api } from '../../convex/_generated/api'
import { asImages, crop, shrink } from '../features/ledger/lib/image'
import { toast } from '../components/Toast'
import { convexHttp } from './convexSync'

type Job = {
  id: string
  billId: string
  billNumber: string
  kind: 'bill' | 'receipt'
  files: { name: string; type: string; blob: Blob }[]
  /** Storage ids of the pages already uploaded, in order. */
  uploaded: string[]
  /** How many of `files` are already in `uploaded` (a PDF is several pages). */
  filesDone: number
  createdAt: number
  tries: number
  error?: string
}

const DB_NAME = 'shiv-panel-bill-photos'
const STORE = 'jobs'
/** A bill gone for good (deleted, never posted) stops being tried after this. */
const GIVE_UP_AFTER = 60

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Photo storage is not available in this browser.'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function inStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const connection = await db()
  return new Promise((resolve, reject) => {
    const tx = connection.transaction(STORE, mode)
    const request = run(tx.objectStore(STORE))
    tx.oncomplete = () => { connection.close(); resolve(request ? (request as IDBRequest<T>).result : undefined) }
    tx.onerror = () => { connection.close(); reject(tx.error) }
    tx.onabort = () => { connection.close(); reject(tx.error) }
  })
}

const allJobs = async () => (await inStore<Job[]>('readonly', (s) => s.getAll())) ?? []
const putJob = (job: Job) => inStore('readwrite', (s) => { s.put(job) })
const dropJob = (id: string) => inStore('readwrite', (s) => { s.delete(id) })

const listeners = new Set<(n: number) => void>()
let pending = 0
const announce = (n: number) => { pending = n; listeners.forEach((fn) => fn(n)) }
/** How many bills still have photos waiting, for a small "sending" note. */
export function onPendingPhotos(fn: (n: number) => void) {
  listeners.add(fn)
  fn(pending)
  return () => { listeners.delete(fn) }
}

/** Keep these photos for this saved bill, and start sending them. */
export async function queueBillPhotos(bill: { id: string; number: string }, kind: 'bill' | 'receipt', files: File[]) {
  if (!files.length) return
  const job: Job = {
    id: `${bill.id}-${Date.now()}`,
    billId: bill.id,
    billNumber: String(bill.number),
    kind,
    files: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
    uploaded: [],
    filesDone: 0,
    createdAt: Date.now(),
    tries: 0,
  }
  await putJob(job)
  announce((await allJobs()).length)
  void flushBillPhotos()
}

async function uploadPage(file: File): Promise<string> {
  const c = convexHttp()
  if (!c) throw new Error('Not connected to the cloud.')
  const url = await c.mutation(api.files.generateUploadUrl, {})
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  return (await res.json()).storageId as string
}

let running: Promise<void> | null = null

/** Send whatever is waiting. Safe to call any time; one run at a time. */
export function flushBillPhotos(): Promise<void> {
  running ??= (async () => {
    try {
      for (const job of await allJobs()) {
        const c = convexHttp()
        if (!c || (typeof navigator !== 'undefined' && navigator.onLine === false)) break
        try {
          // Pages not uploaded yet: shrunk and cropped here, one at a time,
          // each remembered as soon as it is up.
          for (let i = job.filesDone; i < job.files.length; i++) {
            const f = job.files[i]
            const file = new File([f.blob], f.name, { type: f.type })
            for (const page of await asImages(file)) job.uploaded.push(await uploadPage(await shrink(await crop(page))))
            job.filesDone = i + 1
            await putJob(job)
          }
          for (let i = 0; i < job.uploaded.length; i += 12) {
            await c.mutation(api.bills.addImages, { billId: job.billId, storageIds: job.uploaded.slice(i, i + 12) as never, kind: job.kind })
          }
          await dropJob(job.id)
          toast(`Bill ${job.billNumber}: ${job.uploaded.length === 1 ? 'photo' : `${job.uploaded.length} photos`} saved`, 'ok')
        } catch (err) {
          job.tries += 1
          job.error = err instanceof Error ? err.message : String(err)
          if (job.tries >= GIVE_UP_AFTER) {
            await dropJob(job.id)
            toast(`Bill ${job.billNumber}: its photo could not be added\n${job.error}`, 'error')
          } else {
            await putJob(job)
            // Said once, not every minute.
            if (job.tries === 3) toast(`Bill ${job.billNumber}: photo not sent yet, still trying\n${job.error}`, 'error')
          }
        }
      }
      announce((await allJobs()).length)
    } catch {
      /* storage unavailable: nothing to send from here */
    } finally {
      running = null
    }
  })()
  return running
}

let started = false
/** Once per page load: send what an earlier session left, and keep at it. */
export function startBillPhotoOutbox() {
  if (started || typeof window === 'undefined') return
  started = true
  void flushBillPhotos()
  window.addEventListener('online', () => { void flushBillPhotos() })
  setInterval(() => { void flushBillPhotos() }, 60_000)
}
