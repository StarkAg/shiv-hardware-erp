import { FALLBACK_ITEMS, canonicalStockRef, hydrateStockItems } from './seed'

const DATABASE = 'shiv-inventory-device'
const STORE = 'stock'
const KEY = 'current'
const FALLBACK_KEY = 'shiv-inventory-device-backup:v1'
let databasePromise
let writing = Promise.resolve()
const copy = value => JSON.parse(JSON.stringify(value))
const initial = () => ({ version: 1, items: copy(FALLBACK_ITEMS), queue: [] })
const valid = state => state && Array.isArray(state.items) && Array.isArray(state.queue)

function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return databasePromise
}
async function readFromDatabase() {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    request.onsuccess = () => resolve(valid(request.result) ? request.result : null)
    request.onerror = () => reject(request.error)
  })
}
async function writeToDatabase(state) {
  const db = await openDatabase()
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(state, KEY)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
function readBackup() {
  try { const state = JSON.parse(localStorage.getItem(FALLBACK_KEY) || 'null'); return valid(state) ? state : null } catch { return null }
}
function writeBackup(state) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}
async function read() {
  try { return normalise(await readFromDatabase() ?? readBackup() ?? initial()) } catch { return normalise(readBackup() ?? initial()) }
}
async function save(state) {
  state = normalise(state)
  const backupSaved = writeBackup(state)
  let databaseSaved = false
  try {
    await writeToDatabase(state)
    databaseSaved = true
  } catch { /* localStorage remains a second device copy. */ }
  if (!databaseSaved && !backupSaved) throw new Error('This device could not save the change.')
  return state
}
function normalise(state) {
  return {
    ...state,
    items: hydrateStockItems(state.items),
    queue: state.queue.map(operation => ({ ...operation, ref: canonicalStockRef(operation.ref) })),
  }
}
function serial(change) {
  const job = writing.then(async () => save(await change(await read())))
  writing = job.catch(() => undefined)
  return job
}
export function loadDeviceInventory() { return writing.then(read) }
export function saveRemoteInventory(items) { return serial(async state => ({ ...state, items: copy(items) })) }
/**
 * Convex is the shelf total: bills add and remove stock there as soon as they
 * are saved. A new count or bill movement refreshes that shelf on every open
 * Inventory phone. An unchanged server response never overwrites a newer
 * local count; unsynced device taps stay in `queue` and are layered over these
 * totals by `queuedStock`.
 */
function remoteVersion(item) {
  return `${item?.counted?.at ?? ''}|${item?.lastMove ?? ''}|${item?.moves ?? ''}`
}
export function hydrateFromConvexOnce(items, at = Date.now()) {
  return serial(async state => state.convexHydratedAt
    ? {
        ...state,
        items: copy(items).map((remote) => {
          const saved = state.items.find((item) => item.ref === remote.ref)
          return saved && remoteVersion(saved) === remoteVersion(remote) ? saved : remote
        }),
      }
    : { ...state, items: copy(items), convexHydratedAt: at, lastConvexSyncAt: at })
}
export function rememberAddedItem(item) {
  return serial(async state => state.items.some(saved => saved.ref === item.ref)
    ? state : { ...state, items: [...state.items, copy(item)] })
}
/** Keep a server-saved shelf name visible on this device without replacing its counts or queued taps. */
export function renameStoredItem(ref, name) {
  return serial(async state => ({
    ...state,
    items: state.items.map(item => item.ref === ref ? { ...item, name } : item),
  }))
}
/** A successful upload is kept on the device for the Sync panel. */
export function recordConvexSync(at = Date.now()) {
  return serial(async state => ({ ...state, lastConvexSyncAt: at }))
}
export function queueAdjustment(ref, delta) {
  return serial(async state => ({ ...state, queue: [...state.queue, {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ref, delta, createdAt: Date.now(),
  }] }))
}
export function acknowledgeAdjustment(id, ref, qty) {
  return serial(async state => ({ ...state, queue: state.queue.filter(operation => operation.id !== id), items: state.items.map(item => item.ref === ref ? { ...item, stock: qty } : item) }))
}
export function nextAdjustment() { return writing.then(read).then(state => state.queue[0] ?? null) }
export function queuedStock(items, queue) {
  const delta = new Map()
  for (const operation of queue) delta.set(operation.ref, (delta.get(operation.ref) ?? 0) + operation.delta)
  return items.map(item => ({ ...item, stock: item.stock + (delta.get(item.ref) ?? 0) }))
}
