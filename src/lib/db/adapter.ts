// Swappable persistence adapter. Today: localStorage. Later: Convex or SQLite
// can implement this same interface without touching the UI/store.

export interface PersistedState {
  sets: unknown
  customers: unknown
  quotations: unknown
  quoteSeq: number
  bills: unknown
  billSeq: number
  hardwareCatalog: unknown
  customCatalog: unknown
}

export interface DataAdapter {
  load(): Partial<PersistedState> | null
  save(state: PersistedState): void
}

// v7: latest Plywood/Door seed rates with Excel row colors and quotation-only warranty labels.
// Old v6/v5 customers/quotes migrate, but price sets refresh from the latest seed data.
const KEY = 'shiv-panel:v7'
const LEGACY_KEY = 'shiv-panel:v6'

const OLDER_LEGACY_KEYS = ['shiv-panel:v5', 'shiv-panel:v4']

export const localAdapter: DataAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw) as Partial<PersistedState>

      const legacy = localStorage.getItem(LEGACY_KEY) ?? OLDER_LEGACY_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
      if (!legacy) return null

      const parsed = JSON.parse(legacy) as Partial<PersistedState>
      return {
        customers: parsed.customers,
        quotations: parsed.quotations,
        quoteSeq: parsed.quoteSeq ?? 0,
      }
    } catch {
      return null
    }
  },
  save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* ignore quota errors */
    }
  },
}

// The active adapter — swap this line to migrate backends.
export const db: DataAdapter = localAdapter
