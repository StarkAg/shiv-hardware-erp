/**
 * Everything kept on the phone, so an account and its bills open at once and
 * without the internet.
 *
 * Two stores, both the browser's own:
 *
 *   - every account's page, in IndexedDB (localStorage holds about 5 MB, and
 *     a few hundred accounts are more than that);
 *   - every bill photo, in Cache Storage: the thumbnail and the screen-sized
 *     copy from the site's image service, a few KB and about 70 KB each. The
 *     service worker (public/sw.js) answers for a photo from there before it
 *     asks the network. The photo itself (300-800 KB) is kept only once a bill
 *     has been opened.
 *
 * `saveEverything` fills both in the background each time the app opens, and
 * after that fetches only what has changed.
 */

export const PHOTOS = 'khata-photos-v1'

/** A photo brought down to the width it is shown at (see vercel.json "images"). */
export const sized = (url, width) => `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=70`
export const THUMB = 192
export const SCREEN = 1200

// ── The accounts ─────────────────────────────────────────────────────────────
let opening = null
function db() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('khata', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('ledgers')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return opening
}
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })

/** An account as last saved: { data, sig } or undefined. Never throws: a phone that keeps nothing just opens cold. */
export async function savedLedger(id) {
  try { return await done((await db()).transaction('ledgers').objectStore('ledgers').get(id)) } catch { return undefined }
}

/**
 * Saves an account's page. `sig` is the list's line for it at the time (see
 * `signature`): left out, the one already saved stays, so a page saved while
 * it is being read does not look stale to the next `saveEverything`.
 */
export async function saveLedger(id, data, sig) {
  try {
    const store = (await db()).transaction('ledgers', 'readwrite').objectStore('ledgers')
    const was = sig === undefined ? await done(store.get(id)) : undefined
    await done(store.put({ data, sig: sig ?? was?.sig }, id))
  } catch { /* storage full or refused */ }
}

/** What the list says of an account; when it changes, so has the account's page. */
export const signature = (row) => [row.closingSide, row.closing, row.voucherCount, row.lastDate, row.pendingCount].join(':')

// ── The photos ───────────────────────────────────────────────────────────────
const isPdf = (a) => /pdf/i.test(a?.contentType ?? '')
/** Every photo on an account's page, newest bill first. */
function photosOf(data) {
  const lines = [...(data?.rows ?? []), ...(data?.pending ?? [])].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
  return lines.flatMap((line) => (line.attachmentUrls ?? []).filter((a) => a.url && !isPdf(a)).map((a) => a.url))
}

/** Keeps one copy of a photo, unless it is already kept. False when it could not be had. */
async function keep(cache, url) {
  if (await cache.match(url, { ignoreVary: true })) return true
  const res = await fetch(url, { headers: { Accept: 'image/webp,image/*;q=0.9,*/*;q=0.5' } })
  // Only a picture is kept: an error page saved as a photo would be shown as one for good.
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) return false
  await cache.put(url, res)
  return true
}

/** Runs `work` over `items`, a few at a time. Stops early when `work` returns false. */
async function each(items, width, work) {
  let next = 0
  let stopped = false
  await Promise.all(Array.from({ length: width }, async () => {
    while (!stopped && next < items.length) {
      const item = items[next++]
      if ((await work(item)) === false) stopped = true
    }
  }))
  return !stopped
}

/**
 * Saves every account and every bill photo on this phone.
 *
 * `rows` are the lists' own lines (customers and suppliers), `fetchLedger`
 * asks the books for one account's page, and `onProgress` is told how far it
 * has got: { step: 'accounts' | 'photos' | 'done' | 'paused', done, total }.
 *
 * An account is fetched only when the list's line for it has changed since it
 * was saved; a photo only when it is not already kept. So the first run does
 * the work and every later one is a few seconds, or nothing at all.
 */
export async function saveEverything({ rows, fetchLedger, onProgress, cancelled = () => false }) {
  if (typeof indexedDB === 'undefined' || typeof caches === 'undefined') return
  // The phone is asked not to clear this out when it runs short of space.
  try { await navigator.storage?.persist?.() } catch { /* its call */ }

  const parties = rows.filter((r) => r.ledger).sort((a, b) => (b.lastDate ?? 0) - (a.lastDate ?? 0))
  const urls = []
  let n = 0
  onProgress({ step: 'accounts', done: 0, total: parties.length })
  await each(parties, 3, async (row) => {
    if (cancelled()) return false
    const id = row.ledger._id
    const sig = signature(row)
    let rec = await savedLedger(id)
    if (!rec || rec.sig !== sig) {
      try {
        const data = await fetchLedger(id)
        await saveLedger(id, data, sig)
        rec = { data }
      } catch { /* offline, or the books are busy: this one waits for the next run */ }
    }
    if (rec?.data) urls.push(...photosOf(rec.data))
    onProgress({ step: 'accounts', done: ++n, total: parties.length })
    return true
  })
  if (cancelled()) return

  // A phone set to save data, or with no line, keeps its megabytes for now.
  if (navigator.connection?.saveData || navigator.onLine === false) { onProgress({ step: 'paused' }); return }

  const cache = await caches.open(PHOTOS)
  const unique = [...new Set(urls)]
  // Thumbnails for every bill first (a few KB each), then the screen-sized copies.
  const wanted = [...unique.map((u) => sized(u, THUMB)), ...unique.map((u) => sized(u, SCREEN))]
  let kept = 0
  let failed = 0
  onProgress({ step: 'photos', done: 0, total: wanted.length })
  const all = await each(wanted, 4, async (url) => {
    if (cancelled()) return false
    let ok = false
    try { ok = await keep(cache, url) } catch { ok = false }
    failed = ok ? 0 : failed + 1
    // The image service has stopped answering (its allowance, or the line): no
    // point asking for the other thousand. They are picked up on a later run.
    if (failed >= 8) return false
    onProgress({ step: 'photos', done: ++kept, total: wanted.length })
    return true
  })
  if (!cancelled()) onProgress({ step: all ? 'done' : 'paused', done: kept, total: wanted.length })
}
