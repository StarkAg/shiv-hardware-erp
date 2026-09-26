import { canonicalUnit, foldName, properText } from '../../convex/lib/text'
import { create } from 'zustand'
import type { Bill, Brand, BrandSet, CustomCatalogEntry, Customer, GuaranteeDocument, HardwareCatalog, ProductCategory, Quotation, TotoAvailability, TotoDriver, VehicleType } from './types'
import { DEFAULT_HARDWARE_CATALOG, TOTO_SEED } from './types'
import { SEED_SETS } from './data/brands'
import { db } from './db/adapter'
import { enqueueCustomerSync, enqueueQuotationSync } from './offlineSync'
import { pushBillsToConvex, pushCatalogToConvex, pushTotoToConvex, removeBillFromConvex } from './convexSync'

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
    void pushBillsToConvex(s.bills.filter((b) => !b.postError), s.billSeq)
  }, 5000)   // a watching screen is at most this far behind
}

let _convexTotoTimer: ReturnType<typeof setTimeout> | null = null
function scheduleConvexTotoPush(get: () => AppState) {
  if (_convexTotoTimer) clearTimeout(_convexTotoTimer)
  _convexTotoTimer = setTimeout(() => {
    void pushTotoToConvex(get().totoDrivers)
  }, 5000)
}

let _convexCatalogTimer: ReturnType<typeof setTimeout> | null = null
function scheduleConvexCatalogPush(get: () => AppState) {
  if (_convexCatalogTimer) clearTimeout(_convexCatalogTimer)
  _convexCatalogTimer = setTimeout(() => {
    const s = get()
    void pushCatalogToConvex({ hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog, sets: s.sets })
  }, 5000)
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
  addSet: (cloneFromId?: string) => string
  removeSet: (setId: string) => void
  updateBrand: (setId: string, brandId: string, patch: Partial<Brand>) => void
  removeBrand: (setId: string, brandId: string) => void
  addBrand: (setId: string, category: ProductCategory) => void

  // quotations
  nextQuoteNumber: () => string
  saveQuotation: (q: Quotation) => void
  deleteQuotation: (id: string) => void

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
  syncCatalogFromRemote: (snap: { hardwareCatalog: HardwareCatalog; customCatalog: CustomCatalogEntry[]; sets: BrandSet[] }) => void

  // guarantee cards (history)
  nextGuaranteeNumber: () => string
  saveGuarantee: (g: GuaranteeDocument) => void
  deleteGuarantee: (id: string) => void
  /**
   * Apply a guarantees update that arrived from a remote (SSE).
   * Saves to localStorage only — does NOT push back to the remote to avoid sync loops.
   */
  syncGuaranteesFromRemote: (guarantees: GuaranteeDocument[], remoteSeq: number) => void

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

function persist(get: () => AppState) {
  const s = get()
  db.save({
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
  })
  scheduleConvexBillsPush(get)
  scheduleConvexCatalogPush(get)
  scheduleConvexTotoPush(get)
}

const saved = db.load()

export const useStore = create<AppState>((set, get) => ({
  sets: codeSets((saved?.sets as BrandSet[]) ?? SEED_SETS),
  customers: (saved?.customers as Customer[]) ?? [],
  quotations: (saved?.quotations as Quotation[]) ?? [],
  quoteSeq: (saved?.quoteSeq as number) ?? 0,
  bills: (saved?.bills as Bill[]) ?? [],
  billSeq: (saved?.billSeq as number) ?? 0,
  guarantees: (saved?.guarantees as GuaranteeDocument[]) ?? [],
  guaranteeSeq: (saved?.guaranteeSeq as number) ?? 0,
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

  setSets: (sets) => {
    set({ sets: codeSets(sets) })
    persist(get)
  },

  addSet: (cloneFromId) => {
    const id = uid()
    set((st) => {
      const src = st.sets.find((s) => s.id === cloneFromId) ?? st.sets[0]
      const cloned: BrandSet = {
        id,
        name: `C${st.sets.length + 1}`,
        brands: (src?.brands ?? []).map((b) => ({ ...b, id: uid() })),
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
    const year = new Date().getFullYear()
    return `SH-${year}-${String(seq).padStart(4, '0')}`
  },

  saveQuotation: (q) => {
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
    set((st) => ({ quotations: st.quotations.filter((q) => q.id !== id) }))
    persist(get)
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
        if (!mine || (r.updatedAt ?? 0) > (mine.updatedAt ?? 0)) byId.set(r.id, r)
      }
      const bills = Array.from(byId.values())
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      return { bills, billSeq: Math.max(st.billSeq, remoteBillSeq) }
    })
    // Save to localStorage only — no remote push to avoid sync loops
    const s = get()
    db.save({ sets: s.sets, customers: s.customers, quotations: s.quotations, quoteSeq: s.quoteSeq, bills: s.bills, billSeq: s.billSeq, guarantees: s.guarantees, guaranteeSeq: s.guaranteeSeq, hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog })
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
    const s = get()
    db.save({ sets: s.sets, customers: s.customers, quotations: s.quotations, quoteSeq: s.quoteSeq, bills: s.bills, billSeq: s.billSeq, guarantees: s.guarantees, guaranteeSeq: s.guaranteeSeq, hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog })
  },

  syncCatalogFromRemote: (snap) => {
    const newSets = snap.sets?.length ? codeSets(snap.sets) : get().sets
    set({ hardwareCatalog: snap.hardwareCatalog, customCatalog: snap.customCatalog ?? [], sets: newSets })
    // Save to localStorage only
    const s = get()
    db.save({ sets: s.sets, customers: s.customers, quotations: s.quotations, quoteSeq: s.quoteSeq, bills: s.bills, billSeq: s.billSeq, guarantees: s.guarantees, guaranteeSeq: s.guaranteeSeq, hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog })
  },

  nextGuaranteeNumber: () => {
    const seq = get().guaranteeSeq + 1
    const year = new Date().getFullYear()
    return `GC-${year}-${String(seq).padStart(4, '0')}`
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
        const match = /^GC-\d{4}-(\d{4,})$/.exec(g.number)
        if (match) {
          const n = Number(match[1])
          if (Number.isFinite(n)) guaranteeSeq = Math.max(guaranteeSeq, n)
        }
      }
      return { guarantees, guaranteeSeq }
    })
    persist(get)
  },

  deleteGuarantee: (id) => {
    set((st) => ({ guarantees: st.guarantees.filter((g) => g.id !== id) }))
    persist(get)
  },

  syncGuaranteesFromRemote: (remoteGuarantees, remoteSeq) => {
    set((st) => ({ guarantees: remoteGuarantees, guaranteeSeq: Math.max(st.guaranteeSeq, remoteSeq) }))
    const s = get()
    db.save({ sets: s.sets, customers: s.customers, quotations: s.quotations, quoteSeq: s.quoteSeq, bills: s.bills, billSeq: s.billSeq, guarantees: remoteGuarantees, guaranteeSeq: s.guaranteeSeq, hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog })
  },

  setHardwareCatalog: (c) => {
    set({ hardwareCatalog: c })
    persist(get)
  },

  setCustomCatalog: (c) => {
    set({ customCatalog: c })
    persist(get)
  },

  totoDrivers: (saved?.totoDrivers as TotoDriver[]) ?? TOTO_SEED,

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
