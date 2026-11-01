import { canonicalUnit, foldName, properText } from '../../convex/lib/text'
import { create } from 'zustand'
import type { Bill, Brand, BrandSet, CustomCatalogEntry, Customer, GuaranteeDocument, HardwareCatalog, ProductCategory, Quotation, TotoAvailability, TotoDriver, VehicleType } from './types'
import { DEFAULT_HARDWARE_CATALOG, TOTO_SEED } from './types'
import { SEED_SETS } from './data/brands'
import { db, type PersistedState } from './db/adapter'
import { enqueueCustomerSync, enqueueQuotationSync } from './offlineSync'
import { fetchCatalogFromConvex, pushBillsToConvex, pushCatalogToConvex, pushTotoToConvex, removeBillFromConvex } from './convexSync'
import { applyCatalogDiff, catalogDiff, isEmptyDiff, type CatalogSnap } from './catalogMerge'
import { toast } from '../components/Toast'
import { indiaYear } from './businessDate'

const uid = () => Math.random().toString(36).slice(2, 10)
const codeSets = (sets: BrandSet[]): BrandSet[] => sets.map((s, i) => ({ ...s, name: `C${i + 1}` }))

/*
 * The bills, the catalogue and the guarantee cards used to be pushed to a print
 * server on the shop's Wi-Fi as well as to Convex. Each push searched for that
 * server first, and with it switched off the search ended in a scan of a
 * thousand addresses — so typing a customer's name set off a subnet scan.
 *
 * Convex carries all three, from anywhere, and the schedulers below are what
 * actually keep the counters in step.
 */

// Convex push — slightly longer debounce (5s) to batch more changes
let _convexBillsTimer: ReturnType<typeof setTimeout> | null = null
function scheduleConvexBillsPush(get: () => AppState) {
  if (_convexBillsTimer) clearTimeout(_convexBillsTimer)
  _convexBillsTimer = setTimeout(() => {
    const s = get()
    /**
     * A bill whose posting failed is not pushed. Sending it would put a bill
     * on the server that the books have never heard of — the exact drift the
     * single posting transaction exists to prevent. It waits here, marked, for
     * a retry. Bills written before any of this have no stamp and are pushed
     * as they always were.
     */
    // Nor one still waiting for the books (src/lib/postOutbox.ts): the
    // posting writes it to the server itself, with its voucher.
    void pushBillsToConvex(s.bills.filter((b) => !b.postError && !b.pendingPost), s.billSeq)
  }, 5000)   // a watching screen is at most this far behind
}

let _convexTotoTimer: ReturnType<typeof setTimeout> | null = null
function scheduleConvexTotoPush(get: () => AppState) {
  if (_convexTotoTimer) clearTimeout(_convexTotoTimer)
  _convexTotoTimer = setTimeout(() => {
    void pushTotoToConvex(get().totoDrivers)
  }, 5000)
}

/**
 * The price list as the server last gave it, and its version. What this
 * device has changed is the difference between this and its own copy, and
 * that difference is all it ever sends. Null until the server has answered,
 * so a device that has not heard from it yet sends nothing at all.
 */
let catalogBase: (CatalogSnap & { version: number }) | null = null

const catalogOf = (s: AppState): CatalogSnap =>
  ({ hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog, sets: s.sets })

/**
 * Only an actual change to the price list goes up. This used to run on every
 * save of anything — a bill, a toto driver — and send the whole list each
 * time, which is how an old copy kept reaching the server.
 */
let _convexCatalogTimer: ReturnType<typeof setTimeout> | null = null
function scheduleConvexCatalogPush(get: () => AppState) {
  if (!catalogBase || isEmptyDiff(catalogDiff(catalogBase, catalogOf(get())))) return
  if (_convexCatalogTimer) clearTimeout(_convexCatalogTimer)
  _convexCatalogTimer = setTimeout(() => { void pushCatalogChange(get) }, 5000)
}

let _catalogPushing = false
async function pushCatalogChange(get: () => AppState) {
  if (_catalogPushing) return
  _catalogPushing = true
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const base = catalogBase
      if (!base) return
      const change = catalogDiff(base, catalogOf(get()))
      if (isEmptyDiff(change)) return
      const next = applyCatalogDiff(base, change)
      const res = await pushCatalogToConvex(next, base.version)
      if (!res.ok) {
        toast(`Price list not saved to the cloud\n${res.error}`, 'error')
        return
      }
      if (!res.conflict) {
        catalogBase = { ...next, version: res.version }
        return
      }
      // Another device saved first. Take its list, put this device's own
      // change back on top, and try again against the new version.
      const fresh = await fetchCatalogFromConvex()
      if (!fresh) {
        toast('Price list not saved to the cloud\nIt changed on another device and could not be re-read.', 'error')
        return
      }
      get().syncCatalogFromRemote(fresh, { quiet: true })
    }
    toast('Price list not saved to the cloud\nIt kept changing on another device. Try again.', 'error')
  } finally {
    _catalogPushing = false
  }
}

interface AppState {
  sets: BrandSet[]
  customers: Customer[]
  quotations: Quotation[]
  quoteSeq: number
  bills: Bill[]
  billSeq: number
  guarantees: GuaranteeDocument[]
  guaranteeSeq: number
  hardwareCatalog: HardwareCatalog
  customCatalog: CustomCatalogEntry[]

  // price sets
  setSets: (sets: BrandSet[]) => void
  /** Append a new set (a copy of `cloneFromId`, or the first set). Returns its id. */
  addSet: (cloneFromId?: string, keepIds?: boolean) => string
  removeSet: (setId: string) => void
  updateBrand: (setId: string, brandId: string, patch: Partial<Brand>) => void
  removeBrand: (setId: string, brandId: string) => void
  addBrand: (setId: string, category: ProductCategory) => void

  // quotations
  nextQuoteNumber: () => string
  saveQuotation: (q: Quotation) => void
  deleteQuotation: (id: string) => void
  /** Brings in quotations made on other devices, and newer copies of ones held here. */
  mergeQuotationsFromCloud: (cloud: Quotation[]) => void

  // customers
  upsertCustomer: (c: Customer) => void
  /** One-time cleanup: rewrite existing customer names in proper case. */
  normalizeCustomerNames: () => void

  // bills
  nextBillNumber: () => string
  saveBill: (b: Bill) => void
  /** Deletes everywhere or nowhere. False means the server never agreed. */
  deleteBill: (id: string) => Promise<boolean>
  /** Bulk-restore all bills from a server snapshot (startup only — DOES push to remotes). */
  saveBillsSnapshot: (bills: Bill[]) => void
  /**
   * Apply a bills update that arrived from a remote (SSE / Convex real-time).
   * Saves to localStorage only — does NOT push back to any remote, preventing sync loops.
   */
  syncBillsFromRemote: (bills: Bill[], remoteBillSeq: number) => void
  /** Drop bills deleted elsewhere. Local only — the server already knows. */
  dropBills: (ids: string[]) => void
  /**
   * Apply a catalog update that arrived from a remote (Convex real-time).
   * Saves to localStorage only.
   */
  syncCatalogFromRemote: (
    snap: { hardwareCatalog: HardwareCatalog; customCatalog: CustomCatalogEntry[]; sets: BrandSet[]; version?: number } | null,
    opts?: { quiet?: boolean },
  ) => void

  // guarantee cards (history)
  /** The next card number; `offset` 1 = the one after it (a slot-2 card in the same print). */
  nextGuaranteeNumber: (offset?: number) => string
  /** Never let the local counter sit below a number already issued elsewhere. */
  raiseGuaranteeSeq: (atLeast: number) => void
  saveGuarantee: (g: GuaranteeDocument) => void
  deleteGuarantee: (id: string) => void
  /**
   * Apply a guarantees update that arrived from a remote (SSE).
   * Saves to localStorage only — does NOT push back to the remote to avoid sync loops.
   */
  syncGuaranteesFromRemote: (guarantees: GuaranteeDocument[], remoteSeq: number) => void
  /**
   * Add the cards the cloud has that this device doesn't (made at another
   * counter, or before a reinstall), and take the cloud's copy of a card when
   * it is newer (edited elsewhere). Never drops a local card, never reverts a
   * newer local edit, and skips cards deleted here. Saves locally only, no
   * push back. Returns cards added + updated.
   */
  mergeGuaranteesFromCloud: (cloud: GuaranteeDocument[]) => number

  // hardware catalog
  setHardwareCatalog: (c: HardwareCatalog) => void

  // custom catalog
  setCustomCatalog: (c: CustomCatalogEntry[]) => void
  units: string[]
  /** Add a unit the shop uses (deduped, case-insensitive). */
  addUnit: (u: string) => void

  totoDrivers: TotoDriver[]
  setTotoAvailability: (id: string, availability: TotoAvailability) => void
  addTotoDriver: (name: string, phone: string, vehicle?: VehicleType) => void
  updateTotoDriver: (id: string, patch: Partial<Omit<TotoDriver, 'id'>>) => void
  removeTotoDriver: (id: string) => void

  addCustomEntry: (name: string) => string   // returns new entry id
  updateCustomEntry: (id: string, patch: Partial<Omit<CustomCatalogEntry, 'id'>>) => void
  removeCustomEntry: (id: string) => void
}

// Cards deleted on this device, so a cloud sync doesn't bring them back. The
// cloud keeps its copy: the card in the customer's hand still has to open.
const DELETED_GUARANTEES_KEY = 'shiv-panel:guarantees-deleted:v1'
const guaranteeKey = (g: GuaranteeDocument) => g.token || g.id

/**
 * The counter a card number stands for: GC-<this year>-NNNN, four digits only.
 * July's test cards in the cloud carry random numbers (GC-2026-95243, 59230…);
 * counting them sent the counter to GC-2026-95244 on 2026-10-04.
 */
export function guaranteeSeqOf(number: string): number | null {
  const m = /^GC-(\d{4})-(\d{4})$/.exec(number)
  return m && Number(m[1]) === indiaYear() ? Number(m[2]) : null
}
/**
 * Cards removed from the cloud on 2026-10-04 — two duplicate saves of
 * Sanjay Kumar's GC-2026-95246 and July's test cards. Each device drops its
 * own copy too (by secret, so no real card can match).
 */
const RETIRED_GUARANTEE_TOKENS = new Set([
  'EWMC5UXDEHLZVERKZQNY', 'JGDDWJ7MTE7C464M5XUE', 'MZG3HC3H274QF4DKDR7F', 'KT6Z8B7XLGQ9QBUK8UPF',
  'YUK9Q7RDSY2X2AKW7H4U', '6R3A9FBG3C9HFK4QYDE7', 'JMJMEHLCJBSNKY9FZD5Q',
])
const notRetired = (g: GuaranteeDocument) => !(g.token && RETIRED_GUARANTEE_TOKENS.has(g.token))

/** A counter past four digits came from such a number, never a real card. */
const sane = (seq: number) => (Number.isFinite(seq) && seq >= 0 && seq <= 9999 ? Math.trunc(seq) : null)
function startingSeq(saved: number | undefined, guarantees: GuaranteeDocument[]): number {
  const ok = sane(saved ?? 0)
  if (ok != null) return ok
  return Math.max(0, ...guarantees.map((g) => guaranteeSeqOf(g.number) ?? 0))
}

// Quotations deleted on this device, so a cloud sync doesn't bring them back.
const DELETED_QUOTATIONS_KEY = 'shiv-panel:quotations-deleted:v1'

function deletedQuotationIds(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_QUOTATIONS_KEY) || '[]')
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function rememberDeletedQuotation(id: string) {
  const ids = deletedQuotationIds()
  ids.add(id)
  try {
    localStorage.setItem(DELETED_QUOTATIONS_KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore quota errors */
  }
}

function deletedGuaranteeKeys(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETED_GUARANTEES_KEY) || '[]')
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function rememberDeletedGuarantee(g: GuaranteeDocument) {
  const keys = deletedGuaranteeKeys()
  keys.add(guaranteeKey(g))
  try {
    localStorage.setItem(DELETED_GUARANTEES_KEY, JSON.stringify([...keys]))
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Everything this device keeps, in one place. The syncs used to write their
 * own shorter list, which left out the units and the toto drivers — so every
 * bill arriving from another counter quietly wiped both from this device.
 */
function snapshotOf(s: AppState): PersistedState {
  return {
    sets: s.sets,
    customers: s.customers,
    quotations: s.quotations,
    quoteSeq: s.quoteSeq,
    bills: s.bills,
    billSeq: s.billSeq,
    guarantees: s.guarantees,
    guaranteeSeq: s.guaranteeSeq,
    hardwareCatalog: s.hardwareCatalog,
    customCatalog: s.customCatalog,
    units: s.units,
    totoDrivers: s.totoDrivers,
  }
}

/**
 * Nothing is written until this device's copy has been read. Before that the
 * store holds defaults — an empty bill list — and writing them would put that
 * over the real copy.
 */
let hydrated = false

/** Keeps the state on this device only, without sending anything anywhere. */
function keepLocal(get: () => AppState) {
  if (!hydrated) return
  void db.save(snapshotOf(get()))
}

function persist(get: () => AppState) {
  keepLocal(get)
  scheduleConvexBillsPush(get)
  scheduleConvexCatalogPush(get)
  scheduleConvexTotoPush(get)
}

/** The state a saved copy stands for, filled out with defaults. */
function fromSaved(saved: Partial<PersistedState> | null) {
  return {
    sets: codeSets((saved?.sets as BrandSet[]) ?? SEED_SETS),
    customers: (saved?.customers as Customer[]) ?? [],
    quotations: (saved?.quotations as Quotation[]) ?? [],
    quoteSeq: (saved?.quoteSeq as number) ?? 0,
    bills: (saved?.bills as Bill[]) ?? [],
    billSeq: (saved?.billSeq as number) ?? 0,
    guarantees: ((saved?.guarantees as GuaranteeDocument[]) ?? []).filter(notRetired),
    guaranteeSeq: startingSeq(saved?.guaranteeSeq as number | undefined, (saved?.guarantees as GuaranteeDocument[]) ?? []),
    hardwareCatalog: (saved?.hardwareCatalog as HardwareCatalog) ?? DEFAULT_HARDWARE_CATALOG,
    customCatalog: (saved?.customCatalog as CustomCatalogEntry[]) ?? [],
    // Seeded from whatever past bills actually used, so nothing already written
    // loses its unit — not from a fixed list of options nobody picked.
    // One spelling per unit, whatever this device saved before the rule:
    // "kg" and "Kg" were two entries, "sit" a Sheet, "Bl" a B/L.
    units: Array.from(new Set(
      ((saved?.units as string[]) ?? ['Pc', ...((saved?.bills as Bill[]) ?? []).flatMap(b => b.items ?? []).map(i => i.unit ?? '')])
        .map(u => canonicalUnit(u))
        .filter(Boolean),
    )),
    totoDrivers: (saved?.totoDrivers as TotoDriver[]) ?? TOTO_SEED,
  }
}

const saved = db.load()

export const useStore = create<AppState>((set, get) => ({
  ...fromSaved(saved),

  setSets: (sets) => {
    set({ sets: codeSets(sets) })
    persist(get)
  },

  addSet: (cloneFromId, keepIds) => {
    const id = uid()
    set((st) => {
      const src = st.sets.find((s) => s.id === cloneFromId) ?? st.sets[0]
      const cloned: BrandSet = {
        id,
        name: `C${st.sets.length + 1}`,
        brands: (src?.brands ?? []).map((b) => ({ ...b, id: keepIds ? b.id : uid() })),
      }
      return { sets: [...st.sets, cloned] }
    })
    persist(get)
    return id
  },

  removeSet: (setId) => {
    set((st) => (st.sets.length <= 1 ? st : { sets: codeSets(st.sets.filter((s) => s.id !== setId)) }))
    persist(get)
  },

  updateBrand: (setId, brandId, patch) => {
    set((st) => ({
      sets: st.sets.map((s) =>
        s.id === setId
          ? { ...s, brands: s.brands.map((b) => (b.id === brandId ? { ...b, ...patch } : b)) }
          : s,
      ),
    }))
    persist(get)
  },

  removeBrand: (setId, brandId) => {
    set((st) => ({
      sets: st.sets.map((s) =>
        s.id === setId ? { ...s, brands: s.brands.filter((b) => b.id !== brandId) } : s,
      ),
    }))
    persist(get)
  },

  addBrand: (setId, category) => {
    set((st) => ({
      sets: st.sets.map((s) =>
        s.id === setId
          ? { ...s, brands: [...s.brands, { id: uid(), category, name: 'New Brand', rate: 0, guaranteeYears: 0 }] }
          : s,
      ),
    }))
    persist(get)
  },

  nextQuoteNumber: () => {
    const seq = get().quoteSeq + 1
    const year = indiaYear()
    return `SH-${year}-${String(seq).padStart(4, '0')}`
  },

  saveQuotation: (given) => {
    const q = { ...given, updatedAt: Date.now() }
    set((st) => {
      const i = st.quotations.findIndex((x) => x.id === q.id)
      const quotations = [...st.quotations]
      let quoteSeq = st.quoteSeq
      if (i >= 0) {
        quotations[i] = q
      } else {
        quotations.unshift(q)
        quoteSeq = st.quoteSeq + 1
      }
      return { quotations, quoteSeq }
    })
    persist(get)
    enqueueQuotationSync(q)
    if (q.customer.name.trim()) enqueueCustomerSync(q.customer)
  },

  deleteQuotation: (id) => {
    rememberDeletedQuotation(id)
    set((st) => ({ quotations: st.quotations.filter((q) => q.id !== id) }))
    persist(get)
  },

  mergeQuotationsFromCloud: (cloud) => {
    const deleted = deletedQuotationIds()
    const quotations = [...get().quotations]
    const held = new Map(quotations.map((q, i) => [q.id, i]))
    let changed = false
    for (const remote of cloud) {
      if (deleted.has(remote.id)) continue
      const i = held.get(remote.id)
      if (i === undefined) {
        quotations.push(remote)
        changed = true
      } else if (quotations[i].updatedAt && (remote.updatedAt ?? 0) > quotations[i].updatedAt) {
        // An edit here still waiting to upload is newer, so it is never reverted.
        quotations[i] = remote
        changed = true
      }
    }
    if (!changed) return
    set({ quotations })
    keepLocal(get)
  },

  upsertCustomer: (c) => {
    set((st) => {
      const i = st.customers.findIndex((x) => x.id === c.id)
      const customers = [...st.customers]
      if (i >= 0) customers[i] = c
      else customers.push(c)
      return { customers }
    })
    persist(get)
    enqueueCustomerSync(c)
  },

  normalizeCustomerNames: () => {
    // Names were typed free-form for years. Bring this device's list to the
    // shop's rule — proper case, codes in capitals — and keep one record per
    // person: "Harsh" saved four times, once as "harsh", is one customer. A
    // different mobile under the same name is a different person.
    const before = get().customers
    const kept: Customer[] = []
    for (const c of before) {
      const name = properText(c.name ?? '')
      const same = kept.findIndex((k) =>
        foldName(k.name) === foldName(name) &&
        (!k.mobile || !c.mobile || k.mobile === c.mobile))
      if (same < 0) {
        kept.push(name === c.name ? c : { ...c, name })
        continue
      }
      // The later record wins; blanks are filled from the earlier one.
      const k = kept[same]
      kept[same] = {
        ...k,
        ...c,
        name,
        mobile: c.mobile || k.mobile,
        altMobile: c.altMobile || k.altMobile,
        uid: c.uid || k.uid,
        address: c.address || k.address,
      }
    }
    const changed = kept.length !== before.length || kept.some((c, i) => c !== before[i])
    if (!changed) return
    set({ customers: kept })
    persist(get)
    for (const c of kept) if (!before.includes(c)) enqueueCustomerSync(c)
  },

  nextBillNumber: () => {
    const seq = get().billSeq + 1
    return String(seq)
  },

  saveBill: (bill) => {
    /**
     * A voucher opened in the bill builder is not one of the shop's bills.
     * Guarded here as well as at each call site, because it had already got in
     * twice by a path nobody had thought about — and once it is in this list
     * it syncs, shows in the day book beside the voucher it is a copy of, and
     * can be "deleted" in a way that reaches the books.
     *
     * The test is the `vch-` id it is filed under, not the voucher it points
     * at: every posted bill carries a voucherId now.
     */
    if (String(bill.id).startsWith('vch-')) return
    const b = { ...bill, updatedAt: Date.now() }
    set((st) => {
      const i = st.bills.findIndex((x) => x.id === b.id)
      const bills = [...st.bills]
      let billSeq = st.billSeq
      if (i >= 0) {
        // A quotation converted to a sale has just taken a bill number.
        if (bills[i].kind === 'quotation' && b.kind !== 'quotation') billSeq = st.billSeq + 1
        bills[i] = b
      } else {
        bills.unshift(b)
        // A quotation numbers in its own series and takes no bill number.
        if (b.kind !== 'quotation') billSeq = st.billSeq + 1
      }
      return { bills, billSeq }
    })
    persist(get)
  },

  deleteBill: async (id) => {
    // The server is told to delete rather than left to infer it from a shorter
    // list: it moves the bill to the trash and takes the ledger voucher with
    // it. Inferring deletion from absence is what let an empty device wipe
    // every bill the shop had.
    //
    // And it is told first. Taking the bill off this screen before the server
    // agrees means a delete that happened nowhere else: the next sync hands
    // the bill straight back, its voucher still in the books, and the operator
    // believes they deleted it.
    const outcome = await removeBillFromConvex(id)
    // A bill the server never had — typed here and never posted — is this
    // device's to delete. One it could not reach is not.
    if (outcome === 'unreachable') return false
    set((st) => ({ bills: st.bills.filter((b) => b.id !== id) }))
    persist(get)
    return true
  },

  saveBillsSnapshot: (bills) => {
    const maxSeq = bills.reduce((m, b) => {
      const n = Number(b.number)
      return Number.isFinite(n) ? Math.max(m, n) : m
    }, 0)
    set((st) => ({ bills, billSeq: Math.max(st.billSeq, maxSeq) }))
    persist(get) // full persist — DOES push to remotes (used on startup)
  },

  syncBillsFromRemote: (remoteBills, remoteBillSeq) => {
    // Merge per bill instead of swapping the whole list: for any bill both
    // devices hold, the copy changed most recently wins, and a bill only one
    // of them has is kept either way. A wholesale replace would throw away
    // whatever this device had typed since the remote snapshot was taken.
    set((st) => {
      const byId = new Map(st.bills.map((b) => [b.id, b]))
      for (const r of remoteBills) {
        const mine = byId.get(r.id)
        if (!mine || (r.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
          byId.set(r.id, mine && (mine.siteSizes?.at ?? 0) > (r.siteSizes?.at ?? 0)
            ? { ...r, siteSizes: mine.siteSizes, measuredAt: r.measuredAt ?? mine.measuredAt }
            : r)
        }
        // The mechanic's sizes go by their own clock (convex/lib/billRows):
        // they arrive even on a bill this device's copy of is the newer one.
        else if ((r.siteSizes?.at ?? 0) > (mine.siteSizes?.at ?? 0)) {
          byId.set(r.id, { ...mine, siteSizes: r.siteSizes, measuredAt: mine.measuredAt ?? r.measuredAt })
        }
      }
      const bills = Array.from(byId.values())
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      return { bills, billSeq: Math.max(st.billSeq, remoteBillSeq) }
    })
    // Save to localStorage only — no remote push to avoid sync loops
    keepLocal(get)
  },

  dropBills: (ids) => {
    // A delete travels as a fact now, not as a shorter list: the server keeps
    // a tombstone and this takes the bill off the device that still had it.
    // Without it, a bill deleted at one counter sat on the other until its
    // browser storage was cleared.
    const gone = new Set(ids)
    let removed = 0
    set((st) => {
      const bills = st.bills.filter((b) => !gone.has(b.id))
      removed = st.bills.length - bills.length
      return removed ? { bills } : {}
    })
    if (!removed) return
    keepLocal(get)
  },

  syncCatalogFromRemote: (snap, opts) => {
    const local = catalogOf(get())
    // What this device changed and has not saved yet rides on top of the
    // server's list rather than being thrown away by it.
    const pending = catalogBase ? catalogDiff(catalogBase, local) : null
    if (!snap) {
      // No list on the server yet: everything here is this device's to send.
      catalogBase = { hardwareCatalog: {} as HardwareCatalog, customCatalog: [], sets: [], version: 0 }
      if (!opts?.quiet) scheduleConvexCatalogPush(get)
      return
    }
    const applied: CatalogSnap = {
      hardwareCatalog: snap.hardwareCatalog,
      customCatalog: snap.customCatalog ?? [],
      sets: snap.sets?.length ? codeSets(snap.sets) : get().sets,
    }
    catalogBase = { ...applied, version: snap.version ?? 0 }
    const next = pending && !isEmptyDiff(pending) ? applyCatalogDiff(applied, pending) : applied
    set({ hardwareCatalog: next.hardwareCatalog, customCatalog: next.customCatalog, sets: codeSets(next.sets) })
    if (pending && !isEmptyDiff(pending) && !opts?.quiet) scheduleConvexCatalogPush(get)
    // Kept on this device only
    keepLocal(get)
  },

  nextGuaranteeNumber: (offset = 0) => {
    const seq = startingSeq(get().guaranteeSeq, get().guarantees) + 1 + Math.max(0, Math.trunc(offset))
    const year = indiaYear()
    return `GC-${year}-${String(seq).padStart(4, '0')}`
  },

  raiseGuaranteeSeq: (atLeast) => {
    if (sane(atLeast) == null) return
    // Only ever raised — except off a bogus counter, which the shop's real highest replaces.
    if (atLeast <= get().guaranteeSeq && sane(get().guaranteeSeq) != null) return
    set({ guaranteeSeq: Math.trunc(atLeast) })
    persist(get)
  },

  saveGuarantee: (g) => {
    set((st) => {
      const i = st.guarantees.findIndex((x) => x.id === g.id)
      const guarantees = [...st.guarantees]
      let guaranteeSeq = st.guaranteeSeq
      if (i >= 0) {
        guarantees[i] = g
      } else {
        guarantees.unshift(g)
        // Bump the sequence when number implies a higher one (always true on first save).
        const n = guaranteeSeqOf(g.number)
        if (n != null) guaranteeSeq = Math.max(sane(guaranteeSeq) ?? 0, n)
      }
      return { guarantees, guaranteeSeq }
    })
    persist(get)
  },

  deleteGuarantee: (id) => {
    const gone = get().guarantees.find((g) => g.id === id)
    if (gone) rememberDeletedGuarantee(gone)
    set((st) => ({ guarantees: st.guarantees.filter((g) => g.id !== id) }))
    persist(get)
  },

  mergeGuaranteesFromCloud: (cloud) => {
    const deleted = deletedGuaranteeKeys()
    const local = get().guarantees
    const byToken = new Map(local.filter((g) => g.token).map((g) => [g.token as string, g]))
    const byId = new Map(local.map((g) => [g.id, g]))
    const merged = [...local]
    let added = 0
    let updated = 0
    let changed = false
    let seq = get().guaranteeSeq

    for (const remote of cloud) {
      if (deleted.has(guaranteeKey(remote)) || !notRetired(remote)) continue
      // The token says which physical card it is: ids are counted per device,
      // so the same id at two counters can be two different cards.
      const sameId = byId.get(remote.id)
      const mine = remote.token
        ? byToken.get(remote.token) ?? (sameId && !sameId.token ? sameId : undefined)
        : sameId
      if (mine) {
        // Edited elsewhere (another counter, or here and since uploaded): take
        // the newer copy, under this device's id. A local edit still waiting
        // to upload is newer than the cloud's copy, so it is never reverted.
        if ((remote.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
          merged[merged.indexOf(mine)] = { ...remote, id: mine.id, token: remote.token ?? mine.token }
          updated += 1
          continue
        }
        // The cloud mints a card's QR secret when the device sent none.
        if (!mine.token && remote.token) {
          merged[merged.indexOf(mine)] = { ...mine, token: remote.token }
          changed = true
        }
        continue
      }
      // Keep ids unique on this device (History opens and prints cards by id).
      merged.push(sameId ? { ...remote, id: `${remote.id}#${String(remote.token).slice(0, 8)}` } : remote)
      added += 1
      const n = guaranteeSeqOf(remote.number)
      if (n != null) seq = Math.max(sane(seq) ?? 0, n)
    }

    if (!added && !updated && !changed) return 0
    merged.sort((a, b) => b.number.localeCompare(a.number) || String(b.date).localeCompare(String(a.date)))
    set({ guarantees: merged, guaranteeSeq: seq })
    persist(get)
    return added + updated
  },

  syncGuaranteesFromRemote: (remoteGuarantees, remoteSeq) => {
    set((st) => ({ guarantees: remoteGuarantees, guaranteeSeq: Math.max(sane(st.guaranteeSeq) ?? 0, sane(remoteSeq) ?? 0) }))
    keepLocal(get)
  },

  setHardwareCatalog: (c) => {
    set({ hardwareCatalog: c })
    persist(get)
  },

  setCustomCatalog: (c) => {
    set({ customCatalog: c })
    persist(get)
  },


  setTotoAvailability: (id, availability) => {
    set((st) => ({ totoDrivers: st.totoDrivers.map(d => d.id === id ? { ...d, availability } : d) }))
    persist(get)
  },
  addTotoDriver: (name, phone, vehicle = 'toto') => {
    const n = name.trim(), p = phone.trim()
    if (!n || !p) return
    set((st) => ({ totoDrivers: [...st.totoDrivers, { id: uid(), name: n, phone: p, availability: 'green', vehicle }] }))
    persist(get)
  },
  updateTotoDriver: (id, patch) => {
    set((st) => ({ totoDrivers: st.totoDrivers.map(d => d.id === id ? { ...d, ...patch } : d) }))
    persist(get)
  },
  removeTotoDriver: (id) => {
    set((st) => ({ totoDrivers: st.totoDrivers.filter(d => d.id !== id) }))
    persist(get)
  },

  addUnit: (u) => {
    const unit = canonicalUnit(u)
    if (!unit) return
    const existing = get().units
    if (existing.some(x => canonicalUnit(x) === unit)) return
    set({ units: [...existing, unit] })
    persist(get)
  },

  addCustomEntry: (name) => {
    const id = uid()
    set((st) => ({ customCatalog: [...st.customCatalog, { id, name, sizes: [], brands: [] }] }))
    persist(get)
    return id
  },

  updateCustomEntry: (id, patch) => {
    set((st) => ({
      customCatalog: st.customCatalog.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
    persist(get)
  },

  removeCustomEntry: (id) => {
    set((st) => ({ customCatalog: st.customCatalog.filter((e) => e.id !== id) }))
    persist(get)
  },
}))

/**
 * Loads this device's copy from IndexedDB before the app draws. Until a device
 * has moved, its data is still in localStorage (already read above) and is
 * written across here; after that IndexedDB is the copy.
 */
let hydrating: Promise<void> | null = null
export function hydrateStore(): Promise<void> {
  hydrating ??= (async () => {
    const durable = await db.loadDurable()
    if (durable) useStore.setState(fromSaved(durable))
    hydrated = true
    if (!durable && saved) await db.save(snapshotOf(useStore.getState()))
  })()
  return hydrating
}

/** Whether everything handed to this device's storage has been kept. */
export const flushLocal = () => db.flush()
