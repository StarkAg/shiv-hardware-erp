// The service worker: enables install, and answers from what the phone keeps.
//
//   - A photo (the site's shrunk copies, and the photo itself from the books'
//     server) is answered from the phone when it is kept there, and kept when
//     it is first fetched. A photo never changes, so a kept copy is always
//     right, and a thread read once opens at once the next time.
//   - The app itself opens from the copy kept on the phone, with no wait on
//     the line; the network's copy is fetched behind it, and a deploy is in
//     use from the next time the app opens (or comes back after a while).
//
// Bump SW_VERSION on deploys that must force every client onto the newest app shell.
const SW_VERSION = '2026-10-24a-shiv-workshop'
const SHELL = `workshop-shell-${SW_VERSION}`
// Not versioned: the photos outlive every deploy.
const PHOTOS = 'workshop-photos-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== PHOTOS && k !== SHELL).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

const isPicture = (res) => res.ok && /^image\//.test(res.headers.get('content-type') ?? '')

/** A photo: from the phone if it is kept, else fetched and kept. */
async function photo(request, fromBooks) {
  const cache = await caches.open(PHOTOS)
  const kept = await cache.match(request.url, { ignoreVary: true })
  if (kept) return kept
  // An <img> asks the books' server without CORS, and a copy got that way
  // cannot be read: the phone counts each as several megabytes. Asked openly
  // (the server allows it), the copy is an ordinary one.
  let res
  try {
    res = await fetch(fromBooks ? new Request(request.url, { mode: 'cors', credentials: 'omit' }) : request)
  } catch (err) {
    if (!fromBooks) throw err
    return fetch(request)
  }
  if (isPicture(res)) cache.put(request.url, res.clone()).catch(() => {})
  return res
}

/**
 * The app's own files: the copy kept on the phone, at once, and the network's
 * fetched behind it for the next time. Nothing waits on the line to open.
 * A new app found that way is told to the open windows (main.jsx), and its
 * files are fetched ahead so it too opens from the phone.
 */
const offline = () => new Response('Offline. Please reconnect and try again.', {
  status: 503,
  statusText: 'Service Unavailable',
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
})
async function shell(event) {
  const { request } = event
  const nav = request.mode === 'navigate'
  // Every address of the app is the one page.
  const key = nav ? '/' : request
  const cache = await caches.open(SHELL)
  const kept = await cache.match(key)
  const before = nav && kept ? kept.clone().text() : null
  const fresh = fetch(request).then(async (res) => {
    if (!res.ok || res.type === 'opaqueredirect') return res
    await cache.put(key, res.clone())
    if (before) {
      const page = await res.clone().text()
      if (page !== await before) {
        const files = [...page.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
        await Promise.all(files.map((f) => cache.add(f).catch(() => {})))
        for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage({ type: 'fresh' })
      }
    }
    return res
  })
  if (kept) {
    event.waitUntil(fresh.catch(() => {}))
    return kept
  }
  try { return await fresh } catch { return nav ? ((await cache.match('/')) ?? offline()) : offline() }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const own = url.origin === self.location.origin
  const fromBooks = url.hostname.endsWith('.convex.cloud') && url.pathname.startsWith('/api/storage/')
  if (fromBooks || (own && url.pathname === '/_vercel/image')) event.respondWith(photo(event.request, fromBooks))
  else if (own) event.respondWith(shell(event))
  // Anything else (the books' live line, uploads) goes straight to the network.
})
