/**
 * Every photo kept on the phone, so a thread opens at once and can be read on
 * a site with no signal.
 *
 * The photos go into Cache Storage, and the service worker (public/sw.js)
 * answers for a photo from there before it asks the network. For each photo:
 * the small copy the list shows and the middle one a bubble shows, from the
 * site's image service; and, for jobs of the last thirty days, the photo
 * itself, which is what opens full screen for reading a figure up close.
 *
 * `savePhotos` fills it in the background each time the app opens or the list
 * changes, and fetches only what is not already kept.
 */

/** The same name as in public/sw.js. */
const PHOTOS = 'workshop-photos-v1'
const RECENT = 30 * 86400000

/** A photo brought down to the width it is shown at (see vercel.json "images"). */
export const sized = (url, width) => `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=70`
export const SMALL = 256
export const BUBBLE = 640

/** Keeps one copy of a photo, unless it is already kept. False when it could not be had. */
async function keep(cache, url) {
  if (await cache.match(url, { ignoreVary: true })) return true
  const res = await fetch(url, { headers: { Accept: 'image/webp,image/*;q=0.9,*/*;q=0.5' } })
  // Only a picture is kept: an error page saved as a photo would be shown as one for good.
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) return false
  await cache.put(url, res)
  return true
}

// What this visit has already kept, so a list that changes is not all looked up again.
const kept = new Set()

/**
 * Saves the photos of `jobs` (the live list) on this phone. `onProgress` is
 * told how far it has got: { step: 'photos' | 'done' | 'paused', done, total }.
 */
export async function savePhotos({ jobs, onProgress }) {
  if (typeof caches === 'undefined') return
  // The phone is asked not to clear this out when it runs short of space.
  try { await navigator.storage?.persist?.() } catch { /* its call */ }

  const now = Date.now()
  const small = []
  const full = []
  for (const job of [...jobs].sort((a, b) => b.updatedAt - a.updatedAt)) {
    for (const m of job.messages) {
      for (const p of m.photos) {
        small.push(sized(p.url, SMALL), sized(p.url, BUBBLE))
        if (now - job.updatedAt < RECENT) full.push(p.url)
      }
    }
  }
  // The copies the list and the threads show first, then the photos themselves.
  const wanted = [...new Set([...small, ...full])]
  const todo = wanted.filter((url) => !kept.has(url))
  if (!todo.length) { if (wanted.length) onProgress({ step: 'done', done: wanted.length, total: wanted.length }); return }
  // A phone set to save data, or with no line, keeps its megabytes for now.
  if (navigator.connection?.saveData || navigator.onLine === false) { onProgress({ step: 'paused' }); return }

  const cache = await caches.open(PHOTOS)
  let done = wanted.length - todo.length
  let failed = 0
  let stopped = false
  let next = 0
  onProgress({ step: 'photos', done, total: wanted.length })
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (!stopped && next < todo.length) {
      const url = todo[next++]
      let ok = false
      try { ok = await keep(cache, url) } catch { ok = false }
      if (ok) { kept.add(url); failed = 0; onProgress({ step: 'photos', done: ++done, total: wanted.length }) }
      // The line has gone, or the image service has stopped answering: the
      // rest are picked up the next time the list changes or the app opens.
      else if (++failed >= 8) stopped = true
    }
  }))
  onProgress({ step: done >= wanted.length ? 'done' : 'paused', done, total: wanted.length })
}
