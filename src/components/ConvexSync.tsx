/**
 * <ConvexSync /> — mounts inside <ConvexProvider>, subscribes to the real-time
 * Convex queries for bills and catalog, and keeps the Zustand store in sync.
 *
 * Uses syncBillsFromRemote / syncCatalogFromRemote — loop-safe store actions
 * that save to localStorage but do NOT push back to any remote.
 */
import { useEffect, useRef } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useStore } from '../lib/store'
import type { Bill, BrandSet, CustomCatalogEntry, HardwareCatalog } from '../lib/types'

export function ConvexSync() {
  const serverBills   = useQuery(api.bills.get,   {})
  const serverCatalog = useQuery(api.catalog.get, {})
  const deletedIds    = useQuery(api.bills.deletedIds, {})

  const {
    bills, billSeq,
    syncBillsFromRemote,
    syncCatalogFromRemote,
    dropBills,
  } = useStore()

  // Sync bills. The old rule only accepted a snapshot with MORE bills or a
  // higher sequence, so edits to an existing bill never arrived — you could not
  // watch a bill being written on another machine. Now any newer snapshot is
  // taken, except while this device is itself editing, where an incoming write
  // would overwrite the operator's in-progress line.
  const lastApplied = useRef(0)
  useEffect(() => {
    // No snapshot row at all is "nothing to say"; a row with no bills in it is
    // a real answer, and once deletions travel it is a possible one.
    if (!serverBills?.bills) return
    const savedAt = (serverBills.savedAt as number) ?? 0
    const remoteBillSeq = (serverBills.billSeq as number) ?? 0
    const newer = savedAt > lastApplied.current
    const grew = remoteBillSeq > billSeq || serverBills.bills.length > bills.length

    // Safe to apply even while editing: the merge keeps whichever copy of each
    // bill changed last, and this device's open bill is being stamped every
    // couple of seconds by the draft autosave.
    if (!newer && !grew) return

    lastApplied.current = savedAt
    syncBillsFromRemote(serverBills.bills as Bill[], Math.max(remoteBillSeq, billSeq))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBills])

  // Deletions travel on their own. Merging only ever adds, so a bill deleted
  // at one counter used to stay on the other for good.
  useEffect(() => {
    if (deletedIds?.length) dropBills(deletedIds as string[])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletedIds])

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
