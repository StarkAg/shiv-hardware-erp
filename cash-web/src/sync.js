// ── Offline-first sync ──────────────────────────────────────────────────────
// The phone is the writer. Every change lands in this device's storage first
// and is shown immediately, so the book works with no signal at all — which is
// the normal case at a counter with a metal shutter half down.
//
// Alongside the local write, the same change is appended to an outbox. When the
// network comes back the outbox is flushed in the order it was written, then
// anything other devices changed is pulled down. Nothing is ever lost by being
// offline; it is only late.
//
// Two rules make a flush safe to repeat, which matters because a dropped
// response looks exactly like a failure:
//   · every row carries the id the device gave it, so the server matches rather
//     than inserts, and a replayed op lands on the same row
//   · conflicts are settled by updatedAt, so a late flush cannot overwrite a
//     newer correction made somewhere else

import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

const OUTBOX_KEY = 'shiv-cash:outbox'
const CURSOR_KEY = 'shiv-cash:sync-cursor'
const OUTBOX_MAX = 5000 // a year of writing before this is anywhere near reached

const read = (k, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? fallback } catch { return fallback }
}
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export const readOutbox = () => {
  const v = read(OUTBOX_KEY, [])
  return Array.isArray(v) ? v : []
}
const writeOutbox = (ops) => write(OUTBOX_KEY, ops.slice(-OUTBOX_MAX))

// Append a change. Called from the same place that writes it locally, so the
// two can never disagree about whether something happened.
export function queue(op) {
  const ops = readOutbox()
  ops.push({ ...op, qid: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
  writeOutbox(ops)
}

let client = null
export function convex() {
  if (client) return client
  // The same fallback the attendance app carries: this URL is public and is
  // already baked into that bundle, so the deploy does not depend on an
  // environment variable being remembered in the hosting project.
  const url = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
  if (!url) return null
  client = new ConvexHttpClient(url)
  return client
}

// Push, then pull. In that order, so a change made here is on the server before
// the server's view of the world comes back and is merged over the top of it.
export async function flush(applyPulled) {
  const c = convex()
  if (!c) return { ok: false, reason: 'no-backend' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline' }
  }

  const ops = readOutbox()
  try {
    if (ops.length) {
      // Sent in slices: a queue built up over a week offline should not go in
      // one request that times out and can never make progress.
      for (let i = 0; i < ops.length; i += 200) {
        const slice = ops.slice(i, i + 200)
        await c.mutation(anyApi.cash.push, { ops: slice.map(({ qid, ...op }) => op) })
        // Trimmed as each slice lands, so a failure halfway keeps the progress.
        const left = readOutbox().filter((o) => !slice.some((s) => s.qid === o.qid))
        writeOutbox(left)
      }
    }

    const since = read(CURSOR_KEY, 0) || 0
    const server = await c.query(anyApi.cash.pull, { since })
    if (applyPulled) applyPulled(server)
    write(CURSOR_KEY, server.serverTime)
    return { ok: true, pushed: ops.length, pulled: server.entries.length + server.closes.length + server.openings.length }
  } catch (err) {
    // The outbox is left exactly as it was, so nothing is dropped on a failure.
    return { ok: false, reason: 'error', error: String(err && err.message ? err.message : err) }
  }
}

// A full re-pull, for a device that has just been set up.
export function resetCursor() { write(CURSOR_KEY, 0) }
export const pendingCount = () => readOutbox().length
