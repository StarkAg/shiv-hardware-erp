/**
 * Convex push helpers — used by the Zustand store to push changes to Convex.
 * Uses ConvexHttpClient (no React needed) so it can be called from store.ts.
 *
 * Real-time subscription (pull direction) is handled by <ConvexSync> which
 * uses useQuery hooks and keeps the Zustand store updated without loops.
 */
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Bill, BrandSet, CustomCatalogEntry, HardwareCatalog } from './types'

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

/** Push the full catalog to Convex. Fire-and-forget. */
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
