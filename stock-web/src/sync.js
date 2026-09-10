// ── The catalog is one row, so every write has to re-read it ────────────────
// convex/catalog.ts stores the whole catalog as a single snapshot and `save`
// replaces it wholesale. Two people editing at once is therefore not a merge —
// it is a clobber, and the second save wins the whole document.
//
// This panel narrows that window to about a round trip: an edit is applied to
// the screen at once, but the write re-reads the live snapshot first and
// replays the same change onto whatever the panel or another laptop has since
// saved. The mutators below are pure functions of a snapshot for exactly that
// reason — each one runs twice, once on the local copy and once on the fresh
// server copy, and must produce the same change both times.
//
// It also means this panel is useless offline: a write with no fresh read is a
// write that can silently drop somebody else's item. So there is no service
// worker and no outbox here — unlike the cash book, which owns its rows.

import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import { normalize } from './catalog.js'

let client = null
function convex() {
  if (client) return client
  // Public deployment URL, baked in as a fallback the same way the cash book
  // does it, so a forgotten environment variable cannot break a deploy.
  const url = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'
  client = new ConvexHttpClient(url)
  return client
}

export async function fetchSnapshot() {
  const row = await convex().query(anyApi.catalog.get, {})
  return normalize(row)
}

async function saveSnapshot(snap) {
  await convex().mutation(anyApi.catalog.save, {
    hardwareCatalog: snap.hardwareCatalog,
    customCatalog: snap.customCatalog,
    sets: snap.sets,
  })
}

// Writes are queued one behind the other. Two quick edits must not race each
// other's read-modify-write, or the slower one rebuilds from a stale snapshot
// and undoes the faster one.
let chain = Promise.resolve()

/**
 * Replay `mutate` onto the live snapshot and save the result.
 * Resolves to the snapshot that is now on the server, or throws.
 */
export function commit(mutate) {
  const run = chain.then(async () => {
    const fresh = await fetchSnapshot()
    const next = mutate(fresh)
    await saveSnapshot(next)
    return next
  })
  // The queue must survive a failed write, otherwise one error stops every
  // later edit from ever being attempted.
  chain = run.catch(() => {})
  return run
}
