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

// v3: brands grouped into named price sets (Set A, Set B, …).
const KEY = 'shiv-panel:v3'

export const localAdapter: DataAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Partial<PersistedState>) : null
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
