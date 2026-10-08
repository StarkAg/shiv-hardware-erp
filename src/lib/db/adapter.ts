// Where this device keeps its own copy of the panel's data.
//
// It was localStorage, and every write that did not fit was dropped without a
// word: a bill the books refused was "kept on this PC" in the message and in
// nothing else, and a reload lost it. localStorage holds about 5 MB for the
// whole site; the bills alone grow past that. So the copy lives in IndexedDB
// now — hundreds of megabytes — and a write that fails says so.
//
// localStorage is still read once, synchronously, so the first paint has
// something to show on a device that has not moved yet; the first good write
// to IndexedDB then frees it.

export interface PersistedState {
  sets: unknown
  customers: unknown
  quotations: unknown
  quoteSeq: number
  bills: unknown
  billSeq: number
  guarantees?: unknown
  guaranteeSeq?: number
  hardwareCatalog: unknown
  customCatalog: unknown
  /** Units the shop actually uses — grows as they are added. */
  units?: unknown
  /** Toto driver contacts and their availability tags. */
  totoDrivers?: unknown
}

export interface DataAdapter {
  /** What localStorage still holds, read synchronously for the first paint. */
  load(): Partial<PersistedState> | null
  /** The durable copy, from IndexedDB; null when there is none yet. */
  loadDurable(): Promise<Partial<PersistedState> | null>
  /** Writes the state. Resolves false, never throws, when it could not be kept. */
  save(state: PersistedState): Promise<boolean>
  /** Resolves when everything handed to save() is written, with whether the last write held. */
  flush(): Promise<boolean>
}

// v7: latest Plywood/Door seed rates with Excel row colors and quotation-only warranty labels.
// Old v6/v5 customers/quotes migrate, but price sets refresh from the latest seed data.
const KEY = 'shiv-panel:v7'
const LEGACY_KEY = 'shiv-panel:v6'

const OLDER_LEGACY_KEYS = ['shiv-panel:v5', 'shiv-panel:v4']

function readLocal(): Partial<PersistedState> | null {
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
}

/** The old adapter, for a browser with no IndexedDB. Now says when it fails. */
export const localAdapter: DataAdapter = {
  load: readLocal,
  loadDurable: async () => null,
  async save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
      return true
    } catch {
      return false
    }
  },
  flush: async () => true,
}

// ── IndexedDB ───────────────────────────────────────────────────────────────
const DB_NAME = 'shiv-panel'
const STORE = 'state'
const RECORD = 'v7'

let opening: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab.'))
  })
  // A failed open is not cached: the next save tries again.
  opening.catch(() => { opening = null })
  return opening
}

async function idbGet(): Promise<Partial<PersistedState> | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD)
    req.onsuccess = () => resolve((req.result as Partial<PersistedState> | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(state: PersistedState): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(state, RECORD)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('The write was aborted.'))
  })
}

/**
 * Writes are folded together: a burst of changes writes the latest state once,
 * one write at a time, so an older state can never land after a newer one.
 */
let pending: PersistedState | null = null
let writing: Promise<boolean> | null = null
let lastOk = true
let localFreed = false

async function writeLoop(): Promise<boolean> {
  while (pending) {
    const state = pending
    pending = null
    try {
      await idbPut(state)
      lastOk = true
      if (!localFreed) {
        // Moved: the old copy only takes room the drafts and settings need.
        try { localStorage.removeItem(KEY) } catch { /* nothing to free */ }
        localFreed = true
      }
    } catch (err) {
      console.error('[storage] could not keep the panel on this device', err)
      lastOk = false
    }
  }
  return lastOk
}

/** Starts the writer if it is idle; a state handed over as it finishes is not left behind. */
function kick(): Promise<boolean> {
  if (!writing) {
    writing = writeLoop().then((ok) => {
      writing = null
      return pending ? kick() : ok
    })
  }
  return writing
}

export const indexedDbAdapter: DataAdapter = {
  load: readLocal,
  async loadDurable() {
    try { return await idbGet() } catch { return null }
  },
  save(state) {
    pending = state
    return kick()
  },
  flush() {
    return writing ?? Promise.resolve(lastOk)
  },
}

// The active adapter: IndexedDB wherever the browser has it.
export const db: DataAdapter = typeof indexedDB !== 'undefined' ? indexedDbAdapter : localAdapter
