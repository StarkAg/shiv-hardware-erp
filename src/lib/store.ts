import { create } from 'zustand'
import type { Brand, BrandSet, Customer, ProductCategory, Quotation } from './types'
import { SEED_SETS } from './data/brands'
import { db } from './db/adapter'

const uid = () => Math.random().toString(36).slice(2, 10)

interface AppState {
  sets: BrandSet[]
  customers: Customer[]
  quotations: Quotation[]
  quoteSeq: number

  // price sets
  setSets: (sets: BrandSet[]) => void
  /** Append a new set (a copy of `cloneFromId`, or the first set). Returns its id. */
  addSet: (cloneFromId?: string) => string
  renameSet: (setId: string, name: string) => void
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
}

function persist(get: () => AppState) {
  const s = get()
  db.save({
    sets: s.sets,
    customers: s.customers,
    quotations: s.quotations,
    quoteSeq: s.quoteSeq,
  })
}

const saved = db.load()

export const useStore = create<AppState>((set, get) => ({
  sets: (saved?.sets as BrandSet[]) ?? SEED_SETS,
  customers: (saved?.customers as Customer[]) ?? [],
  quotations: (saved?.quotations as Quotation[]) ?? [],
  quoteSeq: (saved?.quoteSeq as number) ?? 0,

  setSets: (sets) => {
    set({ sets })
    persist(get)
  },

  addSet: (cloneFromId) => {
    const id = uid()
    set((st) => {
      const src = st.sets.find((s) => s.id === cloneFromId) ?? st.sets[0]
      const name = `Set ${String.fromCharCode(65 + st.sets.length)}`
      const cloned: BrandSet = {
        id,
        name,
        brands: (src?.brands ?? []).map((b) => ({ ...b, id: uid() })),
      }
      return { sets: [...st.sets, cloned] }
    })
    persist(get)
    return id
  },

  renameSet: (setId, name) => {
    set((st) => ({ sets: st.sets.map((s) => (s.id === setId ? { ...s, name } : s)) }))
    persist(get)
  },

  removeSet: (setId) => {
    set((st) => (st.sets.length <= 1 ? st : { sets: st.sets.filter((s) => s.id !== setId) }))
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
  },
}))
