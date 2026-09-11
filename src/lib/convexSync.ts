/**
 * Convex push helpers — used by the Zustand store to push changes to Convex.
 * Uses ConvexHttpClient (no React needed) so it can be called from store.ts.
 *
 * Real-time subscription (pull direction) is handled by <ConvexSync> which
 * uses useQuery hooks and keeps the Zustand store updated without loops.
 */
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Bill, BrandSet, CustomCatalogEntry, HardwareCatalog, TotoDriver } from './types'

const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? '').trim()

let _client: ConvexHttpClient | null = null
function client(): ConvexHttpClient | null {
  if (!CONVEX_URL) return null
  _client ??= new ConvexHttpClient(CONVEX_URL)
  return _client
}

export const convexEnabled = () => Boolean(CONVEX_URL)

/** Push all bills to Convex. Fire-and-forget. */
export async function pushBillsToConvex(bills: Bill[], billSeq: number): Promise<void> {
  const c = client()
  if (!c) return
  try {
    await c.mutation(api.bills.save, { bills, billSeq })
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
    const res = await c.mutation(api.bills.remove, { id })
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

export async function pushCatalogToConvex(catalog: {
  hardwareCatalog: HardwareCatalog
  customCatalog: CustomCatalogEntry[]
  sets: BrandSet[]
}): Promise<void> {
  const c = client()
  if (!c) return
  try {
    await c.mutation(api.catalog.save, catalog)
  } catch {
    // Offline — silently ignore
  }
}
