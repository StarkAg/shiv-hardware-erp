/**
 * <ConvexSync /> — mounts inside <ConvexProvider>, subscribes to the real-time
 * Convex queries for bills and catalog, and keeps the Zustand store in sync.
 *
 * Uses syncBillsFromRemote / syncCatalogFromRemote — loop-safe store actions
 * that save to localStorage but do NOT push back to any remote.
 */
import { useEffect } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useStore } from '../lib/store'
import type { Bill, BrandSet, CustomCatalogEntry, HardwareCatalog } from '../lib/types'

export function ConvexSync() {
  const serverBills   = useQuery(api.bills.get,   {})
  const serverCatalog = useQuery(api.catalog.get, {})

  const {
    bills, billSeq,
    syncBillsFromRemote,
    syncCatalogFromRemote,
  } = useStore()

  // Sync bills: apply when Convex has more bills or a higher sequence number
  useEffect(() => {
    if (!serverBills?.bills?.length) return
    const remoteBillSeq = (serverBills.billSeq as number) ?? 0
    if (remoteBillSeq > billSeq || serverBills.bills.length > bills.length) {
      syncBillsFromRemote(serverBills.bills as Bill[], remoteBillSeq)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBills])

  // Sync catalog: apply whenever Convex has a catalog snapshot
  useEffect(() => {
    if (!serverCatalog) return
    syncCatalogFromRemote({
      hardwareCatalog: serverCatalog.hardwareCatalog as HardwareCatalog,
      customCatalog:   serverCatalog.customCatalog   as CustomCatalogEntry[],
      sets:            serverCatalog.sets            as BrandSet[],
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCatalog])

  return null
}
