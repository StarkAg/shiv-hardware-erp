import { useMemo, useSyncExternalStore } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useStore } from './store'
// The ledger's live-with-a-kept-copy query, plain JS.
import { useLive } from '../features/ledger/lib/cache'

/**
 * The phone's bill photos waiting to be filed, in one place.
 *
 * Two queues feed the counter: the voucher shooter's (voucherInbox) and the
 * older panel camera's (inbox). Every screen used to read and file them its own
 * way, and a photo saved onto a bill stayed under From the phone for seconds
 * after Save: the list opened on its kept copy, which still held it, and the
 * claim that took it off the queue went one photo at a time behind the save.
 *
 * Now a photo leaves the list the moment it is filed or discarded here, kept
 * copy or not, and comes back only if the queue refused to let it go.
 */

export type PhoneSource = 'voucher' | 'legacy'
export type PhonePhoto = {
  _id: string
  storageId: string
  at: number
  url: string | null
  groupId?: string
  queueNo?: number
  note?: string
  stack?: unknown
  source: PhoneSource
}
/** What a screen holds of a chosen photo: enough to say which queue it is on. */
type Chosen = { _id: string; source?: PhoneSource }

let hidden: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((listen) => listen())

function hide(ids: string[]) {
  if (!ids.length) return
  hidden = new Set([...hidden, ...ids])
  tell()
}

function unhide(ids: string[]) {
  if (!ids.length) return
  const back = new Set(ids)
  hidden = new Set([...hidden].filter((id) => !back.has(id)))
  tell()
}

function useHidden(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listen) => { listeners.add(listen); return () => { listeners.delete(listen) } },
    () => hidden,
  )
}

/** Leaves out what was filed or discarded on this screen; undefined while loading. */
export function withoutHidden<T extends { _id: string }>(rows: T[] | undefined, gone: ReadonlySet<string>) {
  return rows?.filter((row) => !gone.has(String(row._id)))
}

/**
 * Both queues as one list, newest first, each photo saying which queue it is
 * on. The older camera's lettered stacks belong to the sorting site and are
 * left out. Undefined until both have loaded.
 *
 * A photo already on a bill is left out too. The list opens on its kept copy,
 * and a photo filed since — on this PC before a refresh, or on another PC —
 * was still offered beside the next new bill until the live list came in.
 */
export function usePhoneQueue(): PhonePhoto[] | undefined {
  const voucher = useLive(api.voucherInbox.list, {}, 'voucher-inbox') as Omit<PhonePhoto, 'source'>[] | undefined
  const legacy = useLive(api.inbox.list, {}, 'inbox') as Omit<PhonePhoto, 'source'>[] | undefined
  const gone = useHidden()
  const bills = useStore((st) => st.bills)
  const onBills = useMemo(
    () => new Set(bills.flatMap((b) => (b.attachments ?? []).map((a) => String(a.storageId)))),
    [bills],
  )
  return useMemo(() => {
    if (voucher === undefined || legacy === undefined) return undefined
    const waiting = <T extends { storageId: string }>(row: T) => !onBills.has(String(row.storageId))
    return [
      ...withoutHidden(voucher, gone)!.filter(waiting).map((row) => ({ ...row, source: 'voucher' as const })),
      ...withoutHidden(legacy, gone)!.filter((row) => !row.stack && waiting(row)).map((row) => ({ ...row, source: 'legacy' as const })),
    ].sort((a, b) => b.at - a.at)
  }, [voucher, legacy, gone, onBills])
}

/** The older camera's own shots, stacks and all, for its capture screen. */
export function useLegacyShots(): Omit<PhonePhoto, 'source'>[] | undefined {
  const legacy = useLive(api.inbox.list, {}, 'inbox') as Omit<PhonePhoto, 'source'>[] | undefined
  const gone = useHidden()
  return useMemo(() => withoutHidden(legacy, gone), [legacy, gone])
}

const onQueue = (photos: Chosen[], source: PhoneSource) =>
  photos.filter((p) => (p.source === 'voucher') === (source === 'voucher')).map((p) => p._id) as never[]

/** Filing, discarding and splitting, the same on every screen. */
export function usePhonePhotoActions() {
  const claimAll = useMutation(api.voucherInbox.claimAll)
  const discardVoucher = useMutation(api.voucherInbox.discard)
  const discardLegacy = useMutation(api.inbox.discard)
  const splitVoucher = useMutation(api.voucherInbox.split)
  const splitLegacy = useMutation(api.inbox.split)

  return useMemo(() => ({
    /**
     * The photos a saved bill took, off the queues: gone from the list at
     * once, claimed in one call, back if that call fails. True when claimed.
     */
    async file(photos: Chosen[]): Promise<boolean> {
      if (!photos.length) return true
      const ids = photos.map((p) => p._id)
      hide(ids)
      try {
        await claimAll({ ids: onQueue(photos, 'voucher'), legacyIds: onQueue(photos, 'legacy') })
        return true
      } catch {
        unhide(ids)
        return false
      }
    },

    /**
     * Thrown away, file and all. Gone from the list at once; one the queue
     * would not let go comes back, and the error is passed on. `onRemoved`
     * hears each one that went, so a screen holding it chosen can let go too.
     */
    async discard(photos: Chosen[], onRemoved?: (id: string) => void) {
      const ids = photos.map((p) => p._id)
      hide(ids)
      const removed = new Set<string>()
      try {
        for (const p of photos) {
          await (p.source === 'voucher' ? discardVoucher : discardLegacy)({ id: p._id as never })
          removed.add(p._id)
          onRemoved?.(p._id)
        }
      } finally {
        unhide(ids.filter((id) => !removed.has(id)))
      }
    },

    /** Pages shot as one bill that are really several: each waits on its own. */
    async split(photos: Chosen[]) {
      const voucher = onQueue(photos, 'voucher')
      const legacy = onQueue(photos, 'legacy')
      if (voucher.length) await splitVoucher({ ids: voucher })
      if (legacy.length) await splitLegacy({ ids: legacy })
    },
  }), [claimAll, discardVoucher, discardLegacy, splitVoucher, splitLegacy])
}
