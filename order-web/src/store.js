// ── Offline-first store ─────────────────────────────────────────────────────
// Lifted from the cash book, because the mechanic's phone at a customer's
// house is the same problem as the counter under a half-closed shutter: the
// write has to land and be visible with no signal at all.
//
// Every change goes to this device's storage first and is shown immediately.
// The same change is appended to an outbox, and when the network returns the
// outbox is flushed in the order it was written, then anything other devices
// changed is pulled down.
//
// Two rules make a replayed flush safe, which matters because a dropped
// response looks exactly like a failure:
//   · every job carries the id the device gave it, so the server matches
//     rather than inserts
//   · conflicts are settled by updatedAt, so a late flush cannot overwrite a
//     newer correction made at the counter

import { ConvexHttpClient } from 'convex/browser'
import { authorizeHttp } from './deviceTrust/deviceTrust.js'
import { anyApi } from 'convex/server'

const JOBS_KEY = 'shiv-orders:jobs'
const OUTBOX_KEY = 'shiv-orders:outbox'
const CURSOR_KEY = 'shiv-orders:cursor'
const OUTBOX_MAX = 2000

const read = (k, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? fallback } catch { return fallback }
}
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export const readJobs = () => {
  const v = read(JOBS_KEY, [])
  return Array.isArray(v) ? v : []
}
export const writeJobs = (jobs) => write(JOBS_KEY, jobs)

export const readOutbox = () => {
  const v = read(OUTBOX_KEY, [])
  return Array.isArray(v) ? v : []
}
const writeOutbox = (ops) => write(OUTBOX_KEY, ops.slice(-OUTBOX_MAX))

export function queue(op) {
  const ops = readOutbox()
  ops.push({ ...op, qid: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
  writeOutbox(ops)
}

export const pendingCount = () => readOutbox().length

let client = null
function convex() {
  if (client) return authorizeHttp(client)
  // Public URL, baked in the same way the cash book bakes it: the deploy must
  // not depend on an environment variable being remembered in the hosting
  // project a year from now.
  const url = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
  if (!url) return null
  client = new ConvexHttpClient(url)
  // Carries this device's trust token; read each time, so a device trusted a
  // moment ago is not still calling without it.
  return authorizeHttp(client)
}

/** Push, then pull — so a change made here is on the server before the
 *  server's view comes back and is merged over the top of it. */
export async function flush(applyPulled) {
  const c = convex()
  if (!c) return { ok: false, reason: 'no-backend' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline' }
  }

  const ops = readOutbox()
  try {
    if (ops.length) {
      for (let i = 0; i < ops.length; i += 100) {
        const slice = ops.slice(i, i + 100)
        await c.mutation(anyApi.jobs.push, { ops: slice.map(({ qid, ...op }) => op) })
        const left = readOutbox().filter((o) => !slice.some((s) => s.qid === o.qid))
        writeOutbox(left)
      }
    }

    const since = read(CURSOR_KEY, 0) || 0
    const server = await c.query(anyApi.jobs.pull, { since })
    if (applyPulled) applyPulled(server.jobs || [])
    write(CURSOR_KEY, server.serverTime)
    return { ok: true, pushed: ops.length, pulled: (server.jobs || []).length }
  } catch (err) {
    // The outbox is left exactly as it was, so nothing is dropped on a failure.
    return { ok: false, reason: 'error', error: String(err?.message ?? err) }
  }
}

/** The advance goes into the drawer through the cash book's own door, so the
 *  register and the pad stop being two sets of figures. */
export async function postAdvance({ jobId, number, date, name, amount, mode }) {
  const c = convex()
  if (!c) return { ok: false }
  try {
    await c.mutation(anyApi.jobs.postAdvance, {
      // Derived from the job, so a retried flush writes the same drawer note
      // rather than a second one.
      entryId: `job-${jobId}-advance`,
      date,
      name: `${name} — advance ord ${number}`,
      amount,
      mode: mode || 'cash',
      at: Date.now(),
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

/** The pad number the server has not seen used yet. */
export async function nextNumberFromServer() {
  const c = convex()
  if (!c) return null
  try {
    const r = await c.query(anyApi.jobs.nextNumber, {})
    return r?.next ?? null
  } catch { return null }
}

export function resetCursor() { write(CURSOR_KEY, 0) }

export const uid = (p = 'j') => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export const todayKey = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const fmtDate = (key) => {
  if (!key) return ''
  const [y, m, d] = String(key).split('-')
  return `${d}-${m}-${String(y).slice(2)}`
}

/** Merge what the server sent over what this device holds, newest wins. */
export function mergeJobs(local, incoming) {
  const byId = new Map(local.map((j) => [j.id, j]))
  for (const row of incoming) {
    const mine = byId.get(row.jobId)
    const theirs = {
      id: row.jobId,
      number: row.number,
      status: row.status,
      customer: row.customer || {},
      estimate: row.estimate || null,
      openings: row.openings || [],
      order: row.order || null,
      variance: row.variance || null,
      at: row.at,
      updatedAt: row.updatedAt,
      deleted: !!row.deleted,
    }
    if (!mine || theirs.updatedAt >= (mine.updatedAt || 0)) byId.set(theirs.id, theirs)
  }
  return [...byId.values()].sort((a, b) => (b.at || 0) - (a.at || 0))
}
