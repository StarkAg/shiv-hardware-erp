/**
 * Bills posted to the books in the background.
 *
 * Save used to wait for the books' answer — a trip to the cloud of half a
 * second or more from the shop — before the screen moved on. Now the bill is
 * kept on this PC first, marked `pendingPost`, and the screen moves on at
 * once; this queue sends it and adopts what the books answer (the number, the
 * voucher, the party account). Only which bills are waiting is kept here, in
 * localStorage: the bills themselves are already saved in the store, and the
 * latest copy is what gets sent.
 *
 * A bill the books refuse is marked `postError` and shows as "Not posted" with
 * a Retry in the day book, as before. A network failure is not a refusal: it
 * is tried again — at start, when the network comes back, and on a timer.
 *
 * A retry after a reply that never arrived cannot post twice: the books find
 * the bill's voucher by its BILL- reference and refuse the second copy as
 * "changed elsewhere", handing back their copy of this same bill — which is
 * then simply adopted.
 */
import { api } from '../../convex/_generated/api'
import { toast } from '../components/Toast'
import { convexHttp, withTimeout } from './convexSync'
import { useStore } from './store'
import { flushBillPhotos } from './billPhotoOutbox'
import type { Bill } from './types'

type Job = {
  billId: string
  /** The voucher's revision when the bill was opened; null for a bill new to the books. Undefined: no check. */
  expectedRev?: number | null
  attempts: number
  nextAt: number
  /** Why the last try did not get through, shown beside "Posting…". */
  lastError?: string
}

const KEY = 'shiv-panel:post-outbox:v1'
const plain = (x: unknown) => JSON.parse(JSON.stringify(x))

function readJobs(): Job[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Job[] } catch { return [] }
}
function writeJobs(jobs: Job[]) {
  try { localStorage.setItem(KEY, JSON.stringify(jobs)) } catch { /* the bill itself is still in the store */ }
}

const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())
/** Called whenever the queue changes, for "posting…" marks. */
export function onPostQueue(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export const isPosting = (billId: string) => readJobs().some((j) => j.billId === billId)
/** Why a waiting bill has not got through yet, if a try has failed. */
export const postingTrouble = (billId: string) => readJobs().find((j) => j.billId === billId)?.lastError

/**
 * Keep this bill on the PC as waiting for the books, and send it. Returns at
 * once; the store copy is marked `pendingPost` so every screen can say so.
 */
export function queuePost(bill: Bill, expectedRev: number | null | undefined) {
  useStore.getState().saveBill({ ...bill, pendingPost: Date.now(), postError: undefined })
  const jobs = readJobs().filter((j) => j.billId !== bill.id)
  // An edit of a bill still waiting keeps the revision it was first opened at.
  const earlier = readJobs().find((j) => j.billId === bill.id)
  jobs.push({ billId: bill.id, expectedRev: earlier ? earlier.expectedRev : expectedRev, attempts: 0, nextAt: 0 })
  writeJobs(jobs)
  changed()
  void flushPosts()
}

const backoff = (attempts: number) => Math.min(60_000, 3_000 * 2 ** Math.max(0, attempts - 1))

function finish(billId: string) {
  writeJobs(readJobs().filter((j) => j.billId !== billId))
  changed()
}

let running: Promise<void> | null = null

/** Send what is due. One run at a time; safe to call whenever. */
export function flushPosts(): Promise<void> {
  running ??= (async () => {
    try {
      for (const job of readJobs()) {
        if (job.nextAt > Date.now()) continue
        const client = convexHttp()
        if (!client || (typeof navigator !== 'undefined' && navigator.onLine === false)) break
        const store = useStore.getState()
        const bill = store.bills.find((b) => b.id === job.billId)
        // Deleted while waiting: nothing to send.
        if (!bill) { finish(job.billId); continue }
        const { pendingPost: _p, postError: _e, ...sending } = bill
        try {
          const res = await withTimeout(client.mutation(api.billLedger.postBill, {
            bill: plain(sending) as never,
            attachments: (bill.attachments ?? []) as never,
            keepAsBill: true,
            ...(job.expectedRev !== undefined ? { expectedRev: job.expectedRev } : {}),
          }))
          adopt(bill, (res as { bill?: Bill })?.bill ?? {})
          finish(job.billId)
          void flushBillPhotos()
        } catch (err) {
          const data = (err as { data?: unknown })?.data
          if (data === undefined) {
            // No answer from the books at all — the network. Try again later.
            const why = err instanceof Error ? err.message : String(err)
            console.warn(`[posting] bill ${bill.number}: ${why}`)
            const jobs = readJobs().map((j) => (j.billId === job.billId
              ? { ...j, attempts: j.attempts + 1, nextAt: Date.now() + backoff(j.attempts + 1), lastError: why }
              : j))
            writeJobs(jobs)
            changed()
            if (job.attempts + 1 === 4) toast(`Bill ${bill.number} is saved on this PC; the books will get it when the internet is back.`, 'info')
            continue
          }
          const stale = data && typeof data === 'object' && (data as { code?: string }).code === 'stale'
          const newer = stale ? (data as { newer?: Bill | null }).newer : null
          if (stale && job.attempts > 0 && newer?.voucherId) {
            // An earlier try did reach the books; its answer was lost on the way back.
            adopt(bill, newer)
            finish(job.billId)
            continue
          }
          const message = stale
            ? 'Changed on another counter since it was opened. Open it to see the newer copy.'
            : typeof data === 'string' ? data : (err instanceof Error ? err.message : String(err))
          useStore.getState().saveBill({ ...bill, pendingPost: undefined, postError: message })
          finish(job.billId)
          toast(`Bill ${bill.number} was not posted to the books\n${message}`, 'error')
        }
      }
    } finally {
      running = null
    }
  })()
  return running
}

/** The books' answer is the bill now: their number, voucher and account. */
function adopt(local: Bill, answer: Partial<Bill>) {
  // The latest local copy, in case it was edited again while this was in flight.
  const current = useStore.getState().bills.find((b) => b.id === local.id) ?? local
  const stored = { ...current, ...answer } as Bill
  delete stored.postError
  delete stored.pendingPost
  useStore.getState().saveBill(stored)
}

let started = false
/** Once per page load: send what an earlier session left waiting, and keep at it. */
export function startPostOutbox() {
  if (started || typeof window === 'undefined') return
  started = true
  // A bill marked waiting whose job was lost (storage cleared) is queued again.
  const waiting = new Set(readJobs().map((j) => j.billId))
  for (const b of useStore.getState().bills) {
    if (b.pendingPost && !waiting.has(b.id)) {
      writeJobs([...readJobs(), { billId: b.id, expectedRev: b.voucherId ? undefined : null, attempts: 0, nextAt: 0 }])
    }
  }
  void flushPosts()
  window.addEventListener('online', () => { void flushPosts() })
  setInterval(() => { void flushPosts() }, 5_000)
}
