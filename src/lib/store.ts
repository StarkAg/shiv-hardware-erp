import { create } from 'zustand'
import type { Bill, Brand, BrandSet, CustomCatalogEntry, Customer, HardwareCatalog, ProductCategory, Quotation } from './types'
import { DEFAULT_HARDWARE_CATALOG } from './types'
import { SEED_SETS } from './data/brands'
import { db } from './db/adapter'
import { enqueueCustomerSync, enqueueQuotationSync } from './offlineSync'
import { pushBillsToServer, pushCatalogToServer } from './printServer'
import { pushBillsToConvex, pushCatalogToConvex } from './convexSync'

const uid = () => Math.random().toString(36).slice(2, 10)
const codeSets = (sets: BrandSet[]): BrandSet[] => sets.map((s, i) => ({ ...s, name: `C${i + 1}` }))

// Debounce catalog pushes so rapid changes (typing a rate) don't spam the server
let _catalogPushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleCatalogPush(get: () => AppState) {
  if (_catalogPushTimer) clearTimeout(_catalogPushTimer)
  _catalogPushTimer = setTimeout(() => {
    const s = get()
    pushCatalogToServer({ hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog, sets: s.sets })
  }, 2000)
}

// Debounce bills pushes so rapid edits (typing customer name) don't spam the server
let _billsPushTimer: ReturnType<typeof setTimeout> | null = null
function scheduleBillsPush(get: () => AppState) {
  if (_billsPushTimer) clearTimeout(_billsPushTimer)
  _billsPushTimer = setTimeout(() => {
    pushBillsToServer(get().bills)
  }, 2000)
}

// Convex push — slightly longer debounce (5s) to batch more changes
let _convexBillsTimer: ReturnType<typeof setTimeout> | null = null
function scheduleConvexBillsPush(get: () => AppState) {
  if (_convexBillsTimer) clearTimeout(_convexBillsTimer)
  _convexBillsTimer = setTimeout(() => {
    const s = get()
    void pushBillsToConvex(s.bills, s.billSeq)
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

  // bills
  nextBillNumber: () => string
  saveBill: (b: Bill) => void
  deleteBill: (id: string) => void
  /** Bulk-restore all bills from a server snapshot (startup only — DOES push to remotes). */
  saveBillsSnapshot: (bills: Bill[]) => void
  /**
   * Apply a bills update that arrived from a remote (SSE / Convex real-time).
   * Saves to localStorage only — does NOT push back to any remote, preventing sync loops.
   */
  syncBillsFromRemote: (bills: Bill[], remoteBillSeq: number) => void
  /**
   * Apply a catalog update that arrived from a remote (Convex real-time).
   * Saves to localStorage only.
   */
  syncCatalogFromRemote: (snap: { hardwareCatalog: HardwareCatalog; customCatalog: CustomCatalogEntry[]; sets: BrandSet[] }) => void

  // hardware catalog
  setHardwareCatalog: (c: HardwareCatalog) => void

  // custom catalog
  setCustomCatalog: (c: CustomCatalogEntry[]) => void
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
    hardwareCatalog: s.hardwareCatalog,
    customCatalog: s.customCatalog,
  })
  scheduleCatalogPush(get)
  scheduleBillsPush(get)
  scheduleConvexBillsPush(get)
  scheduleConvexCatalogPush(get)
}

const saved = db.load()

export const useStore = create<AppState>((set, get) => ({
  sets: codeSets((saved?.sets as BrandSet[]) ?? SEED_SETS),
  customers: (saved?.customers as Customer[]) ?? [],
  quotations: (saved?.quotations as Quotation[]) ?? [],
  quoteSeq: (saved?.quoteSeq as number) ?? 0,
  bills: (saved?.bills as Bill[]) ?? [],
  billSeq: (saved?.billSeq as number) ?? 0,
  hardwareCatalog: (saved?.hardwareCatalog as HardwareCatalog) ?? DEFAULT_HARDWARE_CATALOG,
  customCatalog: (saved?.customCatalog as CustomCatalogEntry[]) ?? [],

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

  nextBillNumber: () => {
    const seq = get().billSeq + 1
    return String(seq)
  },

  saveBill: (b) => {
    set((st) => {
      const i = st.bills.findIndex((x) => x.id === b.id)
      const bills = [...st.bills]
      let billSeq = st.billSeq
      if (i >= 0) {
        bills[i] = b
      } else {
        bills.unshift(b)
        billSeq = st.billSeq + 1
      }
      return { bills, billSeq }
    })
    persist(get)
  },

  deleteBill: (id) => {
    set((st) => ({ bills: st.bills.filter((b) => b.id !== id) }))
    persist(get)
  },

  saveBillsSnapshot: (bills) => {
    const maxSeq = bills.reduce((m, b) => {
      const n = Number(b.number)
      return Number.isFinite(n) ? Math.max(m, n) : m
    }, 0)
    set((st) => ({ bills, billSeq: Math.max(st.billSeq, maxSeq) }))
    persist(get) // full persist — DOES push to remotes (used on startup)
  },

  syncBillsFromRemote: (bills, remoteBillSeq) => {
    set((st) => ({ bills, billSeq: Math.max(st.billSeq, remoteBillSeq) }))
    // Save to localStorage only — no remote push to avoid sync loops
    const s = get()
    db.save({ sets: s.sets, customers: s.customers, quotations: s.quotations, quoteSeq: s.quoteSeq, bills, billSeq: s.billSeq, hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog })
  },

  syncCatalogFromRemote: (snap) => {
    const newSets = snap.sets?.length ? codeSets(snap.sets) : get().sets
    set({ hardwareCatalog: snap.hardwareCatalog, customCatalog: snap.customCatalog ?? [], sets: newSets })
    // Save to localStorage only
    const s = get()
    db.save({ sets: s.sets, customers: s.customers, quotations: s.quotations, quoteSeq: s.quoteSeq, bills: s.bills, billSeq: s.billSeq, hardwareCatalog: s.hardwareCatalog, customCatalog: s.customCatalog })
  },

  setHardwareCatalog: (c) => {
    set({ hardwareCatalog: c })
    persist(get)
  },

  setCustomCatalog: (c) => {
    set({ customCatalog: c })
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
