/**
 * What the background worker (public/sw.js) needs to send a shared file by
 * itself, without opening the app: this phone's shop key, the database's
 * address, and whether shared files should print straight away.
 *
 * The worker cannot read the app's localStorage, so the app copies them here,
 * into IndexedDB, each time it is opened. Same names as in sw.js.
 */
const DB = 'shiv-print'
const STORE = 'kv'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putForWorker(values) {
  try {
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      for (const [key, value] of Object.entries(values)) {
        if (value === null || value === undefined) tx.objectStore(STORE).delete(key)
        else tx.objectStore(STORE).put(value, key)
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Without it, shared files simply open the app as before.
  }
}
