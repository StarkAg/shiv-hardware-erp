/**
 * Convex push helpers — used by the Zustand store to push changes to Convex.
 * Uses ConvexHttpClient (no React needed) so it can be called from store.ts.
 *
 * Real-time subscription (pull direction) is handled by <ConvexSync> which
 * uses useQuery hooks and keeps the Zustand store updated without loops.
 */
import { ConvexHttpClient } from 'convex/browser'
import { authorizeHttp } from './deviceTrust/deviceTrust.js'
import { api } from '../../convex/_generated/api'
import type { Bill, BrandSet, CustomCatalogEntry, HardwareCatalog, TotoDriver } from './types'

const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? '').trim()

// A new client for each call, never a shared one: a ConvexHttpClient runs its
// calls one at a time, and one that never answered held every later push and
// delete behind it until a reload. They are plain HTTP requests. Carries this
// device's trust token (see lib/deviceTrust), read fresh each time.
function client(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null
  return authorizeHttp(new ConvexHttpClient(CONVEX_URL))
}

export const convexEnabled = () => Boolean(CONVEX_URL)

/**
 * A client of its own for the background outboxes (posting, bill photos).
 *
 * A ConvexHttpClient runs its mutations one at a time, in a queue. Sharing the
 * one above put a bill's posting behind the whole-bill-list push that follows
 * every save — and one call that never answered held every bill behind it at
 * "Posting…" until the page was reloaded (2026-10-10).
 */
//
// A new one for every call: a client whose call never answers keeps its own
// queue blocked behind it even after the caller has given up waiting, so no
// client is kept to be blocked. They are plain HTTP requests; nothing is lost.
export const convexHttp = (): ConvexHttpClient | null =>
  CONVEX_URL ? authorizeHttp(new ConvexHttpClient(CONVEX_URL)) : null

/** A call that has not answered in `ms` is given up as unreachable, so a queue is never held by it. */
export function withTimeout<T>(work: Promise<T>, ms = 25_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer from the cloud in ${Math.round(ms / 1000)} s`)), ms)
    work.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

/**
 * The shop's highest GC-<year>-NNNN already saved, so this device's counter
 * can't reissue a number another device (or a fresh install) already used.
 * Null when offline / no Convex — the local counter stands as before.
 */
export async function fetchLatestGuaranteeSeq(year: number): Promise<number | null> {
  const c = client()
  if (!c) return null
  try {
    return await c.query(api.documents.latestGuaranteeSeq, { year })
  } catch {
    return null
  }
}

/** Push all bills to Convex. Fire-and-forget. */
export async function pushBillsToConvex(bills: Bill[], billSeq: number): Promise<void> {
  const c = client()
  if (!c) return
  try {
    await withTimeout(c.mutation(api.bills.save, { bills, billSeq }), 60_000)
  } catch {
    // Offline or Convex unavailable — silently ignore
  }
}

/**
 * Deleting a bill, properly: it goes to the trash and takes its ledger voucher
 * with it. Not fire-and-forget — the caller wants to know, because a delete
 * that only happened on this device is how a bill comes back tomorrow.
 *
 * The three answers are different things, and the caller has to tell them
 * apart: the server deleted it, the server never had it (a bill typed here and
 * never posted, or no Convex at all — deleting locally is the whole job), or
 * the server could not be reached, where deleting locally would be a lie.
 */
export type BillRemoval = 'removed' | 'absent' | 'unreachable'

export async function removeBillFromConvex(id: string): Promise<BillRemoval> {
  const c = client()
  if (!c) return 'absent'
  try {
    const res = await withTimeout(c.mutation(api.bills.remove, { id }))
    return (res as { removed?: boolean } | null)?.removed ? 'removed' : 'absent'
  } catch {
    return 'unreachable'
  }
}

/** Push the full catalog to Convex. Fire-and-forget. */
/** Toto contacts + availability tags — one snapshot row, same as the catalog. */
export async function pushTotoToConvex(drivers: TotoDriver[]): Promise<void> {
  const c = client()
  if (!c) return
  try {
    await c.mutation(api.toto.save, { drivers })
  } catch {
    // Offline — silently ignore
  }
}

type CatalogPush =
  | { ok: true; conflict: false; version: number }
  | { ok: true; conflict: true }
  | { ok: false; error: string }

/**
 * Save the price list against the version it was edited from. Says what
 * happened — saved, refused because another device saved first, or failed —
 * instead of swallowing it: a rate change that never reached the server used
 * to look exactly like one that did.
 */
export async function pushCatalogToConvex(catalog: {
  hardwareCatalog: HardwareCatalog
  customCatalog: CustomCatalogEntry[]
  sets: BrandSet[]
}, baseVersion: number): Promise<CatalogPush> {
  const c = client()
  if (!c) return { ok: false, error: 'No connection to the cloud is set up.' }
  try {
    const res = await c.mutation(api.catalog.save, { ...catalog, baseVersion }) as
      { ignored: boolean; conflict?: boolean; version?: number; reason?: string }
    if (res.conflict) return { ok: true, conflict: true }
    if (res.ignored) return { ok: false, error: res.reason ?? 'The cloud did not take it.' }
    return { ok: true, conflict: false, version: res.version ?? baseVersion + 1 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The price list as the server has it now, with its version. */
export async function fetchCatalogFromConvex() {
  const c = client()
  if (!c) return null
  try {
    const row = await c.query(api.catalog.get, {})
    return row
      ? { hardwareCatalog: row.hardwareCatalog, customCatalog: row.customCatalog, sets: row.sets, version: row.version ?? 0 }
      : null
  } catch {
    return null
  }
}

/** Aluminium costing (lib/aluCostingStore): the server's copy, or null. */
export async function fetchAluCosting(): Promise<{ data: unknown; savedAt: number } | null> {
  const c = client()
  if (!c) return null
  try {
    const row = await c.query(api.aluCosting.get, {})
    return row ? { data: row.data, savedAt: row.savedAt } : null
  } catch {
    return null
  }
}

/** Sends this device's aluminium costing; false when it did not reach the server. */
export async function pushAluCosting(data: unknown, savedAt: number): Promise<boolean> {
  const c = client()
  if (!c) return false
  try {
    await c.mutation(api.aluCosting.save, { data, savedAt })
    return true
  } catch {
    return false
  }
}
