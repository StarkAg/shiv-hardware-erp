// Swappable persistence adapter. Today: localStorage. Later: Convex or SQLite
// can implement this same interface without touching the UI/store.

export interface PersistedState {
  sets: unknown
  customers: unknown
  quotations: unknown
  quoteSeq: number
}

export interface DataAdapter {
  load(): Partial<PersistedState> | null
  save(state: PersistedState): void
}

// v5: latest Downloads/Formats seed rates. Old v4 customers/quotes migrate,
// but price sets refresh from the latest seed data.
const KEY = 'shiv-panel:v5'
const LEGACY_KEY = 'shiv-panel:v4'

export const localAdapter: DataAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw) as Partial<PersistedState>

      const legacy = localStorage.getItem(LEGACY_KEY)
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
