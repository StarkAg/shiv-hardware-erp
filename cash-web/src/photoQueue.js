import { convex, withTimeout } from './sync.js'
import { anyApi } from 'convex/server'

/** WebP at 0.8, the same picture at under half a JPEG's weight; JPEG where the browser cannot write WebP. */
const smallBlob = async (canvas, jpegQuality) => {
  const webp = await new Promise((done) => canvas.toBlob(done, 'image/webp', 0.8))
  if (webp?.type === 'image/webp') return webp
  return new Promise((done) => canvas.toBlob(done, 'image/jpeg', jpegQuality))
}

const DB_NAME = 'shiv-cash-bill-photos'
const STORE = 'pages'

function db() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Photo storage is unavailable on this phone.'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function store(mode, run) {
  const connection = await db()
  return new Promise((resolve, reject) => {
    const tx = connection.transaction(STORE, mode)
    const result = run(tx.objectStore(STORE))
    tx.oncomplete = () => { connection.close(); resolve(result?.result) }
    tx.onerror = () => { connection.close(); reject(tx.error) }
    tx.onabort = () => { connection.close(); reject(tx.error) }
  })
}

const getAll = () => store('readonly', table => table.getAll())
const get = id => store('readonly', table => table.get(id))
const put = value => store('readwrite', table => table.put(value))
const remove = id => store('readwrite', table => table.delete(id))

async function smallJpeg(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a bill photo.')
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * ratio)
  canvas.height = Math.round(bitmap.height * ratio)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await smallBlob(canvas, 0.84)
  if (!blob) throw new Error('Could not prepare the photo.')
  return blob
}

export async function enqueuePhotos(entryId, files, batchId) {
  // Each page is durable in IndexedDB before the cashier is told it is queued.
  for (const [index, file] of files.entries()) {
    const id = `${entryId}:${batchId}:${index}`
    if (await get(id)) continue
    const blob = await smallJpeg(file)
    await put({ id, entryId, blob, batchId, pageCount: files.length, at: Date.now(), name: file.name })
  }
}

export async function pendingPhotos() { return (await getAll()).length }

let flushing = false
export async function flushPhotos() {
  if (flushing || navigator.onLine === false) return pendingPhotos()
  flushing = true
  try {
    const client = convex()
    const pages = (await getAll()).sort((a, b) => a.at - b.at)
    for (const page of pages) {
      try {
        let storageId = page.storageId
        if (!storageId) {
          const url = await withTimeout(client.mutation(anyApi.files.generateUploadUrl, {}))
          const response = await withTimeout(fetch(url, { method: 'POST', headers: { 'Content-Type': page.blob.type || 'image/jpeg' }, body: page.blob }), 60000)
          if (!response.ok) throw new Error(`Upload failed (${response.status})`)
          storageId = (await response.json()).storageId
          await put({ ...page, storageId })
        }
        const result = await withTimeout(client.mutation(anyApi.billFlow.attachCashPhoto, {
          entryId: page.entryId, storageId, batchId: page.batchId, pageCount: page.pageCount,
        }))
        await remove(page.id)
        if (result.ready) void client.action(anyApi.ai.readFlow, { id: result.id }).catch(() => {})
      } catch {
        // Keep the page and its uploaded id. The next sync retries safely.
      }
    }
    return pendingPhotos()
  } finally {
    flushing = false
  }
}
