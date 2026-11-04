/**
 * Bills on their way to the group, kept on this phone until they have gone
 * (owner's ask, 4 Nov 2026: a failed send must be safe). A bill is written here
 * before it is sent, so no signal, a closed app or a flat battery loses nothing.
 * Kept as bytes rather than a Blob, which Safari has lost from IndexedDB before.
 */
const DB = 'billshoot-outbox'
const STORE = 'bills'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
}

function inStore(mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = work(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  }))
}

/** Writes the bill; only once this has finished is it safe to let the pages go. */
export async function saveBill(blob, name) {
  const bytes = await blob.arrayBuffer()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await inStore('readwrite', (store) => store.put({ id, name, type: blob.type || 'image/jpeg', bytes, at: Date.now() }))
  return id
}

/** Every bill still to go, oldest first. */
export async function savedBills() {
  const rows = await inStore('readonly', (store) => store.getAll())
  return rows
    .sort((a, b) => a.at - b.at)
    .map(({ id, name, type, bytes, at }) => ({ id, name, at, blob: new Blob([bytes], { type }) }))
}

export const removeBill = (id) => inStore('readwrite', (store) => store.delete(id))
