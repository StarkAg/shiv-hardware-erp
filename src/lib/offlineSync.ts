import type { Customer, GuaranteeDocument, Quotation } from './types'
import { CLOUD_API_URL, saveCloudGuarantee, saveCloudQuotation, upsertCloudCustomer } from './cloudApi'

type SyncJob =
  | { kind: 'customer'; localId: string; payload: Customer; queuedAt: number }
  | { kind: 'quotation'; localId: string; payload: Quotation; queuedAt: number }
  | { kind: 'guarantee'; localId: string; payload: GuaranteeDocument; queuedAt: number }

const KEY = 'shiv-panel:sync-queue:v1'
let flushing = false

function canUseStorage() {
  return typeof localStorage !== 'undefined'
}

function readQueue(): SyncJob[] {
  if (!canUseStorage()) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]') as SyncJob[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: SyncJob[]) {
  if (!canUseStorage()) return
  localStorage.setItem(KEY, JSON.stringify(queue))
}

function online() {
  return typeof navigator === 'undefined' || navigator.onLine
}

function replaceOrAppend(job: SyncJob) {
  const queue = readQueue()
  const index = queue.findIndex((item) => item.kind === job.kind && item.localId === job.localId)
  if (index >= 0) queue[index] = job
  else queue.push(job)
  writeQueue(queue)
}

async function syncJob(job: SyncJob) {
  if (job.kind === 'customer') {
    if (!job.payload.name.trim()) return
    await upsertCloudCustomer(job.payload)
    return
  }

  if (job.kind === 'quotation') {
    await saveCloudQuotation(job.payload)
    return
  }

  await saveCloudGuarantee(job.payload)
}

export function enqueueCustomerSync(customer: Customer) {
  replaceOrAppend({ kind: 'customer', localId: customer.id, payload: customer, queuedAt: Date.now() })
  void flushOfflineSync()
}

export function enqueueQuotationSync(quote: Quotation) {
  replaceOrAppend({ kind: 'quotation', localId: quote.id, payload: quote, queuedAt: Date.now() })
  void flushOfflineSync()
}

export function enqueueGuaranteeSync(document: GuaranteeDocument) {
  replaceOrAppend({ kind: 'guarantee', localId: document.id, payload: document, queuedAt: Date.now() })
  if (document.customer.name.trim()) enqueueCustomerSync(document.customer)
  void flushOfflineSync()
}

export async function flushOfflineSync() {
  if (flushing || !CLOUD_API_URL || !online()) return
  flushing = true

  try {
    const queue = readQueue()
    const remaining: SyncJob[] = []

    for (const job of queue) {
      try {
        await syncJob(job)
      } catch {
        remaining.push(job)
      }
    }

    writeQueue(remaining)
  } finally {
    flushing = false
  }
}

export function startOfflineSync() {
  if (typeof window === 'undefined') return
  window.addEventListener('online', () => void flushOfflineSync())
  void flushOfflineSync()
}

