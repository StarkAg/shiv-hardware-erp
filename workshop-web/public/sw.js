// The service worker: enables install, and answers from what the phone keeps.
//
//   - A photo (the site's shrunk copies, and the photo itself from the books'
//     server) is answered from the phone when it is kept there, and kept when
//     it is first fetched. A photo never changes, so a kept copy is always
//     right, and a thread read once opens at once the next time.
//   - The app itself is network-first, so a deploy is picked up immediately;
//     the last copy is kept only to open with when there is no internet.
//
// Bump SW_VERSION on deploys that must force every client onto the newest app shell.
const SW_VERSION = '2026-10-11c-shiv-workshop'
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

/** The app's own files: the network's copy, and the last one kept to open with when there is no internet. */
async function shell(request) {
  try {
    const res = await fetch(request)
    if (res.ok) caches.open(SHELL).then((cache) => cache.put(request, res.clone())).catch(() => {})
    return res
  } catch {
    const cache = await caches.open(SHELL)
    const kept = (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match('/') : undefined)
    // respondWith() must always receive a Response.
    return kept ?? new Response('Offline. Please reconnect and try again.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const own = url.origin === self.location.origin
  const fromBooks = url.hostname.endsWith('.convex.cloud') && url.pathname.startsWith('/api/storage/')
  if (fromBooks || (own && url.pathname === '/_vercel/image')) event.respondWith(photo(event.request, fromBooks))
  else if (own) event.respondWith(shell(event.request))
  // Anything else (the books' live line, uploads) goes straight to the network.
})
